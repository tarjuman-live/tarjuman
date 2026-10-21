import { mutation, internalMutation, type MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { dayKey, monthKey, DAY_MS } from "./reporting";
import {
  isAiKind,
  usageEventInputValidator,
  MAX_ERROR_CHARS,
  MAX_EVENTS_PER_INGEST,
  type UsageEventInput,
} from "./usageShared";

/**
 * Usage log for the admin dashboard: every Claude call (tokens + $), every STT
 * credential mint, and client-reported STT errors.
 *
 * WRITE PATHS
 *  - `ingest` — called by the Next.js API routes (src/lib/usage/ingest.ts)
 *    after each upstream call. Public so the routes can reach it without a
 *    deploy key, but guarded by a shared secret (Convex env
 *    USAGE_INGEST_SECRET, same value in the Vercel env). Without the secret,
 *    nothing can be written — a browser can't forge spend.
 *  - `reportClientEvent` — the signed-in browser reports its own STT engine
 *    errors (Speechmatics `quota_exceeded` is only ever visible client-side).
 *    Rate-limited per user; can only ever write `stt_error` rows for itself.
 *
 * ROLLUPS are folded IN THE SAME TRANSACTION as each raw insert (usageDaily +
 * usageUserMonthly), so they can never skip or double-count an event and need
 * no watermark. Write rate is tiny (≈ one translate per segment, ≤ 2
 * concurrent recordings on the Speechmatics free tier), so contention on the
 * per-day rollup row is a non-issue.
 *
 * Raw events are kept 35 days (pruneOldEvents, daily cron); rollups forever.
 */

const RAW_RETENTION_MS = 35 * DAY_MS;
const PRUNE_BATCH = 500;
/** Max client-reported STT errors stored per user per hour. */
const CLIENT_EVENTS_PER_HOUR = 20;

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compare SHA-256 digests in constant time — equal-length inputs, so neither
 * the secret's length nor a matching prefix leaks through timing.
 */
async function secretMatches(given: string): Promise<boolean> {
  const expected = process.env.USAGE_INGEST_SECRET;
  if (!expected || expected.length < 32) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const ha = hex(a);
  const hb = hex(b);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

/** Clamp a token/latency count to a sane non-negative integer (or drop it). */
function count(n: number | undefined): number | undefined {
  if (n === undefined || !Number.isFinite(n) || n < 0) return undefined;
  return Math.min(Math.round(n), 10_000_000);
}

function sanitize(e: UsageEventInput): UsageEventInput {
  return {
    ...e,
    model: e.model?.slice(0, 80),
    provider: e.provider?.slice(0, 40),
    error: e.error?.slice(0, MAX_ERROR_CHARS),
    inputTokens: count(e.inputTokens),
    outputTokens: count(e.outputTokens),
    cacheReadTokens: count(e.cacheReadTokens),
    cacheWriteTokens: count(e.cacheWriteTokens),
    costMicroUsd: count(e.costMicroUsd),
    latencyMs: count(e.latencyMs),
    status: count(e.status),
  };
}

/** Insert one raw event and fold it into the daily + per-user-monthly rollups. */
export async function recordEvent(
  ctx: MutationCtx,
  raw: UsageEventInput,
): Promise<void> {
  const e = sanitize(raw);
  // Drop a userId that no longer resolves (deleted account) rather than
  // writing an orphan the purge job would never revisit.
  let userId: Id<"users"> | undefined = e.userId;
  if (userId && (await ctx.db.get("users", userId)) === null) userId = undefined;

  await ctx.db.insert("usageEvents", { ...e, userId });

  const now = Date.now();
  const day = dayKey(now);
  const model = e.model ?? "";
  const cost = e.costMicroUsd ?? 0;
  const unpriced = e.ok && isAiKind(e.kind) && e.costMicroUsd === undefined;

  const daily = await ctx.db
    .query("usageDaily")
    .withIndex("by_day_and_kind_and_model", (q) =>
      q.eq("day", day).eq("kind", e.kind).eq("model", model),
    )
    .unique();
  if (daily) {
    await ctx.db.patch("usageDaily", daily._id, {
      calls: daily.calls + 1,
      errors: daily.errors + (e.ok ? 0 : 1),
      inputTokens: daily.inputTokens + (e.inputTokens ?? 0),
      outputTokens: daily.outputTokens + (e.outputTokens ?? 0),
      cacheReadTokens: daily.cacheReadTokens + (e.cacheReadTokens ?? 0),
      cacheWriteTokens: daily.cacheWriteTokens + (e.cacheWriteTokens ?? 0),
      costMicroUsd: daily.costMicroUsd + cost,
      unpricedCalls: daily.unpricedCalls + (unpriced ? 1 : 0),
    });
  } else {
    await ctx.db.insert("usageDaily", {
      day,
      kind: e.kind,
      model,
      calls: 1,
      errors: e.ok ? 0 : 1,
      inputTokens: e.inputTokens ?? 0,
      outputTokens: e.outputTokens ?? 0,
      cacheReadTokens: e.cacheReadTokens ?? 0,
      cacheWriteTokens: e.cacheWriteTokens ?? 0,
      costMicroUsd: cost,
      unpricedCalls: unpriced ? 1 : 0,
    });
  }

  if (userId) {
    const month = monthKey(now);
    const monthly = await ctx.db
      .query("usageUserMonthly")
      .withIndex("by_month_and_user", (q) =>
        q.eq("month", month).eq("userId", userId),
      )
      .unique();
    if (monthly) {
      await ctx.db.patch("usageUserMonthly", monthly._id, {
        calls: monthly.calls + 1,
        costMicroUsd: monthly.costMicroUsd + cost,
      });
    } else {
      await ctx.db.insert("usageUserMonthly", {
        month,
        userId,
        calls: 1,
        costMicroUsd: cost,
      });
    }
  }
}

/** Server-to-server ingest from the Next.js API routes. Secret-guarded. */
export const ingest = mutation({
  args: {
    secret: v.string(),
    events: v.array(usageEventInputValidator),
  },
  returns: v.null(),
  handler: async (ctx, { secret, events }) => {
    if (!(await secretMatches(secret))) throw new ConvexError("Forbidden");
    for (const e of events.slice(0, MAX_EVENTS_PER_INGEST)) {
      await recordEvent(ctx, e);
    }
    return null;
  },
});

/**
 * A signed-in client reports an STT engine error (e.g. Speechmatics
 * quota_exceeded). Can only write `stt_error` rows for the caller; capped at
 * CLIENT_EVENTS_PER_HOUR per user so a misbehaving tab can't flood the log.
 * Silently no-ops when signed out or over the cap — this is telemetry, it must
 * never surface an error into the recording UI.
 */
export const reportClientEvent = mutation({
  args: {
    provider: v.string(),
    code: v.optional(v.string()),
    message: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const since = Date.now() - 60 * 60 * 1000;
    const recent = await ctx.db
      .query("usageEvents")
      .withIndex("by_user_and_kind", (q) =>
        q
          .eq("userId", userId)
          .eq("kind", "stt_error")
          .gte("_creationTime", since),
      )
      .take(CLIENT_EVENTS_PER_HOUR);
    if (recent.length >= CLIENT_EVENTS_PER_HOUR) return null;
    const error = [args.code, args.message].filter(Boolean).join(": ");
    await recordEvent(ctx, {
      userId,
      kind: "stt_error",
      provider: args.provider,
      ok: false,
      error: error || "unknown",
    });
    return null;
  },
});

/** Daily cron: delete raw events older than the retention window, in batches. */
export const pruneOldEvents = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - RAW_RETENTION_MS;
    const old = await ctx.db
      .query("usageEvents")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(PRUNE_BATCH);
    for (const e of old) await ctx.db.delete("usageEvents", e._id);
    if (old.length === PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.usage.pruneOldEvents, {});
    }
    return null;
  },
});

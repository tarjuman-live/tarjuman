import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { adminIds, requireAdminAction } from "./adminAuth";
import { isTestEmail, isTestTitle } from "./admin";
import { isGrantActive } from "./entitlements";
import { segmentCountOf } from "./sessions";
import { annualPerMonth, PLAN_META } from "./billingLimits";
import { lastDayKeys, monthKey } from "./reporting";
import {
  computeDashboard,
  computeUserStats,
  DASHBOARD_SCHEMA_VERSION,
  SERIES_DAYS,
  type AccountRow,
  type AuthSessionRow,
  type DashboardInput,
  type GrantRow,
  type PrefRow,
  type SessionRow,
  type SubRow,
  type UsageDayRow,
  type UserRow,
} from "./adminMetrics";

/**
 * Admin dashboard snapshot pipeline.
 *
 * There is deliberately NO recurring full scan (it would cost database I/O
 * every hour whether or not anyone looks). Instead /admin calls `refreshNow`
 * when it opens on a snapshot older than ~15 min (or one with a stale
 * schemaVersion), plus a manual Refresh button. A lease in `adminState`
 * prevents overlapping runs and limits refreshes to one per minute.
 *
 * A refresh pages through each table with small internal queries — each one a
 * single `paginate()` bounded by `maximumBytesRead` (legacy session docs can
 * carry a ~1 MiB inline transcript) — returning COMPACT rows only. The pure
 * computeDashboard (adminMetrics.ts) turns those into the snapshot, and the
 * per-user rollup (adminUserStats) is upserted for rows that changed.
 *
 * Scale ceiling: everything is held in action memory (~150 B per session
 * row), comfortable to ~200k sessions. Past that, move the hot counters to
 * @convex-dev/aggregate.
 */

const SNAPSHOT_KEY = "dashboard";
const REFRESH_KEY = "refresh";
/** A refresh older than this with no finish time is presumed crashed. */
const LEASE_TTL_MS = 5 * 60 * 1000;
/** Minimum spacing between refresh starts. */
const MIN_REFRESH_INTERVAL_MS = 60 * 1000;
/** Per-page read budget for the table scans. */
const PAGE_BYTES = 6 * 1024 * 1024;
/** Hard cap on pages per table — a runaway loop guard, not a product limit. */
const MAX_PAGES = 2000;
/** adminUserStats rows written per mutation. */
const USER_STATS_BATCH = 200;

type Page<T> = { rows: T[]; isDone: boolean; cursor: string };
const pageArgs = { cursor: v.union(v.string(), v.null()) };

// ─── Page readers (compact rows only) ───────────────────────────────────────

export const pageUsers = internalQuery({
  args: pageArgs,
  handler: async (ctx, { cursor }): Promise<Page<UserRow>> => {
    const res = await ctx.db
      .query("users")
      .paginate({ numItems: 1000, cursor, maximumBytesRead: PAGE_BYTES });
    return {
      isDone: res.isDone,
      cursor: res.continueCursor,
      rows: res.page.map((u) => ({
        id: u._id,
        createdAt: u._creationTime,
        email: u.email ?? null,
        isTest: isTestEmail(u.email),
      })),
    };
  },
});

export const pageAccounts = internalQuery({
  args: pageArgs,
  handler: async (ctx, { cursor }): Promise<Page<AccountRow>> => {
    const res = await ctx.db
      .query("authAccounts")
      .paginate({ numItems: 2000, cursor, maximumBytesRead: PAGE_BYTES });
    return {
      isDone: res.isDone,
      cursor: res.continueCursor,
      rows: res.page.map((a) => ({ userId: a.userId, provider: a.provider })),
    };
  },
});

export const pageAuthSessions = internalQuery({
  args: pageArgs,
  handler: async (ctx, { cursor }): Promise<Page<AuthSessionRow>> => {
    const res = await ctx.db
      .query("authSessions")
      .paginate({ numItems: 2000, cursor, maximumBytesRead: PAGE_BYTES });
    return {
      isDone: res.isDone,
      cursor: res.continueCursor,
      rows: res.page.map((s) => ({
        userId: s.userId,
        createdAt: s._creationTime,
        expirationTime: s.expirationTime,
      })),
    };
  },
});

export const pageSessions = internalQuery({
  args: pageArgs,
  handler: async (ctx, { cursor }): Promise<Page<SessionRow>> => {
    const res = await ctx.db
      .query("sessions")
      .paginate({ numItems: 400, cursor, maximumBytesRead: PAGE_BYTES });
    return {
      isDone: res.isDone,
      cursor: res.continueCursor,
      rows: res.page.map((s) => ({
        id: s._id,
        userId: s.userId ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        status: s.status,
        durationSec: s.duration,
        segmentCount: segmentCountOf(s),
        legacyInline: s.segments.length > 0,
        sourceLanguage: s.sourceLanguage,
        targetLanguage: s.targetLanguage,
        hasSummary: Boolean(s.summary),
        summaryGeneratedAt: s.summaryGeneratedAt ?? null,
        platform: s.platform ?? null,
        isTestTitle: isTestTitle(s.title),
      })),
    };
  },
});

export const pageSubscriptions = internalQuery({
  args: pageArgs,
  handler: async (ctx, { cursor }): Promise<Page<SubRow>> => {
    const res = await ctx.db
      .query("subscriptions")
      .paginate({ numItems: 2000, cursor, maximumBytesRead: PAGE_BYTES });
    return {
      isDone: res.isDone,
      cursor: res.continueCursor,
      rows: res.page.map((s) => ({
        userId: s.userId,
        status: s.status,
        plan: s.plan,
        priceId: s.priceId ?? null,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd ?? false,
      })),
    };
  },
});

export const pageGrants = internalQuery({
  args: { ...pageArgs, now: v.number() },
  handler: async (ctx, { cursor, now }): Promise<Page<GrantRow>> => {
    const res = await ctx.db
      .query("planGrants")
      .paginate({ numItems: 2000, cursor, maximumBytesRead: PAGE_BYTES });
    return {
      isDone: res.isDone,
      cursor: res.continueCursor,
      rows: res.page.map((g) => ({
        userId: g.userId,
        active: isGrantActive(g, now),
      })),
    };
  },
});

export const pagePrefs = internalQuery({
  args: pageArgs,
  handler: async (ctx, { cursor }): Promise<Page<PrefRow>> => {
    const res = await ctx.db
      .query("userPreferences")
      .paginate({ numItems: 2000, cursor, maximumBytesRead: PAGE_BYTES });
    return {
      isDone: res.isDone,
      cursor: res.continueCursor,
      rows: res.page.map((p) => ({
        userId: p.userId,
        mainSpeakerOnly: p.mainSpeakerOnly ?? null,
        ttsEnabled: p.ttsEnabled ?? null,
      })),
    };
  },
});

export const pageUsageDays = internalQuery({
  args: { ...pageArgs, fromDay: v.string() },
  handler: async (ctx, { cursor, fromDay }): Promise<Page<UsageDayRow>> => {
    const res = await ctx.db
      .query("usageDaily")
      .withIndex("by_day_and_kind_and_model", (q) => q.gte("day", fromDay))
      .paginate({ numItems: 2000, cursor, maximumBytesRead: PAGE_BYTES });
    return {
      isDone: res.isDone,
      cursor: res.continueCursor,
      rows: res.page.map((r) => ({
        day: r.day,
        kind: r.kind,
        model: r.model,
        calls: r.calls,
        errors: r.errors,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
        costMicroUsd: r.costMicroUsd,
        unpricedCalls: r.unpricedCalls,
      })),
    };
  },
});

type StoredUserStats = {
  id: Id<"adminUserStats">;
  userId: Id<"users">;
  sessions: number;
  recordingSeconds: number;
  summaries: number;
  lastRecordedAt: number | null;
  platforms: string[];
};

export const pageUserStats = internalQuery({
  args: pageArgs,
  handler: async (ctx, { cursor }): Promise<Page<StoredUserStats>> => {
    const res = await ctx.db
      .query("adminUserStats")
      .paginate({ numItems: 2000, cursor, maximumBytesRead: PAGE_BYTES });
    return {
      isDone: res.isDone,
      cursor: res.continueCursor,
      rows: res.page.map((r) => ({
        id: r._id,
        userId: r.userId,
        sessions: r.sessions,
        recordingSeconds: r.recordingSeconds,
        summaries: r.summaries,
        lastRecordedAt: r.lastRecordedAt ?? null,
        platforms: r.platforms,
      })),
    };
  },
});

/** This month's top AI spenders, with identity for display. */
export const topSpenders = internalQuery({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const rows = await ctx.db
      .query("usageUserMonthly")
      .withIndex("by_month_and_cost", (q) => q.eq("month", month))
      .order("desc")
      .take(10);
    const out = [];
    for (const r of rows) {
      const user = await ctx.db.get("users", r.userId);
      out.push({
        userId: r.userId,
        email: user?.email ?? null,
        name: user?.name ?? null,
        calls: r.calls,
        costMicroUsd: r.costMicroUsd,
      });
    }
    return out;
  },
});

// ─── Lease + writes ─────────────────────────────────────────────────────────

async function getStateRow(ctx: MutationCtx, key: string) {
  return await ctx.db
    .query("adminState")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

/** Take the refresh lease. False = a refresh is running or ran < 1 min ago. */
export const acquireLease = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const now = Date.now();
    const row = await getStateRow(ctx, REFRESH_KEY);
    const started = row?.refreshStartedAt;
    const finished = row?.refreshFinishedAt;
    if (started !== undefined) {
      const running =
        (finished === undefined || finished < started) &&
        now - started < LEASE_TTL_MS;
      if (running || now - started < MIN_REFRESH_INTERVAL_MS) return false;
    }
    if (row) {
      await ctx.db.patch("adminState", row._id, { refreshStartedAt: now });
    } else {
      await ctx.db.insert("adminState", {
        key: REFRESH_KEY,
        refreshStartedAt: now,
      });
    }
    return true;
  },
});

export const releaseLease = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await getStateRow(ctx, REFRESH_KEY);
    if (row) {
      await ctx.db.patch("adminState", row._id, {
        refreshFinishedAt: Date.now(),
      });
    }
    return null;
  },
});

export const saveSnapshot = internalMutation({
  args: {
    data: v.any(),
    schemaVersion: v.number(),
    computedAt: v.number(),
    durationMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("adminSnapshots")
      .withIndex("by_key", (q) => q.eq("key", SNAPSHOT_KEY))
      .unique();
    if (row) {
      await ctx.db.replace("adminSnapshots", row._id, {
        key: SNAPSHOT_KEY,
        ...args,
      });
    } else {
      await ctx.db.insert("adminSnapshots", { key: SNAPSHOT_KEY, ...args });
    }
    return null;
  },
});

const userStatsFields = {
  userId: v.id("users"),
  sessions: v.number(),
  recordingSeconds: v.number(),
  summaries: v.number(),
  lastRecordedAt: v.optional(v.number()),
  platforms: v.array(v.string()),
};

export const writeUserStats = internalMutation({
  args: {
    upserts: v.array(v.object(userStatsFields)),
    deletes: v.array(v.id("adminUserStats")),
  },
  returns: v.null(),
  handler: async (ctx, { upserts, deletes }) => {
    const now = Date.now();
    for (const u of upserts) {
      // The user may have been deleted since the scan — never resurrect stats.
      if ((await ctx.db.get("users", u.userId)) === null) continue;
      const existing = await ctx.db
        .query("adminUserStats")
        .withIndex("by_user", (q) => q.eq("userId", u.userId))
        .unique();
      if (existing) {
        await ctx.db.replace("adminUserStats", existing._id, {
          ...u,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("adminUserStats", { ...u, updatedAt: now });
      }
    }
    for (const id of deletes) {
      if (await ctx.db.get("adminUserStats", id)) {
        await ctx.db.delete("adminUserStats", id);
      }
    }
    return null;
  },
});

// ─── The refresh ────────────────────────────────────────────────────────────

async function drain<T>(
  label: string,
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  // Loop until isDone — NEVER treat a short page as the end: a page cut by
  // maximumBytesRead can be short while more rows remain.
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await fetchPage(cursor);
    for (const r of page.rows) out.push(r);
    if (page.isDone) return out;
    cursor = page.cursor;
  }
  throw new Error(`adminStats: ${label} exceeded ${MAX_PAGES} pages`);
}

function sameStats(a: StoredUserStats, b: StoredUserStats): boolean {
  return (
    a.sessions === b.sessions &&
    a.recordingSeconds === b.recordingSeconds &&
    a.summaries === b.summaries &&
    a.lastRecordedAt === b.lastRecordedAt &&
    a.platforms.join(",") === b.platforms.join(",")
  );
}

async function runRefresh(ctx: ActionCtx): Promise<{ started: boolean }> {
  const leased: boolean = await ctx.runMutation(
    internal.adminStats.acquireLease,
    {},
  );
  if (!leased) return { started: false };
  try {
    const t0 = Date.now();
    const fromDay = lastDayKeys(t0, SERIES_DAYS)[0];
    const [users, accounts, authSessions, sessions, subs, grants, prefs, usageDays] =
      await Promise.all([
        drain("users", (cursor) =>
          ctx.runQuery(internal.adminStats.pageUsers, { cursor }),
        ),
        drain("authAccounts", (cursor) =>
          ctx.runQuery(internal.adminStats.pageAccounts, { cursor }),
        ),
        drain("authSessions", (cursor) =>
          ctx.runQuery(internal.adminStats.pageAuthSessions, { cursor }),
        ),
        drain("sessions", (cursor) =>
          ctx.runQuery(internal.adminStats.pageSessions, { cursor }),
        ),
        drain("subscriptions", (cursor) =>
          ctx.runQuery(internal.adminStats.pageSubscriptions, { cursor }),
        ),
        drain("planGrants", (cursor) =>
          ctx.runQuery(internal.adminStats.pageGrants, { cursor, now: t0 }),
        ),
        drain("userPreferences", (cursor) =>
          ctx.runQuery(internal.adminStats.pagePrefs, { cursor }),
        ),
        drain("usageDaily", (cursor) =>
          ctx.runQuery(internal.adminStats.pageUsageDays, { cursor, fromDay }),
        ),
      ]);

    const now = Date.now();
    const input: DashboardInput = {
      now,
      users,
      accounts,
      sessions,
      subs,
      grants,
      prefs,
      authSessions,
      usageDays,
      teamIds: Array.from(adminIds()),
      annualPriceId: process.env.STRIPE_PRICE_ID_ANNUAL ?? null,
      proMonthlyUsd: PLAN_META.pro.priceMonthly,
      proAnnualPerMonthUsd: annualPerMonth(PLAN_META.pro.priceMonthly),
    };
    const data = computeDashboard(input);
    const spenders = await ctx.runQuery(internal.adminStats.topSpenders, {
      month: monthKey(now),
    });

    await ctx.runMutation(internal.adminStats.saveSnapshot, {
      data: { ...data, topSpenders: spenders },
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      computedAt: now,
      durationMs: Date.now() - t0,
    });

    // Per-user rollup: write only rows that changed; drop rows for users who
    // no longer have any real session (or no longer exist).
    const fresh = computeUserStats(input);
    const stored = await drain("adminUserStats", (cursor) =>
      ctx.runQuery(internal.adminStats.pageUserStats, { cursor }),
    );
    const storedByUser = new Map(stored.map((r) => [r.userId as string, r]));
    const upserts: {
      userId: Id<"users">;
      sessions: number;
      recordingSeconds: number;
      summaries: number;
      lastRecordedAt?: number;
      platforms: string[];
    }[] = [];
    for (const [userId, st] of Array.from(fresh.entries())) {
      const prev = storedByUser.get(userId);
      const next: StoredUserStats = {
        id: prev?.id as Id<"adminUserStats">,
        userId: userId as Id<"users">,
        ...st,
      };
      if (prev && sameStats(prev, next)) continue;
      upserts.push({
        userId: userId as Id<"users">,
        sessions: st.sessions,
        recordingSeconds: st.recordingSeconds,
        summaries: st.summaries,
        ...(st.lastRecordedAt !== null ? { lastRecordedAt: st.lastRecordedAt } : {}),
        platforms: st.platforms,
      });
    }
    const deletes = stored
      .filter((r) => !fresh.has(r.userId))
      .map((r) => r.id);
    for (let i = 0; i < Math.max(upserts.length, deletes.length); i += USER_STATS_BATCH) {
      await ctx.runMutation(internal.adminStats.writeUserStats, {
        upserts: upserts.slice(i, i + USER_STATS_BATCH),
        deletes: deletes.slice(i, i + USER_STATS_BATCH),
      });
    }
    return { started: true };
  } finally {
    await ctx.runMutation(internal.adminStats.releaseLease, {});
  }
}

/** /admin: recompute the dashboard now (admin only; leased + throttled). */
export const refreshNow = action({
  args: {},
  returns: v.object({ started: v.boolean() }),
  handler: async (ctx) => {
    await requireAdminAction(ctx);
    return await runRefresh(ctx);
  },
});

/** Same, for the Convex dashboard Functions runner. */
export const refresh = internalAction({
  args: {},
  returns: v.object({ started: v.boolean() }),
  handler: async (ctx) => await runRefresh(ctx),
});

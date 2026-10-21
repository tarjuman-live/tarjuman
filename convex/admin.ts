import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { loadSegments, segmentCountOf } from "./sessions";
import { deleteSessionCascade, deleteUserIdentity } from "./userData";

/**
 * Operator-only support helpers. Run these from the Convex dashboard's
 * "Functions" runner — they are NOT part of the public API.
 *
 * ⚠️ Every function here is an `internalQuery` on purpose. They look up and
 * return *any* user's data, bypassing the per-user ownership checks that the
 * public `sessions`/`users` functions enforce. If these were registered as
 * public `query`s, anyone could call `api.admin.getUserByEmail` from the
 * browser console and enumerate every account + transcript. `internalQuery`
 * keeps them off the public client API while still letting an operator run
 * them from the dashboard (which has admin access).
 *
 * Support flow these cover:
 *   1. getUserByEmail   — "a user emailed support, find their account"
 *   2. getUserSessions  — "list what they've recorded"
 *   3. getSessionDetail — "inspect one session's transcript / summary"
 *
 * Read-only by design. A write action (e.g. resend-summary) is a separate,
 * deliberately-guarded mutation — add it when a real support task needs it.
 *
 * The same capabilities (and more) are available in the web UI at /admin for
 * operators listed in ADMIN_USER_IDS — see convex/adminPanel.ts.
 */

// A single user has a bounded-but-unknown number of sessions. Cap the count
// scan so this never degrades into a full-table read if some account somehow
// accumulates a huge history. Counts above the cap report as "N+".
const SESSION_COUNT_CAP = 200;

// Upper bound on rows getUserSessions will return in one call, so the helper
// always returns a bounded collection even if a large limit is passed.
const MAX_SESSION_PAGE = 200;
const DEFAULT_SESSION_PAGE = 50;

function summarizeSession(s: Doc<"sessions">) {
  return {
    _id: s._id,
    title: s.title ?? null,
    status: s.status,
    sourceLanguage: s.sourceLanguage,
    targetLanguage: s.targetLanguage,
    durationSeconds: s.duration,
    // segmentCount, not segments.length — new sessions store segments in the
    // transcriptSegments table and leave the inline array empty.
    segmentCount: segmentCountOf(s),
    hasSummary: Boolean(s.summary),
    summaryLanguage: s.summaryLanguage ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/**
 * Find account(s) by email and return a support-friendly profile for each:
 * identity, which sign-in providers are linked (password vs. Google — the
 * usual "why can't I reset my password" question), and a bounded session
 * count.
 *
 * Returns an array because the auth `users` table does not enforce email
 * uniqueness; in practice you'll almost always get 0 or 1. The lookup is
 * case-insensitive-tolerant: it checks the email as typed and its lowercase
 * form (auth stores most emails lowercase).
 */
export const getUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim();
    const variants = Array.from(
      new Set([normalized, normalized.toLowerCase()].filter(Boolean))
    );

    const seen = new Set<Id<"users">>();
    const users: Doc<"users">[] = [];
    for (const value of variants) {
      const matches = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", value))
        .take(10);
      for (const u of matches) {
        if (!seen.has(u._id)) {
          seen.add(u._id);
          users.push(u);
        }
      }
    }

    const results = [];
    for (const user of users) {
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id))
        .take(20);
      const providers = accounts.map((a) => a.provider);

      const sessionSample = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(SESSION_COUNT_CAP + 1);
      const capped = sessionSample.length > SESSION_COUNT_CAP;

      results.push({
        _id: user._id,
        email: user.email ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
        emailVerified: user.emailVerificationTime != null,
        createdAt: user._creationTime,
        providers,
        hasPassword: providers.includes("password"),
        hasGoogle: providers.includes("google"),
        sessionCount: capped ? SESSION_COUNT_CAP : sessionSample.length,
        sessionCountCapped: capped,
      });
    }

    return results;
  },
});

/**
 * List a user's sessions, most recent first, as lightweight summaries (no
 * transcript bodies — use getSessionDetail for that). Pass the `_id` from
 * getUserByEmail. `limit` defaults to 50 and is clamped to 200.
 */
export const getUserSessions = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    const take = Math.min(
      Math.max(1, Math.floor(limit ?? DEFAULT_SESSION_PAGE)),
      MAX_SESSION_PAGE
    );
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(take);
    return sessions.map(summarizeSession);
  },
});

/**
 * Full detail for a single session — transcript segments, summary, timing.
 * For content-support questions ("my summary looks wrong"). Pass a session
 * `_id` from getUserSessions. Returns null if the id doesn't exist.
 */
export const getSessionDetail = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    return {
      ...summarizeSession(session),
      userId: session.userId ?? null,
      summary: session.summary ?? null,
      // Table rows (or the legacy inline array) — the inline array alone is
      // empty for every session recorded since the segments-table migration.
      segments: await loadSegments(ctx, session),
    };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Test-data cleanup
//
// Automated test / deploy-verification runs create sessions titled
// "<prefix>-<unix-ms>" (e.g. "lt-verify-1780498...", "nav-test-...",
// "lens-...", "fluid-...") and accounts like "lens-<ms>@example.com". Real
// users never look like this. These helpers find and (on explicit
// confirmation) delete that junk — from the dashboard Functions runner, or from
// /admin → System.
//
// Every scan is PAGINATED and every delete goes through the shared cascades in
// userData.ts, so (unlike the original whole-table .collect() versions) they
// stay inside Convex's per-transaction read/write limits at any table size and
// never orphan transcriptSegments / subscriptions rows.
// ───────────────────────────────────────────────────────────────────────────

export const TEST_TITLE_PREFIXES = ["lt-verify", "nav-test", "lens", "fluid"];
export const TEST_USER_PREFIXES = ["lens", "fluid", "nav-test", "lt-verify"];

/** Byte budget per scanned page — legacy sessions can carry ~1 MiB inline. */
const SWEEP_PAGE_BYTES = 4 * 1024 * 1024;
/** Rows examined by a dry run before it reports "partial". */
const DRY_RUN_SCAN_CAP = 2000;

/**
 * True only for "<prefix>-<digits…>" titles — i.e. the programmatic test
 * pattern. Requiring the trailing digit run means a genuine session that
 * merely starts with one of these words can never match.
 */
export function isTestTitle(
  title: string | undefined,
  prefixes: readonly string[] = TEST_TITLE_PREFIXES
): boolean {
  if (!title) return false;
  for (const p of prefixes) {
    const pre = `${p}-`;
    if (title.startsWith(pre) && /^\d/.test(title.slice(pre.length))) {
      return true;
    }
  }
  return false;
}

/** True for "<prefix>-<digits>@example.com" — the automated-test account shape. */
export function isTestEmail(
  email: string | undefined,
  prefixes: readonly string[] = TEST_USER_PREFIXES
): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (!lower.endsWith("@example.com")) return false;
  return prefixes.some(
    (p) => lower.startsWith(`${p}-`) && /^\d/.test(lower.slice(p.length + 1))
  );
}

/**
 * DRY RUN — list the test sessions that {@link deleteTestSessions} would
 * remove. Scans at most DRY_RUN_SCAN_CAP rows (`complete: false` means there
 * were more). Read-only.
 */
export const listTestSessions = internalQuery({
  args: { prefixes: v.optional(v.array(v.string())) },
  handler: async (ctx, { prefixes }) => {
    const pres = prefixes?.length ? prefixes : TEST_TITLE_PREFIXES;
    let scanned = 0;
    let complete = true;
    const matched: Doc<"sessions">[] = [];
    for await (const s of ctx.db.query("sessions")) {
      if (scanned >= DRY_RUN_SCAN_CAP) {
        complete = false;
        break;
      }
      scanned++;
      if (isTestTitle(s.title, pres)) matched.push(s);
    }
    return {
      prefixes: pres,
      scanned,
      complete,
      matched: matched.length,
      sample: matched.slice(0, 100).map((s) => ({
        _id: s._id,
        title: s.title ?? null,
        status: s.status,
        segmentCount: segmentCountOf(s),
        createdAt: s.createdAt,
      })),
    };
  },
});

/**
 * Delete the test sessions matched by their `prefix-<digits>` title.
 *
 * SAFETY: defaults to a DRY RUN (see listTestSessions). Pass `confirm: true`
 * to start the paginated sweep, which runs in the background and logs its
 * total when done.
 */
export const deleteTestSessions = internalMutation({
  args: {
    prefixes: v.optional(v.array(v.string())),
    confirm: v.optional(v.boolean()),
  },
  handler: async (ctx, { prefixes, confirm }) => {
    if (!confirm) {
      return {
        dryRun: true as const,
        note: "Run admin:listTestSessions to preview, then pass confirm: true.",
      };
    }
    await ctx.scheduler.runAfter(0, internal.admin.sweepTestSessions, {
      cursor: null,
      prefixes,
      deleted: 0,
    });
    return { dryRun: false as const, started: true };
  },
});

/** One page of the test-session sweep; reschedules itself until done. */
export const sweepTestSessions = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    prefixes: v.optional(v.array(v.string())),
    deleted: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { cursor, prefixes, deleted }) => {
    const pres = prefixes?.length ? prefixes : TEST_TITLE_PREFIXES;
    const res = await ctx.db
      .query("sessions")
      .paginate({ numItems: 50, cursor, maximumBytesRead: SWEEP_PAGE_BYTES });
    let n = deleted;
    for (const s of res.page) {
      if (isTestTitle(s.title, pres)) {
        await deleteSessionCascade(ctx, s._id);
        n++;
      }
    }
    if (!res.isDone) {
      await ctx.scheduler.runAfter(0, internal.admin.sweepTestSessions, {
        cursor: res.continueCursor,
        prefixes,
        deleted: n,
      });
    } else {
      console.log(`[admin] sweepTestSessions finished — deleted ${n}`);
    }
    return null;
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Test-USER cleanup
//
// Real users never use the reserved @example.com domain, so
// "<prefix>-<digits>@example.com" accounts are safe to remove. Each deletion
// goes through userData.deleteUserIdentity — the same cascade as a real
// "Delete account" — so sessions, transcript rows, billing and auth rows all go.
// ───────────────────────────────────────────────────────────────────────────

/** DRY RUN — list the test users {@link deleteTestUsers} would remove. Read-only. */
export const listTestUsers = internalQuery({
  args: { prefixes: v.optional(v.array(v.string())) },
  handler: async (ctx, { prefixes }) => {
    const pres = prefixes?.length ? prefixes : TEST_USER_PREFIXES;
    let scanned = 0;
    let complete = true;
    const matched: (string | null)[] = [];
    for await (const u of ctx.db.query("users")) {
      if (scanned >= DRY_RUN_SCAN_CAP * 5) {
        complete = false;
        break;
      }
      scanned++;
      if (isTestEmail(u.email, pres)) matched.push(u.email ?? null);
    }
    return {
      prefixes: pres,
      totalUsers: scanned,
      complete,
      matched: matched.length,
      sampleEmails: matched.slice(0, 100),
    };
  },
});

/**
 * Delete the test users (full cascade).
 *
 * SAFETY: defaults to a DRY RUN — pass `confirm: true` to start the paginated
 * sweep. Only ever matches "<prefix>-<digits>@example.com", so it cannot touch
 * a real account.
 */
export const deleteTestUsers = internalMutation({
  args: {
    prefixes: v.optional(v.array(v.string())),
    confirm: v.optional(v.boolean()),
  },
  handler: async (ctx, { prefixes, confirm }) => {
    if (!confirm) {
      return {
        dryRun: true as const,
        note: "Run admin:listTestUsers to preview, then pass confirm: true.",
      };
    }
    await ctx.scheduler.runAfter(0, internal.admin.sweepTestUsers, {
      cursor: null,
      prefixes,
      deleted: 0,
    });
    return { dryRun: false as const, started: true };
  },
});

/** One page of the test-user sweep; reschedules itself until done. */
export const sweepTestUsers = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    prefixes: v.optional(v.array(v.string())),
    deleted: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { cursor, prefixes, deleted }) => {
    const pres = prefixes?.length ? prefixes : TEST_USER_PREFIXES;
    // Small pages: each match is a multi-table cascade.
    const res = await ctx.db.query("users").paginate({ numItems: 25, cursor });
    let n = deleted;
    for (const u of res.page) {
      if (isTestEmail(u.email, pres)) {
        await deleteUserIdentity(ctx, u._id);
        n++;
      }
    }
    if (!res.isDone) {
      await ctx.scheduler.runAfter(0, internal.admin.sweepTestUsers, {
        cursor: res.continueCursor,
        prefixes,
        deleted: n,
      });
    } else {
      console.log(`[admin] sweepTestUsers finished — deleted ${n}`);
    }
    return null;
  },
});

// ─── Orphaned auth-row cleanup ───────────────────────────────────────────
// When a `users` row is deleted directly (e.g. from the Convex dashboard,
// bypassing users.ts:deleteAccount), its `authAccounts` / `authSessions`
// links survive and dangle. A dangling Google `authAccounts` row is FATAL:
// the next OAuth sign-in finds it, tries to UPDATE the now-missing user, and
// @convex-dev/auth throws "Update on nonexistent document ID" — silently
// bouncing the user back to the sign-in screen on every attempt. This sweeps
// any auth row whose `userId` no longer resolves to a user document.
// Dry-run by default; pass { confirm: true } to start the paginated sweep.
export const cleanupOrphanedAuth = internalMutation({
  args: { confirm: v.optional(v.boolean()) },
  handler: async (ctx, { confirm }) => {
    if (!confirm) {
      let orphanedAccounts = 0;
      let orphanedSessions = 0;
      let scanned = 0;
      const providers: string[] = [];
      for await (const a of ctx.db.query("authAccounts")) {
        if (++scanned > DRY_RUN_SCAN_CAP) break;
        if ((await ctx.db.get(a.userId)) === null) {
          orphanedAccounts++;
          providers.push(a.provider);
        }
      }
      scanned = 0;
      for await (const s of ctx.db.query("authSessions")) {
        if (++scanned > DRY_RUN_SCAN_CAP) break;
        if ((await ctx.db.get(s.userId)) === null) orphanedSessions++;
      }
      return {
        dryRun: true as const,
        orphanedAccounts,
        orphanedSessions,
        accountProviders: providers,
      };
    }
    await ctx.scheduler.runAfter(0, internal.admin.sweepOrphanedAuth, {
      table: "authAccounts",
      cursor: null,
      deleted: 0,
    });
    return { dryRun: false as const, started: true };
  },
});

/**
 * One page of the orphaned-auth sweep: authAccounts first (+ their pending
 * verification codes), then authSessions (+ their refresh tokens, via the
 * sessionId index). Reschedules itself until both tables are done.
 */
export const sweepOrphanedAuth = internalMutation({
  args: {
    table: v.union(v.literal("authAccounts"), v.literal("authSessions")),
    cursor: v.union(v.string(), v.null()),
    deleted: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { table, cursor, deleted }) => {
    let n = deleted;
    if (table === "authAccounts") {
      const res = await ctx.db
        .query("authAccounts")
        .paginate({ numItems: 200, cursor });
      for (const a of res.page) {
        if ((await ctx.db.get(a.userId)) !== null) continue;
        for (const c of await ctx.db
          .query("authVerificationCodes")
          .withIndex("accountId", (q) => q.eq("accountId", a._id))
          .take(100)) {
          await ctx.db.delete(c._id);
        }
        await ctx.db.delete(a._id);
        n++;
      }
      await ctx.scheduler.runAfter(0, internal.admin.sweepOrphanedAuth, {
        table: res.isDone ? "authSessions" : "authAccounts",
        cursor: res.isDone ? null : res.continueCursor,
        deleted: n,
      });
      return null;
    }

    const res = await ctx.db
      .query("authSessions")
      .paginate({ numItems: 100, cursor });
    for (const s of res.page) {
      if ((await ctx.db.get(s.userId)) !== null) continue;
      for (const rt of await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
        .take(2000)) {
        await ctx.db.delete(rt._id);
      }
      await ctx.db.delete(s._id);
      n++;
    }
    if (!res.isDone) {
      await ctx.scheduler.runAfter(0, internal.admin.sweepOrphanedAuth, {
        table: "authSessions",
        cursor: res.continueCursor,
        deleted: n,
      });
    } else {
      console.log(`[admin] sweepOrphanedAuth finished — deleted ${n} rows`);
    }
    return null;
  },
});

import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

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
    segmentCount: s.segments.length,
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
      segments: session.segments,
    };
  },
});

import { internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * THE account-deletion cascade — shared by users.deleteAccount (self-serve,
 * GDPR Art. 17), the admin "Delete user" action, and the test-user cleanup, so
 * the three can never drift apart.
 *
 * Two phases, because one transaction can't hold it all (Convex caps a mutation
 * at ~16k document writes / 16 MiB, and a single 3-hour dars is thousands of
 * transcriptSegments rows):
 *
 *  1. deleteUserIdentity — synchronous, in the caller's transaction: every
 *     identity/billing/preference row plus the user row itself. After this
 *     commits the account is gone and can't sign in; the client's signOut()
 *     follows.
 *  2. purgeUserData — scheduled (runAfter 0, so it starts as soon as phase 1
 *     commits, and ONLY if it commits). Deletes the user's sessions one at a
 *     time — each session's transcriptSegments in batches, then the session
 *     doc — and then their raw usage events, rescheduling itself until nothing
 *     is left. One session per run keeps reads bounded even for legacy session
 *     docs that carry a ~1 MiB inline transcript.
 *
 * Before this module, deleteAccount deleted session docs but left every
 * transcriptSegments row behind — the actual transcript text survived an
 * "erase my data" request.
 */

/** Segment rows deleted per purge run. */
const SEGMENT_BATCH = 1000;
/** Usage-event rows deleted per purge run. */
const EVENT_BATCH = 1000;

/** Delete a session's transcript rows (one batch); true when none remain. */
async function deleteSegmentBatch(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
): Promise<boolean> {
  const rows = await ctx.db
    .query("transcriptSegments")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .take(SEGMENT_BATCH);
  for (const r of rows) await ctx.db.delete("transcriptSegments", r._id);
  return rows.length < SEGMENT_BATCH;
}

/**
 * Phase 1. Deletes identity rows + the user row, then schedules the data purge.
 * Safe to call for a user whose row is already gone (still purges their data).
 */
export async function deleteUserIdentity(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get("users", userId);

  // Account links (password / Google) + any pending verification codes on them
  // (those rows store the email address).
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .take(50);
  const rateLimitIdentifiers: string[] = user?.email ? [user.email] : [];
  for (const acc of accounts) {
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", acc._id))
      .take(100);
    for (const c of codes) await ctx.db.delete("authVerificationCodes", c._id);
    rateLimitIdentifiers.push(acc._id);
    await ctx.db.delete("authAccounts", acc._id);
  }

  // Sign-in throttle rows are keyed by account id (password) or email (OTP).
  for (const identifier of rateLimitIdentifiers) {
    const limits = await ctx.db
      .query("authRateLimits")
      .withIndex("identifier", (q) => q.eq("identifier", identifier))
      .take(10);
    for (const l of limits) await ctx.db.delete("authRateLimits", l._id);
  }

  // Auth sessions + the refresh tokens hanging off them, via the sessionId
  // index (never a whole-table scan — authRefreshTokens grows with global auth
  // activity), so a surviving refresh token can't mint access tokens for the
  // deleted identity.
  const authSessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .take(200);
  for (const s of authSessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
      .take(4000);
    for (const rt of tokens) await ctx.db.delete("authRefreshTokens", rt._id);
    await ctx.db.delete("authSessions", s._id);
  }

  // Small per-user rows (0–few each).
  for (const p of await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(10)) {
    await ctx.db.delete("userPreferences", p._id);
  }
  // NOTE: deleting the billing row does NOT cancel a live Stripe subscription
  // (a mutation can't call Stripe). The admin delete refuses users with an
  // active/trialing subscription for exactly this reason.
  for (const s of await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(10)) {
    await ctx.db.delete("subscriptions", s._id);
  }
  for (const g of await ctx.db
    .query("planGrants")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(100)) {
    await ctx.db.delete("planGrants", g._id);
  }
  for (const st of await ctx.db
    .query("adminUserStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(10)) {
    await ctx.db.delete("adminUserStats", st._id);
  }
  for (const m of await ctx.db
    .query("usageUserMonthly")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(500)) {
    await ctx.db.delete("usageUserMonthly", m._id);
  }

  if (user) await ctx.db.delete("users", userId);

  await ctx.scheduler.runAfter(0, internal.userData.purgeUserData, { userId });
}

/**
 * Phase 2 (scheduled). One session per run, then usage events, rescheduling
 * until done. Refuses to run while the user row still exists, so it can never
 * be pointed at a live account by mistake.
 */
export const purgeUserData = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    if ((await ctx.db.get("users", userId)) !== null) return null;

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (session) {
      const segmentsDone = await deleteSegmentBatch(ctx, session._id);
      if (segmentsDone) await ctx.db.delete("sessions", session._id);
      await ctx.scheduler.runAfter(0, internal.userData.purgeUserData, {
        userId,
      });
      return null;
    }

    const events = await ctx.db
      .query("usageEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(EVENT_BATCH);
    for (const e of events) await ctx.db.delete("usageEvents", e._id);
    if (events.length === EVENT_BATCH) {
      await ctx.scheduler.runAfter(0, internal.userData.purgeUserData, {
        userId,
      });
    }
    return null;
  },
});

/**
 * Delete ONE session and its transcript rows from inside a larger mutation:
 * deletes the first batch of segments now and, if more remain, hands the rest
 * to the scheduled purgeSession so the caller's transaction stays bounded.
 */
export async function deleteSessionCascade(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
): Promise<void> {
  const done = await deleteSegmentBatch(ctx, sessionId);
  if (done) {
    await ctx.db.delete("sessions", sessionId);
  } else {
    await ctx.scheduler.runAfter(0, internal.userData.purgeSession, {
      sessionId,
    });
  }
}

/** Scheduled continuation of deleteSessionCascade for very long transcripts. */
export const purgeSession = internalMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const done = await deleteSegmentBatch(ctx, sessionId);
    if (done) {
      if (await ctx.db.get("sessions", sessionId)) {
        await ctx.db.delete("sessions", sessionId);
      }
    } else {
      await ctx.scheduler.runAfter(0, internal.userData.purgeSession, {
        sessionId,
      });
    }
    return null;
  },
});

import { internalMutation, type MutationCtx } from "./_generated/server";
import { ConvexError } from "convex/values";
import { EMAIL_CODE_PROVIDER_ID } from "./emailCode";
import { deleteUserIdentity } from "./userData";

/**
 * Email-code housekeeping: the per-address send limit and the daily cleanup.
 *
 * Convex Auth throttles failed code VERIFICATIONS (10/hour per address) but not
 * SENDS, so without this anyone could make us email an address on a loop —
 * mailbox spam that also burns Resend quota and the sending domain's reputation.
 */

/** Codes one address may be sent per window (sign-in + reset combined). */
export const CODE_SEND_LIMIT = 5;
export const CODE_SEND_WINDOW_MS = 15 * 60 * 1000;

/**
 * Records a code send to `identifier`, or throws `too_many_codes` when the
 * address is over the limit.
 *
 * Called from the createOrUpdateUser callback (authLinking.ts) at send time —
 * inside the same mutation that writes the new code. Throwing there rolls the
 * whole thing back, so a refused send also leaves the code already in the
 * user's inbox valid (each send otherwise replaces the previous code).
 */
export async function enforceCodeSendLimit(
  ctx: MutationCtx,
  identifier: string,
): Promise<void> {
  const now = Date.now();
  const recent = await ctx.db
    .query("authCodeSends")
    .withIndex("by_identifier_and_sentAt", (q) =>
      q.eq("identifier", identifier).gt("sentAt", now - CODE_SEND_WINDOW_MS),
    )
    .take(CODE_SEND_LIMIT);
  if (recent.length >= CODE_SEND_LIMIT) {
    throw new ConvexError({ code: "too_many_codes" });
  }
  await ctx.db.insert("authCodeSends", { identifier, sentAt: now });
}

/** Send-log rows older than this are no longer needed for the limit. */
const SEND_LOG_TTL_MS = 24 * 60 * 60 * 1000;
/** Sign-ups abandoned before entering their code are removed in this age band. */
const ABANDONED_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const ABANDONED_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const BATCH = 200;

/**
 * Daily cron. Two jobs:
 *
 * 1. Drop send-log rows older than a day.
 * 2. Remove abandoned email-code sign-ups. Convex Auth creates the user row
 *    when the code is SENT, not when it's verified — so every typo'd or
 *    never-finished address leaves a user behind (a stranger's email in our
 *    users table, and a phantom "signup" in the admin metrics). A user is
 *    abandoned when ALL of: created 24–72h ago, email never verified, every
 *    account is an email-code account, and no auth session was ever opened.
 *    A password or Google user who merely requested a code has another
 *    account (or a verified email) and is never touched. The 48h band gives
 *    each user two daily passes while keeping the read bounded.
 */
export const pruneAuthCodes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const oldSends = await ctx.db
      .query("authCodeSends")
      .withIndex("by_sentAt", (q) => q.lt("sentAt", now - SEND_LOG_TTL_MS))
      .take(BATCH);
    for (const row of oldSends) await ctx.db.delete("authCodeSends", row._id);

    const candidates = await ctx.db
      .query("users")
      .withIndex("by_creation_time", (q) =>
        q
          .gt("_creationTime", now - ABANDONED_MAX_AGE_MS)
          .lt("_creationTime", now - ABANDONED_MIN_AGE_MS),
      )
      .take(BATCH);
    let removed = 0;
    for (const user of candidates) {
      if (user.emailVerificationTime !== undefined) continue;
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id))
        .take(10);
      if (
        accounts.length === 0 ||
        accounts.some((a) => a.provider !== EMAIL_CODE_PROVIDER_ID)
      ) {
        continue;
      }
      const session = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", user._id))
        .first();
      if (session !== null) continue;
      await deleteUserIdentity(ctx, user._id);
      removed++;
    }
    if (removed > 0) {
      console.log(`[authThrottle] removed ${removed} abandoned email-code sign-up(s)`);
    }
    return null;
  },
});

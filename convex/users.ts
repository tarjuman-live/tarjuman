import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";

/**
 * Whether an email/password account exists for the given email.
 *
 * The forgot-password flow uses this to tell apart "no password account —
 * probably a Google sign-in" from "account exists but the reset email failed
 * to send." Without it, the client can only see the production-redacted
 * "Server Error" and would guess wrong. Mirrors the exact lookup Convex Auth
 * does on reset (provider "password" + the trimmed email), so this agrees with
 * whether the reset would actually find the account.
 */
export const hasPasswordAccount = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email.trim())
      )
      .first();
    return account !== null;
  },
});

/**
 * Returns the currently signed-in user's profile, or null if signed-out.
 * The client uses this to render the user's name/avatar in the nav and to
 * decide whether to render the auth-guarded app shell.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      image: user.image,
    };
  },
});

/**
 * Updates the signed-in user's display name. The name shows in the account
 * menu/avatar and on the settings page. Empty names are rejected so the UI
 * always has something to render.
 */
export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name cannot be empty");
    await ctx.db.patch(userId, { name: trimmed });
  },
});

/**
 * Deletes the signed-in user's account and all their session data.
 *
 * GDPR Art. 17 (right to erasure) requires this. Cascade-deletes:
 *  - Every row in `sessions` owned by this user
 *  - The Convex Auth identity rows (auth tokens, account links, etc. —
 *    Convex Auth's `authTables` includes these; we delete the user row
 *    and Convex Auth's internal cleanup handles credential rows on
 *    next login attempt; for absolute cleanup the user can also email
 *    support to wipe orphaned auth rows).
 *  - The user row itself.
 *
 * This mutation is final — there is no soft-delete or undo.
 */
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Delete every session belonging to this user.
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    // Delete account-link rows so the email/Google identity can be re-used
    // on a fresh signup. authTables's `authAccounts` is keyed by the user.
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();
    for (const acc of accounts) {
      await ctx.db.delete(acc._id);
    }

    // Auth sessions (authTables) + the refresh tokens that hang off them — so a
    // surviving refresh token can't keep minting access tokens for the now-deleted
    // identity (closing the "dead-identity window"). Mirrors admin.ts cleanup.
    const authSessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const killedSessionIds = new Set<Id<"authSessions">>();
    for (const s of authSessions) {
      killedSessionIds.add(s._id);
      await ctx.db.delete(s._id);
    }
    for (const rt of await ctx.db.query("authRefreshTokens").collect()) {
      if (killedSessionIds.has(rt.sessionId)) {
        await ctx.db.delete(rt._id);
      }
    }

    // Per-user preferences row (one or none).
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const p of prefs) {
      await ctx.db.delete(p._id);
    }

    await ctx.db.delete(userId);
  },
});

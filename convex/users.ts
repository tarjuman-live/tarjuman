import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";
import { isAdminId } from "./adminAuth";
import { deleteUserIdentity } from "./userData";

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
      // Operator flag (ADMIN_USER_IDS allowlist — see adminAuth.ts). Only
      // shows/hides the /admin entry points; every admin function re-checks
      // on the server. isAdminId never throws (this query sits on every AI
      // route's auth path).
      isAdmin: isAdminId(user._id),
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
 * Profile picture upload (Convex file storage). The client asks for a
 * short-lived upload URL, POSTs the image bytes to it, then hands back the
 * resulting storageId so we can resolve a served URL and store it on the user.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Set the signed-in user's profile image from a completed upload. Patches the
 * `image` field on the authTables `users` doc — the same field OAuth (Google)
 * populates — so the avatar everywhere (account menu, settings) picks it up
 * reactively via `me`.
 */
export const setProfileImage = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Uploaded image not found");
    await ctx.db.patch(userId, { image: url });
  },
});

/**
 * Deletes the signed-in user's account and all their data (GDPR Art. 17).
 *
 * Delegates to the shared cascade in userData.ts: identity, billing,
 * preference and grant rows plus the user row go now (this transaction);
 * every session AND its transcriptSegments rows, and the user's raw usage
 * events, are purged by a scheduled job that starts the moment this commits.
 * (Previously the transcript rows were left behind.)
 *
 * NOTE: this does not cancel a live Stripe subscription — a mutation can't call
 * Stripe. Once billing is live, cancel via Stripe in an action first.
 *
 * Final — there is no soft-delete or undo.
 */
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await deleteUserIdentity(ctx, userId);
  },
});


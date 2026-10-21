import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Who is an operator ("admin") — the single gate for everything under /admin.
 *
 * Admins are listed BY CONVEX USER ID in the deployment env var
 * `ADMIN_USER_IDS` (comma-separated `users._id` values):
 *
 *   bunx convex env set ADMIN_USER_IDS <id>           # dev
 *   bunx convex env set --prod ADMIN_USER_IDS <id>    # prod
 *
 * ⚠️ NEVER gate on email, even "verified" email. Password sign-up never links
 * to an existing Google account (convex/auth.ts sets no `verify`), so anyone can
 * create a SECOND users row carrying the owner's address, and the password-reset
 * flow then stamps `emailVerificationTime` on that row
 * (@convex-dev/auth Password.js "reset-verification" → verifyCodeAndSignIn →
 * upsertUserAndAccount with emailVerified:true). An email check would be only
 * as strong as a 6-digit reset code. A user _id cannot be claimed that way.
 *
 * Fails CLOSED: unset/empty env → nobody is an admin.
 */

/** Parse the comma-separated allowlist. Pure; never throws. */
export function parseAdminIds(raw: string | undefined): Set<string> {
  const ids = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const id = part.trim();
    if (id) ids.add(id);
  }
  return ids;
}

/** The current deployment's admin ids. */
export function adminIds(): Set<string> {
  return parseAdminIds(process.env.ADMIN_USER_IDS);
}

/**
 * Is this user id an admin? Never throws — `users.me` calls it and sits on
 * every AI API route's auth path (src/lib/api-auth.ts), so an exception here
 * would 401 the whole app.
 */
export function isAdminId(
  userId: string | null | undefined,
  raw: string | undefined = process.env.ADMIN_USER_IDS,
): boolean {
  if (!userId) return false;
  return parseAdminIds(raw).has(userId);
}

/**
 * The signed-in admin's user row, or throws "Not authorized". Use as the first
 * line of EVERY public admin query/mutation. Requires the row to still exist
 * (a valid JWT for a deleted user must not keep admin powers).
 */
export async function requireAdmin(ctx: QueryCtx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId || !isAdminId(userId)) throw new ConvexError("Not authorized");
  const user = await ctx.db.get("users", userId);
  if (!user) throw new ConvexError("Not authorized");
  return user;
}

/** Action-side gate (actions have no db; the id allowlist is the authority). */
export async function requireAdminAction(
  ctx: ActionCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId || !isAdminId(userId)) throw new ConvexError("Not authorized");
  return userId;
}

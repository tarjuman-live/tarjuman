import { internalMutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Effective plan = Stripe Pro OR an active complimentary grant (planGrants).
 *
 * The single read path for "is this user Pro?" — subscriptions.getMySubscription
 * and getMyUsageThisMonth both go through it, so every gate (web, iOS, and the
 * API cost gate via src/lib/api-auth.ts:getUsageFromHeader) honours comps with
 * no other change. Stripe stays the source of truth for PAID state; grants are
 * an overlay that never touches the `subscriptions` row the webhook owns.
 */

export type PlanSource = "stripe" | "grant" | "none";

/** A grant counts while not revoked, not expired, and (if timed) not past due. */
export function isGrantActive(g: Doc<"planGrants">, now: number): boolean {
  if (g.revokedAt !== undefined || g.expiredAt !== undefined) return false;
  return g.expiresAt === undefined || g.expiresAt > now;
}

/** The user's currently-active grant, if any (most recent first). */
export async function getActiveGrant(
  ctx: QueryCtx,
  userId: Id<"users">,
  now: number = Date.now(),
): Promise<Doc<"planGrants"> | null> {
  const grants = await ctx.db
    .query("planGrants")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(20);
  return grants.find((g) => isGrantActive(g, now)) ?? null;
}

export async function getEffectivePlan(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<{
  plan: "free" | "pro";
  source: PlanSource;
  sub: Doc<"subscriptions"> | null;
  grant: Doc<"planGrants"> | null;
}> {
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const grant = await getActiveGrant(ctx, userId);
  const stripePro = sub?.plan === "pro";
  return {
    plan: stripePro || grant ? "pro" : "free",
    source: stripePro ? "stripe" : grant ? "grant" : "none",
    sub,
    grant,
  };
}

/**
 * Scheduled at grant time for `expiresAt`. Patching `expiredAt` invalidates the
 * cached reactive plan queries so an open tab drops to Free at expiry (a query
 * comparing against Date.now() alone would keep serving "pro" until something
 * else changed). Idempotent: a revoked/already-expired grant is left alone.
 */
export const expireGrant = internalMutation({
  args: { grantId: v.id("planGrants") },
  returns: v.null(),
  handler: async (ctx, { grantId }) => {
    const grant = await ctx.db.get("planGrants", grantId);
    if (!grant) return null;
    if (grant.revokedAt !== undefined || grant.expiredAt !== undefined) {
      return null;
    }
    if (grant.expiresAt === undefined || grant.expiresAt > Date.now()) {
      return null;
    }
    await ctx.db.patch("planGrants", grantId, { expiredAt: Date.now() });
    return null;
  },
});

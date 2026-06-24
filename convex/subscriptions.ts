import { query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";
import { planFromStatus } from "./stripeClient";
import { PLAN_LIMITS, monthStartMs, limitForWire, atLimit } from "./billingLimits";

/**
 * Billing state for the current user. Read-side is a reactive query so the
 * Settings page flips Free → Pro live the moment the Stripe webhook lands.
 * Write-side is internal-only: the public surface is the `stripe.ts` actions
 * (Checkout / Portal) and the `/stripe/webhook` httpAction — never the client.
 *
 * `plan` is always DERIVED from Stripe `status` (active/trialing → pro) so a
 * re-delivered or out-of-order webhook converges to the same state. See
 * stripeClient.ts:planFromStatus.
 */

const statusValidator = v.union(
  v.literal("active"),
  v.literal("trialing"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("incomplete")
);

// ─── Read (client-facing) ────────────────────────────────────────────────────

export const getMySubscription = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null; // gentle: page may render before auth settles
    const row = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!row) return { plan: "free" as const, status: null };
    return {
      plan: row.plan,
      status: row.status,
      currentPeriodEnd: row.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
    };
  },
});

/**
 * This-month usage + entitlements for the current user — the reactive source of
 * truth behind the record/summary gates and the Settings usage line. Plan is
 * read from the subscription row (default "free"); limits come from
 * billingLimits.ts.
 *
 * Pro/Scholar are unlimited, so we SHORT-CIRCUIT without counting (cheap for the
 * paying majority). Only free users pay for the count, and they have ≤ a handful
 * of sessions/month, so the date-bounded read is tiny. Unlimited limits go over
 * the wire as `null` (Infinity isn't a valid Convex value).
 *
 * Returns null when unauthenticated (page may render before auth settles).
 */
export const getMyUsageThisMonth = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const plan = sub?.plan ?? "free";
    const limits = PLAN_LIMITS[plan];

    if (plan !== "free") {
      // Unlimited tier — no need to scan sessions.
      return {
        plan,
        sessionsUsed: 0,
        summariesUsed: 0,
        sessionsLimit: limitForWire(limits.sessionsPerMonth),
        summariesLimit: limitForWire(limits.summariesPerMonth),
        canStartSession: true,
        canSummarize: true,
      };
    }

    const monthStart = monthStartMs(Date.now());
    // Only this month's rows (cheap for free users). Counting summaries among
    // this month's sessions is intentionally lenient — a summary generated this
    // month on an older session won't count, which only ever favors the user.
    const thisMonth = await ctx.db
      .query("sessions")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("createdAt", monthStart)
      )
      .collect();

    const sessionsUsed = thisMonth.filter(
      (s) => s.status === "completed" && s.segments.length > 0
    ).length;
    const summariesUsed = thisMonth.filter(
      (s) => (s.summaryGeneratedAt ?? 0) >= monthStart
    ).length;

    return {
      plan,
      sessionsUsed,
      summariesUsed,
      sessionsLimit: limitForWire(limits.sessionsPerMonth),
      summariesLimit: limitForWire(limits.summariesPerMonth),
      canStartSession: !atLimit(sessionsUsed, limits.sessionsPerMonth),
      canSummarize: !atLimit(summariesUsed, limits.summariesPerMonth),
    };
  },
});

// ─── Internal (used by the Stripe actions / webhook) ─────────────────────────

/** The action needs the existing Stripe customer id (if any) to reuse it. */
export const getMineInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

/**
 * Stash the Stripe customer id for a user the first time they reach Checkout.
 * Creates a "free" placeholder row so the webhook always has a row to patch
 * (looked up by_customer). Idempotent — re-running just patches the id.
 */
export const linkCustomer = internalMutation({
  args: { userId: v.id("users"), stripeCustomerId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        stripeCustomerId: args.stripeCustomerId,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.insert("subscriptions", {
      userId: args.userId,
      stripeCustomerId: args.stripeCustomerId,
      plan: "free",
      status: "incomplete",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Apply a Stripe subscription's state to our row (keyed by customer). Called
 * from the webhook. `status` arrives already narrowed to our five literals
 * (see stripeClient.ts:mapStatus); `plan` is derived here so it can't drift.
 */
export const upsertFromStripe = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    subscriptionId: v.optional(v.string()),
    priceId: v.optional(v.string()),
    status: statusValidator,
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("subscriptions")
      .withIndex("by_customer", (q) =>
        q.eq("stripeCustomerId", args.stripeCustomerId)
      )
      .unique();
    if (!row) {
      // Should not happen — linkCustomer always runs before Checkout. Bail
      // quietly (Stripe will retry; a missing row means we never saw this
      // customer, so there's nothing to entitle).
      return;
    }
    await ctx.db.patch(row._id, {
      subscriptionId: args.subscriptionId,
      priceId: args.priceId,
      status: args.status,
      plan: planFromStatus(args.status),
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
      updatedAt: Date.now(),
    });
  },
});

import { query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";
import { planFromStatus } from "./stripeClient";
import { getEffectivePlan } from "./entitlements";
import {
  PLAN_LIMITS,
  monthStartMs,
  usageMonthKey,
  buildUsage,
  BILLING_ENABLED,
  type PlanUsageWire,
} from "./billingLimits";

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
    // Effective plan = Stripe Pro OR an operator-granted comp (planGrants).
    // `comped` tells the billing UI not to send a comped user into Stripe
    // manage/cancel flows they have no subscription for.
    const { plan, source, sub: row, grant } = await getEffectivePlan(
      ctx,
      userId,
    );
    const comped = source === "grant";
    const compExpiresAt = comped ? (grant?.expiresAt ?? null) : null;
    if (!row) {
      return { plan, status: null, comped, compExpiresAt };
    }
    return {
      plan,
      status: row.status,
      currentPeriodEnd: row.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
      comped,
      compExpiresAt,
    };
  },
});

/**
 * This-month usage + entitlements for the current user — the reactive source of
 * truth behind the record/summary gates and the Settings usage line. Plan is
 * the EFFECTIVE plan (Stripe Pro or an active comp grant — entitlements.ts);
 * limits come from billingLimits.ts, and the shape from buildUsage there.
 *
 * Recording time is metered on EVERY tier (Free 1h · Pro 3h a month), read from
 * the recordingUsage ledger — one indexed row, no session scan. Only a tier
 * with a finite session/summary cap (Free's summaries) pays for the date-bounded
 * session read, and a free user has a handful of sessions a month.
 *
 * The in-progress recording is NOT in the ledger until it completes, so the
 * record page compares its live timer against `recordingSecondsRemaining`
 * without double counting.
 *
 * Returns null when unauthenticated (page may render before auth settles).
 */
export const getMyUsageThisMonth = query({
  args: {},
  handler: async (ctx): Promise<PlanUsageWire | null> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;

    // Stripe Pro OR an active complimentary grant — see entitlements.ts.
    const { plan } = await getEffectivePlan(ctx, userId);

    // Billing not live yet (BILLING_ENABLED=false) → everyone is unlimited,
    // because the caps only mean anything once we can take money. Skip every
    // read; buildUsage reports null limits, which also hides the meters.
    if (!BILLING_ENABLED) {
      return buildUsage({
        plan,
        billingEnabled: false,
        sessionsUsed: 0,
        summariesUsed: 0,
        recordingSecondsUsed: 0,
      });
    }

    const now = Date.now();
    const limits = PLAN_LIMITS[plan];
    const ledger = await ctx.db
      .query("recordingUsage")
      .withIndex("by_userId_and_month", (q) =>
        q.eq("userId", userId).eq("month", usageMonthKey(now)),
      )
      .unique();

    let sessionsUsed = 0;
    let summariesUsed = 0;
    if (
      Number.isFinite(limits.sessionsPerMonth) ||
      Number.isFinite(limits.summariesPerMonth)
    ) {
      const monthStart = monthStartMs(now);
      // Only this month's rows. Counting summaries among this month's sessions
      // is intentionally lenient — a summary generated this month on an older
      // session won't count, which only ever favors the user.
      const thisMonth = await ctx.db
        .query("sessions")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("createdAt", monthStart)
        )
        .collect();
      // segmentCount, not segments.length: since segments moved to the
      // transcriptSegments table, new sessions keep the inline array EMPTY.
      // Legacy rows (no segmentCount) fall back to the inline length.
      sessionsUsed = thisMonth.filter(
        (s) =>
          s.status === "completed" &&
          (s.segmentCount ?? s.segments.length) > 0
      ).length;
      summariesUsed = thisMonth.filter(
        (s) => (s.summaryGeneratedAt ?? 0) >= monthStart
      ).length;
    }

    return buildUsage({
      plan,
      billingEnabled: true,
      sessionsUsed,
      summariesUsed,
      recordingSecondsUsed: ledger?.seconds ?? 0,
    });
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

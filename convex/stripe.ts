import { action } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";
import { internal } from "./_generated/api";
import { getStripe, getPriceId } from "./stripeClient";

/**
 * Client-facing Stripe actions. Called from Settings via `useAction`, so they
 * run authenticated — `auth.getUserId(ctx)` yields the signed-in user with no
 * Bearer-token plumbing. Each returns a `{ url }` the client redirects to.
 *
 * Test-mode experiment: a single "Pro" recurring price (STRIPE_PRICE_ID).
 */

/** Use the caller's real origin (localhost:3000 in dev, prod domain live). */
function normalizeOrigin(origin: string): string {
  const fallback = (process.env.SITE_URL ?? "https://tarjuman.live").replace(
    /\/$/,
    ""
  );
  if (!origin || !/^https?:\/\//.test(origin)) return fallback;
  return origin.replace(/\/$/, "");
}

export const createCheckoutSession = action({
  args: {
    origin: v.string(),
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const stripe = getStripe();

    // Reuse the user's Stripe customer if they've reached Checkout before,
    // else create one and stash the id (so the webhook can find this user).
    const existing = await ctx.runQuery(
      internal.subscriptions.getMineInternal,
      { userId }
    );
    let customerId = existing?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { userId },
      });
      customerId = customer.id;
      await ctx.runMutation(internal.subscriptions.linkCustomer, {
        userId,
        stripeCustomerId: customerId,
      });
    }

    const origin = normalizeOrigin(args.origin);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getPriceId(args.interval ?? "month"), quantity: 1 }],
      success_url: `${origin}/settings?upgraded=1`,
      cancel_url: `${origin}/settings`,
      allow_promotion_codes: true,
    });
    if (!session.url) throw new Error("Stripe did not return a Checkout URL");
    return { url: session.url };
  },
});

/**
 * Embedded (Custom Checkout) variant for the on-domain DARK checkout. Same
 * customer reuse/create as above, but `ui_mode: "custom"` returns a
 * `client_secret` the client mounts with <CheckoutElementsProvider> + the dark
 * Appearance API (Stripe-hosted Checkout can't be themed dark; Custom Checkout
 * can). Stripe still manages the subscription. On confirm, Stripe redirects to
 * `return_url`; the webhook flips the plan to Pro as usual.
 */
export const createElementsCheckout = action({
  args: {
    origin: v.string(),
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
  },
  handler: async (ctx, args): Promise<{ clientSecret: string }> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const stripe = getStripe();
    const existing = await ctx.runQuery(
      internal.subscriptions.getMineInternal,
      { userId }
    );
    let customerId = existing?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ metadata: { userId } });
      customerId = customer.id;
      await ctx.runMutation(internal.subscriptions.linkCustomer, {
        userId,
        stripeCustomerId: customerId,
      });
    }

    const origin = normalizeOrigin(args.origin);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getPriceId(args.interval ?? "month"), quantity: 1 }],
      // Elements ui_mode redirects here after confirm (no success_url/cancel_url).
      return_url: `${origin}/plans/complete?session_id={CHECKOUT_SESSION_ID}`,
      // `ui_mode: "elements"` is what the account's API version (2025-09-30.clover)
      // expects — `"custom"` was the older basil name and is rejected now. The
      // pinned stripe-node types don't include it, so we inject it via a spread
      // the types can't object to; runtime passes it straight through. This is
      // the session the React <CheckoutElementsProvider> consumes.
      ...({ ui_mode: "elements" } as object),
    });
    if (!session.client_secret) {
      throw new Error("Stripe did not return a client secret");
    }
    return { clientSecret: session.client_secret };
  },
});

export const createPortalSession = action({
  args: { origin: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.runQuery(
      internal.subscriptions.getMineInternal,
      { userId }
    );
    if (!existing?.stripeCustomerId) {
      throw new Error("No billing account yet — upgrade first.");
    }

    const stripe = getStripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer: existing.stripeCustomerId,
      return_url: `${normalizeOrigin(args.origin)}/settings`,
    });
    return { url: portal.url };
  },
});

// ─── In-app dark billing management ──────────────────────────────────────────
// These power /plans/manage — a fully on-brand DARK billing screen that
// replaces the Stripe-hosted Customer Portal (which is white and can't be
// themed dark). Status/cancel/resume come from these actions + the reactive
// getMySubscription query; card updates use a SetupIntent + the dark
// PaymentElement, then setDefaultPaymentMethod points the customer +
// subscription at the new card.

/** Card brand/last4 + the current price, read live from Stripe for the UI. */
export const getBillingDetails = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    card: { brand: string; last4: string } | null;
    amount: number | null;
    interval: string | null;
  }> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const row = await ctx.runQuery(internal.subscriptions.getMineInternal, {
      userId,
    });
    if (!row?.subscriptionId) return { card: null, amount: null, interval: null };

    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(row.subscriptionId, {
      expand: ["default_payment_method", "items.data.price"],
    });
    const price = sub.items.data[0]?.price;
    const amount = price?.unit_amount ?? null;
    const interval = price?.recurring?.interval ?? null;

    let card: { brand: string; last4: string } | null = null;
    const pm = sub.default_payment_method;
    if (pm && typeof pm !== "string" && pm.card) {
      card = { brand: pm.card.brand, last4: pm.card.last4 };
    }
    // Fall back to the customer's default card if the subscription has none set.
    if (!card && typeof sub.customer === "string") {
      const cust = await stripe.customers.retrieve(sub.customer, {
        expand: ["invoice_settings.default_payment_method"],
      });
      if (cust && !cust.deleted) {
        const cpm = cust.invoice_settings?.default_payment_method;
        if (cpm && typeof cpm !== "string" && cpm.card) {
          card = { brand: cpm.card.brand, last4: cpm.card.last4 };
        }
      }
    }
    return { card, amount, interval };
  },
});

/** Cancel at period end (keeps access until the period they've paid for ends). */
export const cancelSubscription = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const row = await ctx.runQuery(internal.subscriptions.getMineInternal, {
      userId,
    });
    if (!row?.subscriptionId) throw new Error("No active subscription.");
    const stripe = getStripe();
    await stripe.subscriptions.update(row.subscriptionId, {
      cancel_at_period_end: true,
    });
    // The subscription.updated webhook flips cancelAtPeriodEnd in our DB, which
    // getMySubscription reflects reactively.
  },
});

/** Undo a pending cancellation. */
export const resumeSubscription = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const row = await ctx.runQuery(internal.subscriptions.getMineInternal, {
      userId,
    });
    if (!row?.subscriptionId) throw new Error("No subscription to resume.");
    const stripe = getStripe();
    await stripe.subscriptions.update(row.subscriptionId, {
      cancel_at_period_end: false,
    });
  },
});

/** SetupIntent client secret for collecting a new card via the dark PaymentElement. */
export const createSetupIntent = action({
  args: {},
  handler: async (ctx): Promise<{ clientSecret: string }> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const row = await ctx.runQuery(internal.subscriptions.getMineInternal, {
      userId,
    });
    if (!row?.stripeCustomerId) throw new Error("No billing account yet.");
    const stripe = getStripe();
    const si = await stripe.setupIntents.create({
      customer: row.stripeCustomerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });
    if (!si.client_secret) {
      throw new Error("Stripe did not return a client secret");
    }
    return { clientSecret: si.client_secret };
  },
});

/** After a SetupIntent succeeds, make the new card the default for both the
 *  customer and the active subscription (so the next invoice charges it). */
export const setDefaultPaymentMethod = action({
  args: { paymentMethodId: v.string() },
  handler: async (ctx, { paymentMethodId }): Promise<void> => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const row = await ctx.runQuery(internal.subscriptions.getMineInternal, {
      userId,
    });
    if (!row?.stripeCustomerId) throw new Error("No billing account yet.");
    const stripe = getStripe();
    await stripe.customers.update(row.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    if (row.subscriptionId) {
      await stripe.subscriptions.update(row.subscriptionId, {
        default_payment_method: paymentMethodId,
      });
    }
  },
});

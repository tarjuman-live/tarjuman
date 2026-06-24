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

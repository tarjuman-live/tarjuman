import Stripe from "stripe";

/**
 * Shared Stripe client for the Convex backend (used by the billing actions in
 * `stripe.ts` and the webhook in `http.ts`).
 *
 * Runs in Convex's DEFAULT runtime (not `"use node"`): we pass
 * `Stripe.createFetchHttpClient()` so the SDK uses `fetch` instead of Node's
 * `http`, and webhook signature verification uses `constructEventAsync` +
 * `Stripe.createSubtleCryptoProvider()` (Web Crypto) — see `http.ts`.
 *
 * `STRIPE_SECRET_KEY` is a Convex env var (set via `npx convex env set`), never
 * committed and never shipped to the client. This is the TEST-mode key while we
 * experiment locally.
 */
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set on the Convex deployment. Run: npx convex env set STRIPE_SECRET_KEY sk_test_…"
    );
  }
  cached = new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  return cached;
}

/**
 * The recurring price the Upgrade button subscribes to (Convex env var).
 * Monthly → STRIPE_PRICE_ID; annual → STRIPE_PRICE_ID_ANNUAL. The annual price
 * must be created in Stripe (~30% off the monthly ×12) and set with
 * `npx convex env set STRIPE_PRICE_ID_ANNUAL price_…` before annual checkout works.
 */
export function getPriceId(interval: "month" | "year" = "month"): string {
  const name = interval === "year" ? "STRIPE_PRICE_ID_ANNUAL" : "STRIPE_PRICE_ID";
  const priceId = process.env[name];
  if (!priceId) {
    throw new Error(
      `${name} is not set on the Convex deployment. Run: npx convex env set ${name} price_…`
    );
  }
  return priceId;
}

/** Narrow Stripe's many subscription statuses to the five our schema stores. */
export type StoredStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

export function mapStatus(status: Stripe.Subscription.Status): StoredStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "incomplete":
      return "incomplete";
    // canceled, incomplete_expired, unpaid, paused → not entitled
    default:
      return "canceled";
  }
}

/** Pro only while the subscription is genuinely live. */
export function planFromStatus(status: StoredStatus): "free" | "pro" {
  return status === "active" || status === "trialing" ? "pro" : "free";
}

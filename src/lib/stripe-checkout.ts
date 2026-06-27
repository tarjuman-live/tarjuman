import { loadStripe, type Stripe, type Appearance } from "@stripe/stripe-js";
import { COLORS } from "@/lib/constants";

/**
 * Client-side Stripe helpers for the embedded (Custom Checkout) dark flow.
 *
 * `loadStripe` is called once at module scope per Stripe's guidance (the
 * resulting promise is cached). The publishable key is PUBLIC by design —
 * NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is inlined into the client bundle on
 * purpose (it is not the secret key).
 */
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
    );
  }
  return stripePromise;
}

export function hasStripeKey(): boolean {
  return !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
}

/**
 * Dark Appearance for the embedded checkout, matched to the Tarjuman palette.
 * `theme: 'night'` is Stripe's dark base; the variables pin it to our exact
 * greens/surfaces so the card form reads as part of the app, not a white island.
 */
export const DARK_APPEARANCE: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: COLORS.accent, // #2ECC71
    colorBackground: COLORS.surface, // #0E1525
    colorText: COLORS.w, // #F0F4F8
    colorTextSecondary: COLORS.t2, // #B0BEC5
    colorDanger: COLORS.red, // #EF4444
    fontFamily: '"DM Sans", system-ui, sans-serif',
    borderRadius: "12px",
    spacingUnit: "4px",
  },
};

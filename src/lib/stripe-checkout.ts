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
    colorTextPlaceholder: COLORS.t4, // muted placeholder
    colorDanger: COLORS.red, // #EF4444
    fontFamily: '"DM Sans", system-ui, sans-serif',
    borderRadius: "12px",
    spacingUnit: "4px",
  },
  // Pin the Stripe inputs/tabs to the app's tile look — dark tile background,
  // hairline border, and an accent-green focus ring — so the PaymentElement
  // reads as part of Tarjuman rather than a generic Stripe form.
  rules: {
    ".Input": {
      backgroundColor: COLORS.bg, // #060B18 (one step below the surface)
      border: `1px solid ${COLORS.borderLight}`,
    },
    ".Input:focus": {
      border: `1px solid ${COLORS.accent}`,
      boxShadow: `0 0 0 1px ${COLORS.accent}`,
    },
    ".Tab, .Block": {
      backgroundColor: COLORS.bg,
      border: `1px solid ${COLORS.borderLight}`,
    },
    ".Tab:hover": { border: `1px solid ${COLORS.accent}` },
    ".Tab--selected": {
      border: `1px solid ${COLORS.accent}`,
      boxShadow: `0 0 0 1px ${COLORS.accent}`,
    },
    ".Label": { color: COLORS.t2 },
  },
};

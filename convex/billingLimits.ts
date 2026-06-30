/**
 * Plan tiers + limits — the SINGLE SOURCE OF TRUTH for what each plan unlocks.
 *
 * Pure constants + pure helpers only (no Convex/Node imports) so this file is
 * safe to import from three places that must agree:
 *   - Convex functions (convex/subscriptions.ts) — compute server-side usage
 *   - Next.js API routes (/api/deepgram, /api/summarize) — enforce the cost gate
 *   - Client components (Settings, Record, SessionBody) — show usage + CTAs
 *
 * Tuning the product is a one-line edit here. The numbers below are the
 * post-discussion defaults (2026-06-24); they are deliberately easy to change
 * because real pricing/limits are a post-field-test decision.
 *
 * DESIGN NOTE — recording length is UNLIMITED on Pro/Scholar; Free is capped at
 * 2 hours per recording (founder decision 2026-06-30, reversing the earlier
 * "unlimited on every tier"). The unit of value is a *class*, not a minute, so
 * Pro never cuts off a 1–3h al-Badr dars; Free's 2h covers khutbahs but a long
 * duroos would hit the cap (upgrade nudge). NOTE: this 2h cap is currently
 * MARKETING-ONLY — it is not yet enforced anywhere (and nothing is enforced
 * while BILLING_ENABLED=false). Wire a per-tier length cap when billing goes
 * live. The global MAX_SESSION_HOURS below is a separate anti-runaway fuse.
 *
 * The `scholar` tier is forward-design: its hero feature (follow scholars +
 * class reminders) ships post-field-test, so `scholar` is config-only for now —
 * the DB `plan` union (schema.ts) is still just "free" | "pro". When Scholar
 * goes live we add the literal + a second Stripe price.
 */

export type Plan = "free" | "pro" | "scholar";

/**
 * MASTER BILLING SWITCH — while `false`, every user is treated as UNLIMITED:
 * the free-tier session/summary caps are not enforced, and no "Upgrade" wall or
 * usage meter appears anywhere. This is the single switch the record gate, the
 * summary gate, and the Settings usage line all key off — they all read
 * subscriptions.getMyUsageThisMonth, which honors this flag.
 *
 * WHY OFF (2026-06-29): Stripe is still test-mode and its webhook points at the
 * DEV Convex deployment, so a gated free user has NO working way to pay their
 * way out — and the founder + the 2026-07-03 field test must be able to record
 * and summarize without slamming into a 4-session wall. (A real test session
 * burned the free quota and locked the app behind a dead-end paywall.) Flip to
 * `true` only once billing can take REAL money in production (live Stripe keys
 * + prod webhook). See [[stripe-billing-experiment]] and [[plan-tiers-roadmap]].
 */
export const BILLING_ENABLED = false;

export interface PlanLimits {
  /** Max NEW sessions creatable per calendar month. Infinity = unlimited. */
  sessionsPerMonth: number;
  /** Max AI summaries generatable per calendar month. Infinity = unlimited. */
  summariesPerMonth: number;
  /** How many scholars a user can follow (future reminders feature). */
  scholarsFollowable: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { sessionsPerMonth: 4, summariesPerMonth: 4, scholarsFollowable: 0 },
  pro: {
    sessionsPerMonth: Infinity,
    summariesPerMonth: Infinity,
    scholarsFollowable: 5,
  },
  scholar: {
    sessionsPerMonth: Infinity,
    summariesPerMonth: Infinity,
    scholarsFollowable: Infinity,
  },
};

export interface PlanMeta {
  name: string;
  /** Monthly price in USD (0 for free). Keep in sync with the Stripe price. */
  priceMonthly: number;
  priceLabel: string;
  tagline: string;
  /** Bullet highlights for the /plans comparison cards. */
  highlights: string[];
  /** Not yet purchasable — show as "Coming soon", no checkout. */
  comingSoon?: boolean;
}

/**
 * Display metadata for the pricing UI. The single place a price string lives,
 * so the app never hardcodes a number that drifts from the Stripe price.
 * (Current Stripe sandbox price is $10/mo — see [[stripe-billing-experiment]].)
 */
export const PLAN_META: Record<Plan, PlanMeta> = {
  free: {
    name: "Free",
    priceMonthly: 0,
    priceLabel: "Free",
    tagline: "4 sessions & summaries / month",
    highlights: [
      "4 sessions per month",
      "4 AI summaries per month",
      "Recordings up to 2 hours",
      "Your full history, always",
    ],
  },
  pro: {
    name: "Pro",
    priceMonthly: 10,
    priceLabel: "$10 / month",
    tagline: "Unlimited sessions & summaries",
    highlights: [
      "Unlimited sessions",
      "Unlimited AI summaries",
      "Unlimited recording length",
      "Your full history, always",
    ],
  },
  scholar: {
    name: "Scholar",
    priceMonthly: 20,
    priceLabel: "$20 / month",
    tagline: "Everything unlimited + follow scholars",
    comingSoon: true,
    highlights: [
      "Everything in Pro",
      "Follow scholars + class reminders",
      "Unlimited scholars",
    ],
  },
};

/**
 * Anti-runaway fuse — NOT a product limit. A phone left recording (or a session
 * the user never stops) shouldn't bill us for hours of Deepgram. No real dars
 * approaches this; al-Badr's longest runs ~3h. Applies to every tier.
 */
export const MAX_SESSION_HOURS = 6;

/** Annual billing discount, advertised as "Save 30%". */
export const ANNUAL_DISCOUNT_PCT = 30;

/** Per-month price when billed annually (rounded). e.g. $10 → $7. */
export function annualPerMonth(monthly: number): number {
  return Math.round(monthly * (1 - ANNUAL_DISCOUNT_PCT / 100));
}

/** Total charged once per year — consistent with the displayed per-month. */
export function annualTotal(monthly: number): number {
  return annualPerMonth(monthly) * 12;
}

/** Start of the current calendar month in ms (UTC) — the monthly usage window. */
export function monthStartMs(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Infinity isn't a valid Convex/JSON value — surface unlimited as `null`. */
export function limitForWire(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** Has the user hit a (finite) limit? Unlimited (Infinity) is never hit. */
export function atLimit(used: number, limit: number): boolean {
  return Number.isFinite(limit) && used >= limit;
}

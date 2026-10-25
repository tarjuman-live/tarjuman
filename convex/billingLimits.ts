/**
 * Plan tiers + limits — the SINGLE SOURCE OF TRUTH for what each plan unlocks.
 *
 * Pure constants + pure helpers only (no Convex/Node imports) so this file is
 * safe to import from three places that must agree:
 *   - Convex functions (convex/subscriptions.ts) — compute server-side usage
 *   - Next.js API routes (/api/speechmatics, /api/deepgram, /api/summarize) —
 *     enforce the cost gate
 *   - Client components (Settings, Record, SessionBody) — show usage + CTAs
 *
 * Tuning the product is a one-line edit here. The numbers below are the
 * post-discussion defaults (2026-06-24); they are deliberately easy to change
 * because real pricing/limits are a post-field-test decision.
 *
 * DESIGN NOTE — the metered unit is RECORDING TIME PER MONTH (founder decision
 * 2026-10-21, replacing both "4 sessions/mo on Free" and "unlimited length on
 * paid"): Free 1h, Pro $5 → 3h, Scholar $10 → 4h per calendar month (UTC).
 * Recording time is what costs real money (STT minutes + a Haiku call per
 * segment), so capping it bounds the cost of every tier. Time is counted from
 * the `recordingUsage` ledger (sessions.ts:meterSession), NOT by summing session
 * durations — deleting a session must never refund its hours. Paused time never
 * counts (duration is the active-recording timer). Like every cap here, it is
 * inert while BILLING_ENABLED=false. The global MAX_SESSION_HOURS below is a
 * separate anti-runaway fuse.
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
  /** Recording time per calendar month, in HOURS. Infinity = unlimited. */
  recordingHoursPerMonth: number;
  /** How many scholars a user can follow (future reminders feature). */
  scholarsFollowable: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  // Free's old 4-sessions cap is gone: the hour allowance is the one meter.
  free: {
    sessionsPerMonth: Infinity,
    summariesPerMonth: 4,
    recordingHoursPerMonth: 1,
    scholarsFollowable: 0,
  },
  pro: {
    sessionsPerMonth: Infinity,
    summariesPerMonth: Infinity,
    recordingHoursPerMonth: 3,
    scholarsFollowable: 5,
  },
  scholar: {
    sessionsPerMonth: Infinity,
    summariesPerMonth: Infinity,
    recordingHoursPerMonth: 4,
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

/** "1 hour" · "3 hours" */
export function hoursLabel(hours: number): string {
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** "3 hours of recording a month" — straight from PLAN_LIMITS, so the pricing
 *  copy can never promise a different allowance than the meter enforces. */
function allowanceLabel(plan: Plan): string {
  return `${hoursLabel(PLAN_LIMITS[plan].recordingHoursPerMonth)} of recording a month`;
}

/**
 * Display metadata for the pricing UI. The single place a price string lives,
 * so the app never hardcodes a number that drifts from the Stripe price.
 * (Dev sandbox STRIPE_PRICE_ID is the $5/mo Pro price — see
 * [[stripe-billing-experiment]].)
 */
export const PLAN_META: Record<Plan, PlanMeta> = {
  free: {
    name: "Free",
    priceMonthly: 0,
    priceLabel: "Free",
    tagline: allowanceLabel("free"),
    highlights: [
      allowanceLabel("free"),
      `${PLAN_LIMITS.free.summariesPerMonth} AI summaries per month`,
      "Your full history, always",
    ],
  },
  pro: {
    name: "Pro",
    priceMonthly: 5,
    priceLabel: "$5 / month",
    tagline: `${hoursLabel(PLAN_LIMITS.pro.recordingHoursPerMonth)} a month · unlimited summaries`,
    highlights: [
      allowanceLabel("pro"),
      "Unlimited AI summaries",
      "Ask the lecture — AI Q&A",
      "AI study notes",
      "Any-language summary & transcript",
      "AI voice dubbing",
      "Your full history, always",
    ],
  },
  scholar: {
    name: "Scholar",
    priceMonthly: 10,
    priceLabel: "$10 / month",
    tagline: `${hoursLabel(PLAN_LIMITS.scholar.recordingHoursPerMonth)} a month · follow scholars`,
    comingSoon: true,
    highlights: [
      "Everything in Pro",
      allowanceLabel("scholar"),
      "Follow scholars + class reminders",
      "Unlimited scholars",
    ],
  },
};

/**
 * Anti-runaway fuse — NOT a product limit. A phone left recording (or a session
 * the user never stops) shouldn't bill us for hours of STT. No real dars
 * approaches this; al-Badr's longest runs ~3h. Applies to every tier.
 */
export const MAX_SESSION_HOURS = 6;

/** Annual billing discount, advertised as "Save 30%". */
export const ANNUAL_DISCOUNT_PCT = 30;

/**
 * Per-month price when billed annually (rounded). e.g. $10 → $7. NOTE: at the
 * $5 Pro price this rounds to $4 (20% off, not the advertised 30%) — revisit
 * before flipping ANNUAL_ENABLED on /plans.
 */
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

/** Start of the NEXT calendar month in ms (UTC) — when the allowance resets. */
export function nextMonthStartMs(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** "2026-10" — the recordingUsage ledger key. UTC, the same window as
 *  monthStartMs, so the meter and the summary count reset together. */
export function usageMonthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** Compact recording time: "0m" · "45m" · "1h" · "2h 15m" (whole minutes, floored). */
export function formatRecordingTime(seconds: number): string {
  const totalMin = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Infinity isn't a valid Convex/JSON value — surface unlimited as `null`. */
export function limitForWire(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** Has the user hit a (finite) limit? Unlimited (Infinity) is never hit. */
export function atLimit(used: number, limit: number): boolean {
  return Number.isFinite(limit) && used >= limit;
}

/**
 * This-month usage + entitlements as sent over the wire by
 * subscriptions.getMyUsageThisMonth (and re-typed by src/hooks/use-plan.ts and
 * src/lib/api-auth.ts). Unlimited = `null`.
 *
 * `sessionsUsed` / `sessionsLimit` are kept for shipped iOS builds that still
 * read them; no tier has a session cap any more, so the limit is always null.
 */
export interface PlanUsageWire {
  plan: "free" | "pro";
  sessionsUsed: number;
  summariesUsed: number;
  sessionsLimit: number | null;
  summariesLimit: number | null;
  recordingSecondsUsed: number;
  recordingSecondsLimit: number | null;
  recordingSecondsRemaining: number | null;
  canStartSession: boolean;
  canSummarize: boolean;
}

/**
 * Pure core of getMyUsageThisMonth — kept here so it is unit-testable without
 * flipping the BILLING_ENABLED constant. With billing off, everyone is
 * unlimited and no meter shows (all limits null).
 */
export function buildUsage(args: {
  plan: "free" | "pro";
  billingEnabled: boolean;
  sessionsUsed: number;
  summariesUsed: number;
  recordingSecondsUsed: number;
}): PlanUsageWire {
  const { plan } = args;
  if (!args.billingEnabled) {
    return {
      plan,
      sessionsUsed: 0,
      summariesUsed: 0,
      sessionsLimit: null,
      summariesLimit: null,
      recordingSecondsUsed: 0,
      recordingSecondsLimit: null,
      recordingSecondsRemaining: null,
      canStartSession: true,
      canSummarize: true,
    };
  }
  const limits = PLAN_LIMITS[plan];
  const recordingLimit = limits.recordingHoursPerMonth * 3600;
  const used = Math.max(0, args.recordingSecondsUsed);
  const remaining = Number.isFinite(recordingLimit)
    ? Math.max(0, recordingLimit - used)
    : null;
  return {
    plan,
    sessionsUsed: args.sessionsUsed,
    summariesUsed: args.summariesUsed,
    sessionsLimit: limitForWire(limits.sessionsPerMonth),
    summariesLimit: limitForWire(limits.summariesPerMonth),
    recordingSecondsUsed: used,
    recordingSecondsLimit: limitForWire(recordingLimit),
    recordingSecondsRemaining: remaining,
    canStartSession:
      !atLimit(args.sessionsUsed, limits.sessionsPerMonth) &&
      (remaining === null || remaining > 0),
    canSummarize: !atLimit(args.summariesUsed, limits.summariesPerMonth),
  };
}

/**
 * The "out of recording time" copy — ONE string for the record-page wall and
 * both STT credential routes' 402, so they can't drift. Free is pointed at Pro;
 * Pro has nowhere to upgrade to until Scholar ships, so it gets the reset date.
 */
export function recordingLimitMessage(plan: "free" | "pro", now: number): string {
  const used = hoursLabel(PLAN_LIMITS[plan].recordingHoursPerMonth);
  if (plan === "free") {
    return `You've used your ${used} of recording this month. Upgrade to Tarjuman Pro for ${hoursLabel(PLAN_LIMITS.pro.recordingHoursPerMonth)} a month.`;
  }
  const resets = new Date(nextMonthStartMs(now)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `You've used your ${used} of recording this month. It resets on ${resets}.`;
}

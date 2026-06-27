"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PLAN_META,
  annualPerMonth,
  annualTotal,
  ANNUAL_DISCOUNT_PCT,
  type Plan,
} from "../../../../convex/billingLimits";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { usePlan } from "@/hooks/use-plan";

const ORDER: Plan[] = ["free", "pro", "scholar"];

/**
 * Plans comparison. The app shell is a 420px phone column, so the tiers sit in
 * a horizontal scroll-snap carousel (cards genuinely next to each other,
 * swipeable) rather than a desktop grid. Monthly/Annual toggle with a sliding
 * indicator; annual shows the ~30%-off per-month price. Only Pro is purchasable
 * today (Scholar is "coming soon" until its feature ships — see
 * [[plan-tiers-roadmap]]). Annual checkout needs STRIPE_PRICE_ID_ANNUAL set.
 */
export default function PlansPage() {
  const router = useRouter();
  const plan = usePlan();
  const currentPlan: Plan = plan?.plan ?? "free";

  const [annual, setAnnual] = useState(false);

  // Open the on-domain DARK embedded checkout (only Pro is purchasable today).
  const openCheckout = () =>
    router.push(`/plans/checkout?interval=${annual ? "year" : "month"}`);

  return (
    <div className="flex flex-col flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+84px)]">
      {/* Header */}
      <div
        className="px-5 py-4 flex items-center gap-3"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="w-9 h-9 rounded-lg grid place-items-center transition-colors cursor-pointer"
          aria-label="Back"
          style={{ background: COLORS.surface }}
        >
          <Icon name="back" size={18} color={COLORS.t2} />
        </button>
        <div className="text-[15px] font-bold" style={{ color: COLORS.w }}>
          Plans
        </div>
      </div>

      {/* Monthly / Annual toggle (sliding indicator) */}
      <div className="flex items-center justify-center gap-2.5 px-5 pt-5">
        <div
          className="relative inline-flex p-1 rounded-full"
          style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
        >
          <span
            aria-hidden
            className="absolute top-1 bottom-1 rounded-full transition-transform duration-300 ease-out"
            style={{
              width: "calc(50% - 4px)",
              left: 4,
              background: COLORS.accent,
              transform: annual ? "translateX(100%)" : "translateX(0)",
            }}
          />
          <button
            type="button"
            onClick={() => setAnnual(false)}
            className="relative z-10 w-[88px] py-1.5 rounded-full text-[13px] font-bold transition-colors duration-200 cursor-pointer"
            style={{ color: annual ? COLORS.t2 : "#0A0F1C" }}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setAnnual(true)}
            className="relative z-10 w-[88px] py-1.5 rounded-full text-[13px] font-bold transition-colors duration-200 cursor-pointer"
            style={{ color: annual ? "#0A0F1C" : COLORS.t2 }}
          >
            Annual
          </button>
        </div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md"
          style={{ background: COLORS.accentSoft, color: COLORS.accent }}
        >
          Save {ANNUAL_DISCOUNT_PCT}%
        </span>
      </div>

      {/* Cards — horizontal scroll-snap carousel */}
      <div
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory px-5 py-4 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {ORDER.map((tier) => {
          const meta = PLAN_META[tier];
          const isFree = tier === "free";
          const isCurrent = currentPlan === tier;
          const popular = tier === "pro";
          const canBuy = !meta.comingSoon && !isCurrent && !isFree;

          return (
            <div
              key={tier}
              className="snap-center shrink-0 w-[270px] rounded-2xl px-4 py-4 flex flex-col transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-2xl"
              style={{
                background: COLORS.surface,
                border: `1px solid ${popular ? `${COLORS.accent}66` : COLORS.border}`,
                boxShadow: popular
                  ? `0 0 0 1px ${COLORS.accent}22, 0 10px 30px rgba(0,0,0,0.35)`
                  : undefined,
              }}
            >
              {popular && (
                <div className="flex justify-center -mt-1 mb-2">
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                    style={{ background: COLORS.accent, color: "#0A0F1C" }}
                  >
                    ◆ Most Popular
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-[17px] font-bold" style={{ color: COLORS.w }}>
                  {meta.name}
                </span>
                {isCurrent && (
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-[2px] rounded"
                    style={{ background: COLORS.accentSoft, color: COLORS.accent }}
                  >
                    Current
                  </span>
                )}
              </div>
              <p
                className="text-[12px] mt-1 mb-3 leading-snug"
                style={{ color: COLORS.t3, minHeight: 32 }}
              >
                {meta.tagline}
              </p>

              {/* Price */}
              <div className="mb-4" style={{ minHeight: 56 }}>
                {isFree ? (
                  <span className="text-[28px] font-bold" style={{ color: COLORS.w }}>
                    Free
                  </span>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      {annual && (
                        <span
                          className="text-[15px] font-semibold line-through"
                          style={{ color: COLORS.t4 }}
                        >
                          ${meta.priceMonthly}
                        </span>
                      )}
                      <span className="text-[28px] font-bold" style={{ color: COLORS.w }}>
                        $
                        {annual
                          ? annualPerMonth(meta.priceMonthly)
                          : meta.priceMonthly}
                      </span>
                      <span className="text-[12px] font-medium" style={{ color: COLORS.t3 }}>
                        /mo
                      </span>
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: COLORS.t4 }}>
                      {annual
                        ? `billed annually · $${annualTotal(meta.priceMonthly)}/yr`
                        : "billed monthly"}
                    </div>
                  </>
                )}
              </div>

              {/* CTA */}
              {meta.comingSoon ? (
                <div
                  className="w-full h-11 rounded-xl flex items-center justify-center text-[13px] font-semibold mb-4"
                  style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.t4 }}
                >
                  Coming soon
                </div>
              ) : isCurrent ? (
                <Link
                  href="/settings"
                  className="w-full h-11 rounded-xl flex items-center justify-center text-[13px] font-semibold mb-4 cursor-pointer transition-colors"
                  style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.t3 }}
                >
                  {isFree ? "Your current plan" : "Manage billing"}
                </Link>
              ) : canBuy ? (
                <button
                  type="button"
                  onClick={openCheckout}
                  className="w-full h-11 rounded-xl flex items-center justify-center text-[13px] font-bold mb-4 cursor-pointer transition-transform active:scale-[0.98]"
                  style={{
                    background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
                    color: "#0A0F1C",
                  }}
                >
                  Upgrade to {meta.name}
                </button>
              ) : (
                <div className="mb-4" />
              )}

              {/* Highlights */}
              <ul className="flex flex-col gap-2">
                {meta.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <span className="mt-[2px] shrink-0">
                      <Icon name="check" size={14} color={COLORS.accent} />
                    </span>
                    <span className="text-[12.5px] leading-snug" style={{ color: COLORS.t2 }}>
                      {h}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-center px-5" style={{ color: COLORS.t4 }}>
        Cancel anytime — you keep access until the end of your billing period.
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePlan } from "@/hooks/use-plan";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

/**
 * return_url landing after a successful embedded checkout. Entitlement is
 * granted by the Stripe webhook (not this page), so we just watch the reactive
 * plan and confirm once it flips to Pro — usually within a second.
 */
export default function CompletePage() {
  const plan = usePlan();
  const isPro = plan?.plan === "pro";

  return (
    <div className="flex flex-col flex-1 items-center justify-center text-center px-8 gap-4 pb-[calc(env(safe-area-inset-bottom,0px)+84px)]">
      <div
        className="w-14 h-14 rounded-full grid place-items-center"
        style={{ background: COLORS.accentSoft, border: `1px solid ${COLORS.accent}40` }}
      >
        {isPro ? (
          <Icon name="check" size={26} color={COLORS.accent} />
        ) : (
          <div
            className="w-5 h-5 rounded-full border-2 animate-spin"
            style={{ borderColor: COLORS.borderLight, borderTopColor: COLORS.accent }}
          />
        )}
      </div>

      <div className="text-[18px] font-bold" style={{ color: COLORS.w }}>
        {isPro ? "You're on Pro 🎉" : "Finalizing your subscription…"}
      </div>
      <p className="text-[13px] max-w-[280px]" style={{ color: COLORS.t3 }}>
        {isPro
          ? "Unlimited sessions and summaries are unlocked. Jazak Allahu khayran."
          : "This takes a second — your plan updates automatically."}
      </p>

      <Link
        href="/record"
        className="mt-2 px-5 h-11 rounded-xl flex items-center text-[13px] font-bold transition-transform active:scale-[0.98]"
        style={{ background: COLORS.accent, color: "#0A0F1C" }}
      >
        Start recording
      </Link>
      <Link
        href="/settings"
        className="text-[12px]"
        style={{ color: COLORS.t3 }}
      >
        Manage subscription
      </Link>
    </div>
  );
}

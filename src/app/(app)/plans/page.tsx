"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { PLAN_META, type Plan } from "../../../../convex/billingLimits";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { usePlan } from "@/hooks/use-plan";

const ORDER: Plan[] = ["free", "pro", "scholar"];

/**
 * Plans comparison — reached from any "Upgrade" CTA. Shows all tiers side by
 * side so the user chooses rather than being dropped straight into Pro
 * checkout. Only Pro is purchasable today; Scholar is "coming soon" until its
 * hero feature ships (see [[plan-tiers-roadmap]]).
 */
export default function PlansPage() {
  const router = useRouter();
  const plan = usePlan();
  const currentPlan: Plan = plan?.plan ?? "free";
  const createCheckoutSession = useAction(api.stripe.createCheckoutSession);

  const [busy, setBusy] = useState<Plan | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const upgrade = async (tier: Plan) => {
    setBusy(tier);
    try {
      const { url } = await createCheckoutSession({
        origin: window.location.origin,
      });
      window.location.assign(url);
    } catch (e) {
      setBusy(null);
      setErrorMsg(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again."
      );
      setErrorOpen(true);
    }
  };

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

      <div className="px-5 pt-5 flex flex-col gap-3">
        {ORDER.map((tier) => {
          const meta = PLAN_META[tier];
          const isCurrent = currentPlan === tier;
          const recommended = tier === "pro";
          const canBuy = !meta.comingSoon && !isCurrent && tier !== "free";

          return (
            <div
              key={tier}
              className="rounded-2xl px-4 py-4"
              style={{
                background: COLORS.surface,
                border: `1px solid ${
                  recommended ? `${COLORS.accent}55` : COLORS.border
                }`,
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[16px] font-bold"
                      style={{ color: COLORS.w }}
                    >
                      Tarjuman {meta.name}
                    </span>
                    {recommended && !isCurrent && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-[6px] py-[2px] rounded-md"
                        style={{
                          background: COLORS.accentSoft,
                          color: COLORS.accent,
                        }}
                      >
                        Popular
                      </span>
                    )}
                  </div>
                  <div
                    className="text-[13px] font-semibold mt-1"
                    style={{ color: recommended ? COLORS.accent : COLORS.t2 }}
                  >
                    {meta.priceLabel}
                  </div>
                </div>
                {isCurrent && (
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md shrink-0"
                    style={{
                      background: COLORS.accentSoft,
                      color: COLORS.accent,
                    }}
                  >
                    Current
                  </span>
                )}
              </div>

              <ul className="flex flex-col gap-2 mb-4">
                {meta.highlights.map((h) => (
                  <li key={h} className="flex items-center gap-2">
                    <Icon name="check" size={15} color={COLORS.accent} />
                    <span className="text-[13px]" style={{ color: COLORS.t2 }}>
                      {h}
                    </span>
                  </li>
                ))}
              </ul>

              {meta.comingSoon ? (
                <div
                  className="w-full h-11 rounded-xl flex items-center justify-center text-[13px] font-semibold"
                  style={{
                    background: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                    color: COLORS.t4,
                  }}
                >
                  Coming soon
                </div>
              ) : isCurrent ? (
                <Link
                  href="/settings"
                  className="w-full h-11 rounded-xl flex items-center justify-center text-[13px] font-semibold cursor-pointer transition-colors"
                  style={{
                    background: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                    color: COLORS.t3,
                  }}
                >
                  {tier === "free" ? "Your current plan" : "Manage billing"}
                </Link>
              ) : canBuy ? (
                <button
                  type="button"
                  onClick={() => void upgrade(tier)}
                  disabled={busy !== null}
                  className="w-full h-11 rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-bold cursor-pointer transition-transform active:scale-[0.98] disabled:opacity-50"
                  style={{
                    background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
                    color: "#0A0F1C",
                  }}
                >
                  {busy === tier ? "Opening checkout…" : `Upgrade to ${meta.name}`}
                </button>
              ) : null}
            </div>
          );
        })}

        <p
          className="text-[11px] text-center mt-1"
          style={{ color: COLORS.t4 }}
        >
          Cancel anytime — you keep access until the end of your billing period.
        </p>
      </div>

      <ConfirmDialog
        open={errorOpen}
        onOpenChange={setErrorOpen}
        title="Billing unavailable"
        message={errorMsg}
        confirmLabel="OK"
        cancelLabel={null}
        onConfirm={() => setErrorOpen(false)}
      />
    </div>
  );
}

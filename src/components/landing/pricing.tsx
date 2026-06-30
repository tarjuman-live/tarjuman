"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { PLAN_META, type Plan } from "../../../convex/billingLimits";
import { useLocale } from "@/lib/i18n/locale-context";
import { Reveal } from "./reveal";

const AuthModal = dynamic(
  () => import("@/components/auth/auth-modal").then((m) => m.AuthModal),
  { ssr: false }
);

const ORDER: Plan[] = ["free", "pro", "scholar"];

/**
 * Landing pricing section. Shows the planned tiers (Free / Pro / Scholar) from
 * the single billing config. Billing is OFF, so there's no checkout here — the
 * CTAs open sign-up. Wire them to checkout when BILLING_ENABLED flips true.
 */
export function Pricing() {
  const { t } = useLocale();
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  const start = () => {
    if (isAuthenticated) {
      router.push("/record");
      return;
    }
    setMounted(true);
    setOpen(true);
  };

  return (
    <section id="pricing" className="w-full max-w-5xl mx-auto px-6 py-16 sm:py-24">
      <Reveal>
        <h2 className="text-2xl sm:text-3xl font-bold text-center leading-tight">
          <T_ k="lp.pricingHeading" t={t} />
        </h2>
        <p className="mt-3 text-center text-[var(--color-text-2)] max-w-xl mx-auto">
          <T_ k="lp.pricingSub" t={t} />
        </p>
      </Reveal>

      <div className="mt-12 grid gap-4 sm:grid-cols-3 items-start">
        {ORDER.map((plan, i) => {
          const meta = PLAN_META[plan];
          const featured = plan === "pro";
          const soon = Boolean(meta.comingSoon);
          return (
            <Reveal key={plan} delay={80 + i * 90} className="h-full">
              <div
                className="group relative h-full flex flex-col rounded-2xl border p-6 transition duration-200 hover:-translate-y-1.5 hover:shadow-[0_14px_36px_rgba(46,204,113,0.2)]"
                style={{
                  background: featured
                    ? "var(--color-surface-light)"
                    : "var(--color-surface)",
                  borderColor: featured
                    ? "var(--color-accent)"
                    : "var(--color-border-light)",
                }}
              >
                {featured && (
                  <span
                    className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                    style={{ background: "var(--color-accent)", color: "#0A0F1C" }}
                  >
                    <T_ k="lp.mostPopular" t={t} />
                  </span>
                )}

                <div className="text-lg font-bold">{meta.name}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  {meta.priceMonthly === 0 ? (
                    <span className="text-3xl font-bold">{t("settings.free")}</span>
                  ) : (
                    <>
                      <span className="text-3xl font-bold">
                        ${meta.priceMonthly}
                      </span>
                      <span className="text-[13px] text-[var(--color-text-3)]">
                        <T_ k="lp.perMonth" t={t} />
                      </span>
                    </>
                  )}
                </div>

                <ul className="mt-5 flex flex-col gap-2.5 flex-1">
                  {meta.highlights.map((h) => (
                    <li
                      key={h}
                      className="flex items-start gap-2 text-[13px] text-[var(--color-text-2)]"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth="2.5"
                        className="mt-[1px] shrink-0"
                        aria-hidden
                      >
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {h}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={soon ? undefined : start}
                  disabled={soon}
                  className="mt-6 h-11 rounded-xl font-bold text-sm cursor-pointer transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed"
                  style={
                    soon
                      ? {
                          background: "transparent",
                          border: "1px solid var(--color-border-light)",
                          color: "var(--color-text-3)",
                        }
                      : featured
                        ? {
                            background: "var(--color-accent)",
                            color: "#0A0F1C",
                            boxShadow: "0 0 24px rgba(46,204,113,0.3)",
                          }
                        : {
                            background: "transparent",
                            border: "1px solid var(--color-accent)",
                            color: "var(--color-accent)",
                          }
                  }
                >
                  {soon ? (
                    <T_ k="lp.comingSoon" t={t} />
                  ) : plan === "free" ? (
                    <T_ k="lp.tryFree" t={t} />
                  ) : (
                    <T_ k="lp.getStarted" t={t} />
                  )}
                </button>
              </div>
            </Reveal>
          );
        })}
      </div>

      {mounted && (
        <AuthModal open={open} onOpenChange={setOpen} initialMode="signUp" />
      )}
    </section>
  );
}

// Tiny inline-localized text using the already-resolved t (avoids re-calling
// the hook in a loop).
function T_({
  k,
  t,
}: {
  k: Parameters<ReturnType<typeof useLocale>["t"]>[0];
  t: ReturnType<typeof useLocale>["t"];
}) {
  return <>{t(k)}</>;
}

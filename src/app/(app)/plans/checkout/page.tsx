"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import {
  CheckoutElementsProvider,
  useCheckoutElements,
  PaymentElement,
} from "@stripe/react-stripe-js/checkout";
import { api } from "../../../../../convex/_generated/api";
import {
  getStripePromise,
  hasStripeKey,
  DARK_APPEARANCE,
} from "@/lib/stripe-checkout";
import {
  PLAN_META,
  annualPerMonth,
  annualTotal,
} from "../../../../../convex/billingLimits";
import { COLORS } from "@/lib/constants";
import { SITE_NAME } from "@/lib/site";
import { Icon } from "@/components/shared/icon";

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div
        className="w-5 h-5 rounded-full border-2 animate-spin"
        style={{ borderColor: COLORS.borderLight, borderTopColor: COLORS.accent }}
      />
    </div>
  );
}

/** The dark card form. Mounted inside <CheckoutElementsProvider>. */
function PayForm({ submitLabel }: { submitLabel: string }) {
  const result = useCheckoutElements();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (result.type === "loading") return <Spinner />;
  if (result.type === "error") {
    return (
      <p className="text-[13px] text-center" style={{ color: COLORS.red }}>
        {result.error.message}
      </p>
    );
  }
  const checkout = result.checkout;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const r = await checkout.confirm();
    if (r.type === "error") {
      setMessage(r.error.message);
      setSubmitting(false);
    }
    // success → Stripe redirects to the session's return_url
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <PaymentElement />
      <button
        type="submit"
        disabled={submitting}
        className="w-full h-12 rounded-xl text-[14px] font-bold cursor-pointer transition-all duration-200 active:scale-[0.98] hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100"
        style={{
          background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
          color: "#0A0F1C",
          boxShadow: `0 0 24px ${COLORS.accent}30`,
        }}
      >
        {submitting ? "Processing…" : submitLabel}
      </button>
      {message && (
        <p className="text-[12.5px] text-center" style={{ color: COLORS.red }}>
          {message}
        </p>
      )}
    </form>
  );
}

/** Branded order summary — what you're buying, the price, and what it unlocks. */
function OrderSummary({ interval }: { interval: "month" | "year" }) {
  const meta = PLAN_META.pro;
  const perMo =
    interval === "year" ? annualPerMonth(meta.priceMonthly) : meta.priceMonthly;
  const cadence =
    interval === "year"
      ? `$${annualTotal(meta.priceMonthly)} billed annually`
      : "billed monthly";

  return (
    <div
      className="rounded-2xl p-4 mb-5"
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.accent}30`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold" style={{ color: COLORS.w }}>
              {SITE_NAME} Pro
            </span>
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-[6px] py-[2px] rounded-md"
              style={{ background: COLORS.accentSoft, color: COLORS.accent }}
            >
              ✦ Pro
            </span>
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: COLORS.t3 }}>
            {meta.tagline}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-baseline gap-0.5 justify-end">
            <span className="text-[22px] font-bold" style={{ color: COLORS.w }}>
              ${perMo}
            </span>
            <span className="text-[12px] font-medium" style={{ color: COLORS.t3 }}>
              /mo
            </span>
          </div>
          <div className="text-[10.5px]" style={{ color: COLORS.t4 }}>
            {cadence}
          </div>
        </div>
      </div>

      <div className="my-3 h-px" style={{ background: COLORS.border }} />

      <ul className="flex flex-col gap-1.5">
        {meta.highlights.map((h) => (
          <li key={h} className="flex items-start gap-2">
            <span className="mt-[1px] shrink-0">
              <Icon name="check" size={13} color={COLORS.accent} />
            </span>
            <span className="text-[12px] leading-snug" style={{ color: COLORS.t2 }}>
              {h}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckoutInner() {
  const router = useRouter();
  const params = useSearchParams();
  const interval = params.get("interval") === "year" ? "year" : "month";
  const me = useQuery(api.users.me);
  const createElementsCheckout = useAction(api.stripe.createElementsCheckout);

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!hasStripeKey()) {
      setError("Card payments aren't configured yet (missing publishable key).");
      return;
    }
    startedRef.current = true;
    createElementsCheckout({ origin: window.location.origin, interval })
      .then((r) => setClientSecret(r.clientSecret))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Couldn't start checkout.")
      );
    // Run once on mount; interval is read at that point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitLabel =
    interval === "year"
      ? `Subscribe · $${annualTotal(PLAN_META.pro.priceMonthly)}/yr`
      : `Subscribe · $${PLAN_META.pro.priceMonthly}/mo`;

  return (
    <div className="flex flex-col flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+84px)] lg:pb-8">
      <div
        className="px-5 py-4 flex items-center gap-3 lg:hidden"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="w-9 h-9 rounded-lg grid place-items-center cursor-pointer"
          aria-label="Back"
          style={{ background: COLORS.surface }}
        >
          <Icon name="back" size={18} color={COLORS.t2} />
        </button>
        <div className="text-[15px] font-bold" style={{ color: COLORS.w }}>
          Checkout
        </div>
      </div>

      <div className="px-5 pt-6 lg:pt-12 w-full max-w-md mx-auto">
        {/* Brand mark — anchors the payment moment to Tarjuman. */}
        <div className="flex items-center gap-2.5 mb-6">
          <span
            className="w-9 h-9 rounded-xl grid place-items-center"
            style={{
              background: COLORS.accent,
              boxShadow: `0 0 20px ${COLORS.accent}40`,
            }}
          >
            <Icon name="mic" size={18} color="#0A0F1C" />
          </span>
          <span className="text-[17px] font-bold" style={{ color: COLORS.w }}>
            {SITE_NAME}
          </span>
        </div>

        <OrderSummary interval={interval} />

        {error ? (
          <p className="text-[13px]" style={{ color: COLORS.red }}>
            {error}
          </p>
        ) : clientSecret ? (
          <CheckoutElementsProvider
            stripe={getStripePromise()}
            options={{
              clientSecret,
              elementsOptions: { appearance: DARK_APPEARANCE },
              defaultValues: me?.email ? { email: me.email } : undefined,
            }}
          >
            <PayForm submitLabel={submitLabel} />
          </CheckoutElementsProvider>
        ) : (
          <Spinner />
        )}

        {/* Trust line — reassurance at the point of payment. */}
        <div
          className="mt-5 flex items-center justify-center gap-1.5 text-[11.5px]"
          style={{ color: COLORS.t4 }}
        >
          <Icon name="check" size={13} color={COLORS.t4} />
          <span>Secured by Stripe · Cancel anytime</span>
        </div>
        <p
          className="mt-1 text-[11px] text-center"
          style={{ color: COLORS.t4 }}
        >
          You keep access until the end of your billing period.
        </p>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CheckoutInner />
    </Suspense>
  );
}

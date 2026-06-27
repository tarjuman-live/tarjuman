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
import { COLORS } from "@/lib/constants";
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
function PayForm() {
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
        className="w-full h-12 rounded-xl text-[14px] font-bold cursor-pointer transition-transform active:scale-[0.98] disabled:opacity-50"
        style={{
          background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
          color: "#0A0F1C",
        }}
      >
        {submitting ? "Processing…" : "Subscribe"}
      </button>
      {message && (
        <p className="text-[12.5px] text-center" style={{ color: COLORS.red }}>
          {message}
        </p>
      )}
    </form>
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

  return (
    <div className="flex flex-col flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+84px)]">
      <div
        className="px-5 py-4 flex items-center gap-3"
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
          Subscribe to Pro
        </div>
      </div>

      <div className="px-5 pt-5">
        <div className="mb-5 text-[13px]" style={{ color: COLORS.t2 }}>
          Tarjuman Pro ·{" "}
          {interval === "year" ? "billed annually" : "billed monthly"}
        </div>

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
            <PayForm />
          </CheckoutElementsProvider>
        ) : (
          <Spinner />
        )}
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

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { api } from "../../../../../convex/_generated/api";
import { getStripePromise, DARK_APPEARANCE } from "@/lib/stripe-checkout";
import { PLAN_META } from "../../../../../convex/billingLimits";
import { COLORS } from "@/lib/constants";
import { SITE_NAME } from "@/lib/site";
import { formatDate } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

/**
 * Fully-dark, in-app billing management — replaces the Stripe-hosted Customer
 * Portal (which is white and can't be themed dark). Status + cancel + resume
 * come from the billing actions in convex/stripe.ts and the reactive
 * getMySubscription query; the card update uses a SetupIntent + the same dark
 * PaymentElement as checkout, then setDefaultPaymentMethod points the customer
 * and subscription at the new card. Nothing here ever bounces to a white page.
 */

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div
        className="w-5 h-5 rounded-full border-2 animate-spin"
        style={{ borderColor: COLORS.borderLight, borderTopColor: COLORS.accent }}
      />
    </div>
  );
}

/** New-card form inside <Elements> (SetupIntent). */
function CardUpdateForm({
  onSaved,
  onCancel,
}: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const setDefault = useAction(api.stripe.setDefaultPaymentMethod);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setMsg(null);
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (error) {
      setMsg(error.message ?? "Couldn't save the card.");
      setSaving(false);
      return;
    }
    const pm = setupIntent?.payment_method;
    const pmId = typeof pm === "string" ? pm : pm?.id;
    if (!pmId) {
      setMsg("Couldn't read the new card.");
      setSaving(false);
      return;
    }
    try {
      await setDefault({ paymentMethodId: pmId });
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't apply the card.");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4 mt-4">
      <PaymentElement />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-11 rounded-xl text-[13px] font-semibold cursor-pointer border bg-[var(--color-surface)] border-[var(--color-border-light)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] transition-all duration-200 active:scale-[0.98]"
          style={{ color: COLORS.t2 }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 h-11 rounded-xl text-[13px] font-bold cursor-pointer transition-all duration-200 active:scale-[0.98] hover:brightness-110 disabled:opacity-50"
          style={{
            background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
            color: "#0A0F1C",
          }}
        >
          {saving ? "Saving…" : "Save card"}
        </button>
      </div>
      {msg && (
        <p className="text-[12.5px] text-center" style={{ color: COLORS.red }}>
          {msg}
        </p>
      )}
    </form>
  );
}

export default function ManagePage() {
  const router = useRouter();
  const sub = useQuery(api.subscriptions.getMySubscription);
  const getBillingDetails = useAction(api.stripe.getBillingDetails);
  const cancelSub = useAction(api.stripe.cancelSubscription);
  const resumeSub = useAction(api.stripe.resumeSubscription);
  const createSetupIntent = useAction(api.stripe.createSetupIntent);

  const [details, setDetails] = useState<{
    card: { brand: string; last4: string } | null;
    amount: number | null;
    interval: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);

  const isPro = sub?.plan === "pro";
  const canceling = sub?.cancelAtPeriodEnd ?? false;
  const periodEnd = sub?.currentPeriodEnd ?? null;

  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!isPro || fetchedRef.current) return;
    fetchedRef.current = true;
    getBillingDetails()
      .then(setDetails)
      .catch(() => {});
  }, [isPro, getBillingDetails]);

  const priceStr = `$${
    details?.amount != null
      ? Math.round(details.amount / 100)
      : PLAN_META.pro.priceMonthly
  }/${details?.interval === "year" ? "yr" : "mo"}`;

  const doCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelSub();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cancel.");
    } finally {
      setBusy(false);
      setCancelOpen(false);
    }
  };

  const doResume = async () => {
    setBusy(true);
    setError(null);
    try {
      await resumeSub();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resume.");
    } finally {
      setBusy(false);
    }
  };

  const startCardUpdate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { clientSecret } = await createSetupIntent();
      setSetupSecret(clientSecret);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start card update.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+84px)] lg:pb-8">
      <div
        className="px-5 py-4 flex items-center gap-3 lg:hidden"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <button
          type="button"
          onClick={() => router.push("/settings")}
          className="w-9 h-9 rounded-lg grid place-items-center cursor-pointer"
          aria-label="Back"
          style={{ background: COLORS.surface }}
        >
          <Icon name="back" size={18} color={COLORS.t2} />
        </button>
        <div className="text-[15px] font-bold" style={{ color: COLORS.w }}>
          Manage billing
        </div>
      </div>

      <div className="px-5 pt-6 lg:pt-12 w-full max-w-md mx-auto">
        {/* Brand mark */}
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

        {sub === undefined ? (
          <Spinner />
        ) : !isPro ? (
          <div
            className="rounded-2xl p-5 text-center"
            style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
          >
            <div className="text-[15px] font-semibold" style={{ color: COLORS.w }}>
              No active subscription
            </div>
            <p className="text-[12.5px] mt-1 mb-4" style={{ color: COLORS.t3 }}>
              You&apos;re on the Free plan.
            </p>
            <Link
              href="/plans"
              className="inline-flex h-11 px-5 rounded-xl items-center text-[13px] font-bold transition-all duration-200 active:scale-[0.98] hover:brightness-110"
              style={{
                background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
                color: "#0A0F1C",
              }}
            >
              See plans
            </Link>
          </div>
        ) : (
          <>
            {/* Status card */}
            <div
              className="rounded-2xl p-4"
              style={{ background: COLORS.surface, border: `1px solid ${COLORS.accent}30` }}
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
                  <div
                    className="text-[12px] mt-1"
                    style={{ color: canceling ? COLORS.amber : COLORS.t3 }}
                  >
                    {canceling
                      ? periodEnd
                        ? `Cancels ${formatDate(periodEnd)}`
                        : "Cancels at period end"
                      : periodEnd
                        ? `Renews ${formatDate(periodEnd)}`
                        : "Active"}
                  </div>
                </div>
                <div className="text-[15px] font-bold shrink-0" style={{ color: COLORS.w }}>
                  {priceStr}
                </div>
              </div>

              <div className="my-3 h-px" style={{ background: COLORS.border }} />

              {/* Card row */}
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px]" style={{ color: COLORS.t2 }}>
                  {details === null ? (
                    <span style={{ color: COLORS.t4 }}>Loading card…</span>
                  ) : details.card ? (
                    <span className="capitalize">
                      {details.card.brand} ···· {details.card.last4}
                    </span>
                  ) : (
                    <span style={{ color: COLORS.t4 }}>No card on file</span>
                  )}
                </div>
                {!setupSecret && (
                  <button
                    type="button"
                    onClick={startCardUpdate}
                    disabled={busy}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer border bg-[var(--color-surface)] border-[var(--color-border-light)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] transition-all duration-200 disabled:opacity-50"
                    style={{ color: COLORS.accent }}
                  >
                    {busy && !cancelOpen ? "…" : "Update card"}
                  </button>
                )}
              </div>

              {/* Card update form (SetupIntent + dark PaymentElement) */}
              {setupSecret && (
                <Elements
                  stripe={getStripePromise()}
                  options={{ clientSecret: setupSecret, appearance: DARK_APPEARANCE }}
                >
                  <CardUpdateForm
                    onSaved={() => {
                      setSetupSecret(null);
                      getBillingDetails().then(setDetails).catch(() => {});
                    }}
                    onCancel={() => setSetupSecret(null)}
                  />
                </Elements>
              )}
            </div>

            {/* Cancel / Resume */}
            <div className="mt-4">
              {canceling ? (
                <button
                  type="button"
                  onClick={doResume}
                  disabled={busy}
                  className="w-full h-12 rounded-xl text-[14px] font-bold cursor-pointer transition-all duration-200 active:scale-[0.98] hover:brightness-110 disabled:opacity-50"
                  style={{
                    background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
                    color: "#0A0F1C",
                  }}
                >
                  {busy ? "…" : "Resume subscription"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setCancelOpen(true)}
                  disabled={busy}
                  className="w-full h-12 rounded-xl text-[13px] font-semibold cursor-pointer border bg-transparent transition-all duration-200 active:scale-[0.98] disabled:opacity-50 hover:bg-[var(--color-surface)]"
                  style={{ borderColor: `${COLORS.red}55`, color: COLORS.red }}
                >
                  Cancel subscription
                </button>
              )}
            </div>

            {error && (
              <p className="text-[12.5px] text-center mt-3" style={{ color: COLORS.red }}>
                {error}
              </p>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel subscription?"
        message={
          periodEnd
            ? `You'll keep Pro until ${formatDate(periodEnd)}, then drop to Free. No further charges.`
            : "You'll keep Pro until the end of your billing period, then drop to Free."
        }
        confirmLabel="Cancel subscription"
        cancelLabel="Keep Pro"
        destructive
        onConfirm={doCancel}
      />
    </div>
  );
}

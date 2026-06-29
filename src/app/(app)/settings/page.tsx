"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { PLAN_META, BILLING_ENABLED } from "../../../../convex/billingLimits";
import { COLORS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { usePlan } from "@/hooks/use-plan";
import { Icon } from "@/components/shared/icon";
import { Skeleton } from "@/components/shared/skeleton";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { useLocale } from "@/lib/i18n/locale-context";
import { LanguageSelector } from "@/components/recording/language-selector";
import { Toggle } from "@/components/settings/toggle";
import { PromptDialog } from "@/components/shared/prompt-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

// First-run mic tips are device-local UI state (see positioning-tips.tsx).
const POSITIONING_TIPS_ACK_KEY = "livetranscribe:positioning-tips-ack";

export default function SettingsPage() {
  const me = useQuery(api.users.me);
  const prefs = useQuery(api.preferences.get);
  const { t } = useLocale();
  const updatePrefs = useMutation(api.preferences.update);
  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const subscription = useQuery(api.subscriptions.getMySubscription);
  const plan = usePlan();
  const createPortalSession = useAction(api.stripe.createPortalSession);
  const { signOut } = useAuthActions();
  const router = useRouter();

  const [nameOpen, setNameOpen] = useState(false);

  // Stripe billing (test-mode experiment). Both actions return a { url } we
  // redirect the whole tab to — Checkout for upgrades, the Customer Portal to
  // manage/cancel. `subscription` is reactive, so the section flips Free ↔ Pro
  // the moment the webhook lands.
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingErrorOpen, setBillingErrorOpen] = useState(false);
  const [billingErrorMessage, setBillingErrorMessage] = useState("");

  const goToStripe = async (
    create: (args: { origin: string }) => Promise<{ url: string }>
  ) => {
    setBillingBusy(true);
    try {
      const { url } = await create({ origin: window.location.origin });
      window.location.href = url;
    } catch (e) {
      setBillingBusy(false);
      setBillingErrorMessage(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
      setBillingErrorOpen(true);
    }
  };

  // Optimistic local overrides so toggles/pickers feel instant; they fall
  // back to the stored pref, then the app default.
  const [localLangs, setLocalLangs] = useState<{ s: string; t: string } | null>(null);
  const [localMain, setLocalMain] = useState<boolean | null>(null);
  const [tipsReset, setTipsReset] = useState(false);

  // Two-step delete-account flow (relocated from the account menu).
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [finalDeleteOpen, setFinalDeleteOpen] = useState(false);
  const [deleteErrorOpen, setDeleteErrorOpen] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (me === undefined || prefs === undefined) {
    return (
      <div className="flex flex-col flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+84px)]">
        <div
          className="px-5 py-5 flex flex-col gap-2"
          style={{ borderBottom: `1px solid ${COLORS.border}` }}
        >
          <Skeleton style={{ width: 90, height: 11 }} />
          <Skeleton style={{ width: "50%", height: 22 }} />
        </div>
        <div className="px-5 py-5 flex flex-col gap-5">
          <Skeleton style={{ width: "100%", height: 64 }} rounded={16} />
          <Skeleton style={{ width: "100%", height: 100 }} rounded={16} />
          <Skeleton style={{ width: "100%", height: 64 }} rounded={16} />
        </div>
      </div>
    );
  }
  if (me === null) return null;

  const sourceLang = localLangs?.s ?? prefs?.defaultSourceLanguage ?? "ar";
  const targetLang = localLangs?.t ?? prefs?.defaultTargetLanguage ?? "en";
  const mainSpeakerOnly = localMain ?? prefs?.mainSpeakerOnly ?? false;

  const handleLangChange = (next: { sourceLang: string; targetLang: string }) => {
    setLocalLangs({ s: next.sourceLang, t: next.targetLang });
    void updatePrefs({
      defaultSourceLanguage: next.sourceLang,
      defaultTargetLanguage: next.targetLang,
    });
  };

  const toggleMain = () => {
    const next = !mainSpeakerOnly;
    setLocalMain(next);
    void updatePrefs({ mainSpeakerOnly: next });
  };

  const resetTips = () => {
    try {
      localStorage.removeItem(POSITIONING_TIPS_ACK_KEY);
    } catch {
      /* private mode */
    }
    setTipsReset(true);
  };

  const performDelete = async () => {
    setFinalDeleteOpen(false);
    setDeleting(true);
    try {
      await deleteAccount({});
      await signOut();
      router.replace("/login");
    } catch (e) {
      setDeleting(false);
      setDeleteErrorMessage(
        `Couldn't delete your account: ${
          e instanceof Error ? e.message : String(e)
        }. Please try again or contact support.`
      );
      setDeleteErrorOpen(true);
    }
  };

  const initial = (me.name?.[0] ?? me.email?.[0] ?? "?").toUpperCase();
  const sectionLabel = "section-label mb-2";
  const cardStyle = {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
  } as const;

  const isPro = subscription?.plan === "pro";
  const periodEnd = subscription?.currentPeriodEnd ?? null;
  const proStatusLine = subscription?.cancelAtPeriodEnd
    ? periodEnd
      ? `Cancels ${formatDate(periodEnd)}`
      : "Cancels at period end"
    : periodEnd
      ? `Renews ${formatDate(periodEnd)}`
      : "Active subscription";

  return (
    <div className="flex flex-col flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+84px)]">
      {/* Header */}
      <div
        className="px-5 py-4 flex items-center gap-3"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <Link
          href="/record"
          className="w-9 h-9 rounded-lg grid place-items-center transition-colors"
          aria-label="Back"
          style={{ background: COLORS.surface }}
        >
          <Icon name="back" size={18} color={COLORS.t2} />
        </Link>
        <div className="text-[15px] font-bold" style={{ color: COLORS.w }}>
          {t("settings.title")}
        </div>
      </div>

      {/* Account */}
      <div className="px-5 pt-5">
        <div className={sectionLabel}>{t("settings.account")}</div>
        <div className="rounded-2xl overflow-hidden" style={cardStyle}>
          <div className="px-4 py-4 flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full grid place-items-center text-[14px] font-bold shrink-0"
              style={{
                background: COLORS.accentSoft,
                border: `1px solid ${COLORS.accent}40`,
                color: COLORS.accent,
              }}
            >
              {initial}
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold truncate" style={{ color: COLORS.w }}>
                {me.name ?? "Your account"}
              </div>
              <div className="text-[12px] truncate" style={{ color: COLORS.t3 }}>
                {me.email ?? "—"}
              </div>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
          <button
            type="button"
            onClick={() => setNameOpen(true)}
            className="w-full px-4 py-3.5 flex items-center justify-between gap-2 text-left cursor-pointer hover:bg-black/10 transition-colors"
          >
            <span>
              <span className="block text-[14px] font-semibold" style={{ color: COLORS.w }}>
                {t("settings.displayName")}
              </span>
              <span className="block text-[12px] mt-0.5" style={{ color: COLORS.t3 }}>
                {me.name ?? t("settings.addName")}
              </span>
            </span>
            <Icon name="edit" size={16} color={COLORS.t3} />
          </button>
        </div>
      </div>

      {/* Default languages */}
      <div className="px-5 pt-6">
        <div className={sectionLabel}>{t("settings.defaultLanguages")}</div>
        <LanguageSelector
          sourceLang={sourceLang}
          targetLang={targetLang}
          onChange={handleLangChange}
        />
        <div className="text-[12px] mt-2" style={{ color: COLORS.t3 }}>
          New recordings start with this pair.
        </div>
      </div>

      {/* App language (UI locale) */}
      <div className="px-5 pt-6">
        <div className={sectionLabel}>{t("settings.appLanguage")}</div>
        <div
          className="rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3"
          style={cardStyle}
        >
          <span className="text-[14px] font-semibold" style={{ color: COLORS.w }}>
            {t("settings.appLanguage")}
          </span>
          <LocaleSwitcher />
        </div>
      </div>

      {/* Subscription */}
      <div className="px-5 pt-6">
        <div className={sectionLabel}>{t("settings.subscription")}</div>
        {subscription === undefined ? (
          <div
            className="w-full rounded-2xl px-4 py-3.5"
            style={cardStyle}
          >
            <span className="block text-[14px] font-semibold" style={{ color: COLORS.t3 }}>
              Loading…
            </span>
          </div>
        ) : isPro ? (
          <button
            type="button"
            onClick={() => void goToStripe(createPortalSession)}
            disabled={billingBusy}
            className="w-full rounded-2xl px-4 py-3.5 flex items-center justify-between gap-2 text-left cursor-pointer hover:bg-black/10 transition-colors disabled:opacity-50"
            style={cardStyle}
          >
            <span>
              <span className="flex items-center gap-2">
                <span className="text-[14px] font-semibold" style={{ color: COLORS.w }}>
                  Tarjuman Pro
                </span>
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-[6px] py-[2px] rounded-md"
                  style={{ background: COLORS.accentSoft, color: COLORS.accent }}
                >
                  ✦ Pro
                </span>
              </span>
              <span className="block text-[12px] mt-0.5" style={{ color: COLORS.t3 }}>
                {billingBusy ? "Opening billing…" : `${proStatusLine} · Manage billing`}
              </span>
            </span>
            <Icon name="chevron" size={16} color={COLORS.t4} />
          </button>
        ) : !BILLING_ENABLED ? (
          // Billing not live yet — don't push a paid upgrade that routes to a
          // checkout we can't fulfill. Just confirm everything's unlocked.
          <div className="w-full rounded-2xl px-4 py-3.5" style={cardStyle}>
            <span className="block text-[14px] font-semibold" style={{ color: COLORS.w }}>
              {t("settings.free")}
            </span>
            <span className="block text-[12px] mt-0.5" style={{ color: COLORS.t3 }}>
              {t("settings.allUnlocked")}
            </span>
          </div>
        ) : (
          <Link
            href="/plans"
            className="w-full rounded-2xl px-4 py-3.5 flex items-center justify-between gap-2 text-left cursor-pointer hover:bg-black/10 transition-colors"
            style={cardStyle}
          >
            <span>
              <span className="block text-[14px] font-semibold" style={{ color: COLORS.w }}>
                Upgrade
              </span>
              <span className="block text-[12px] mt-0.5" style={{ color: COLORS.t3 }}>
                {`${PLAN_META.pro.priceLabel} · see all plans`}
              </span>
            </span>
            <Icon name="sparkle" size={16} color={COLORS.accent} />
          </Link>
        )}
        {!isPro &&
          plan &&
          plan.sessionsLimit !== null &&
          plan.summariesLimit !== null && (
            <div className="text-[12px] mt-2" style={{ color: COLORS.t3 }}>
              {plan.sessionsUsed} of {plan.sessionsLimit} sessions ·{" "}
              {plan.summariesUsed} of {plan.summariesLimit} summaries used this
              month.
            </div>
          )}
      </div>

      {/* Audio & voice */}
      <div className="px-5 pt-6">
        <div className={sectionLabel}>{t("settings.audioVoice")}</div>
        <div className="rounded-2xl overflow-hidden" style={cardStyle}>
          <Toggle
            label="Focus on main speaker"
            description="Drop other voices when several speakers are detected."
            checked={mainSpeakerOnly}
            onChange={toggleMain}
          />
        </div>
      </div>

      {/* Onboarding */}
      <div className="px-5 pt-6">
        <div className={sectionLabel}>{t("settings.onboarding")}</div>
        <button
          type="button"
          onClick={resetTips}
          disabled={tipsReset}
          className="w-full rounded-2xl px-4 py-3.5 flex items-center justify-between gap-2 text-left cursor-pointer hover:bg-black/10 transition-colors disabled:cursor-default"
          style={cardStyle}
        >
          <span>
            <span className="block text-[14px] font-semibold" style={{ color: COLORS.w }}>
              Show positioning tips again
            </span>
            <span className="block text-[12px] mt-0.5" style={{ color: COLORS.t3 }}>
              {tipsReset
                ? "Tips will show next time you record."
                : "Re-show the mic positioning guide."}
            </span>
          </span>
          {tipsReset ? (
            <Icon name="check" size={16} color={COLORS.accent} />
          ) : (
            <Icon name="chevron" size={16} color={COLORS.t4} />
          )}
        </button>
      </div>

      {/* Danger zone */}
      <div className="px-5 pt-6">
        <div className={sectionLabel} style={{ color: COLORS.red }}>
          {t("settings.dangerZone")}
        </div>
        <button
          type="button"
          onClick={() => setConfirmDeleteOpen(true)}
          disabled={deleting}
          className="w-full rounded-2xl px-4 py-3.5 flex items-center gap-2 text-left text-[14px] font-semibold cursor-pointer transition-colors disabled:opacity-50"
          style={{
            background: COLORS.redSoft,
            border: `1px solid ${COLORS.red}40`,
            color: COLORS.red,
          }}
        >
          <Icon name="trash" size={16} color={COLORS.red} />
          {deleting ? "Deleting…" : t("settings.deleteAccount")}
        </button>
        <div className="text-[12px] mt-2" style={{ color: COLORS.t3 }}>
          Permanently removes your account, sessions, and summaries. This cannot
          be undone.
        </div>
      </div>

      {/* Edit display name */}
      <PromptDialog
        open={nameOpen}
        onOpenChange={setNameOpen}
        title="Display name"
        label="Shown on your account and avatar."
        placeholder="Your name"
        defaultValue={me.name ?? ""}
        saveLabel="Save"
        onSave={async (value) => {
          await updateProfile({ name: value });
        }}
      />

      {/* Delete account — two-step confirm */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete your account?"
        message="All your sessions, transcripts, and summaries will be permanently removed. This cannot be undone."
        confirmLabel="Continue"
        destructive
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          setFinalDeleteOpen(true);
        }}
      />
      <ConfirmDialog
        open={finalDeleteOpen}
        onOpenChange={setFinalDeleteOpen}
        title="Last chance"
        message="Tap Delete to permanently erase your account and everything in it. There is no undo."
        confirmLabel="Delete forever"
        destructive
        onConfirm={performDelete}
      />
      <ConfirmDialog
        open={deleteErrorOpen}
        onOpenChange={setDeleteErrorOpen}
        title="Couldn't delete account"
        message={deleteErrorMessage}
        confirmLabel="OK"
        cancelLabel={null}
        onConfirm={() => setDeleteErrorOpen(false)}
      />

      {/* Billing error (Checkout / Portal failed to open) */}
      <ConfirmDialog
        open={billingErrorOpen}
        onOpenChange={setBillingErrorOpen}
        title="Billing unavailable"
        message={billingErrorMessage}
        confirmLabel="OK"
        cancelLabel={null}
        onConfirm={() => setBillingErrorOpen(false)}
      />
    </div>
  );
}

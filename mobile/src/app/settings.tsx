/**
 * Settings — port of src/app/(app)/settings/page.tsx.
 *
 * Sections (same order as the web): Account (avatar + name/email, display
 * name → PromptDialog), Default languages, App language (LocaleSwitcher),
 * Subscription (web-only billing → opens tarjuman.live; shown only when the web
 * shows it: BILLING_ENABLED, or dev builds ≙ SHOW_PRICING), Audio & voice
 * (main-speaker Toggle), Onboarding (re-show positioning tips), Danger zone
 * (two-step delete), plus native-only Sign out (the web keeps it in the account
 * menu) and the legal footer links.
 *
 * Motion:
 *   - Route enter: (app)/template.tsx fade + 8px rise, 200ms (ScreenEnter,
 *     replays on tab focus, skipped under Reduce Motion).
 *   - Loading: web Skeleton layout (90×11 + 50%×22 header bars; 64/100/64
 *     cards, radius 16), animate-pulse, rendered INSTEAD of the real header
 *     (web early return); the swap to content is instant (web).
 *   - Subscription block: web `useAutoAnimate({ duration: 220, easing:
 *     cubic-bezier(.22,1,.36,1) })` on the block's children —
 *       add:    scale .98 + opacity 0, held to the 50% offset, → 1/1 over
 *               330ms (220×1.5) with WAAPI whole-timeline `ease-in`;
 *       remove: scale 1/opacity 1 → .98/0, 220ms `ease-out`, taken out of
 *               flow while it plays (Reanimated's exiting ghost);
 *       remain: the block ITSELF is the mutation target, so its height glides
 *               220ms smooth curve, and every section below it (Audio,
 *               Onboarding, Sign out, Danger zone, Legal) glides with it —
 *               layout={billingLayout} on the block and on each of them.
 *     Initial children don't animate (auto-animate only animates mutations —
 *     LayoutAnimationConfig skipEntering). auto-animate disables itself under
 *     prefers-reduced-motion → all of the above is skipped under Reduce Motion.
 *   - Rows: `hover:bg-black/10 transition-colors` → pressed overlay, 150ms.
 *   - Toggle: foundation Toggle (row press bg, track colour, knob slide).
 *   - Delete: the web's three ConfirmDialogs (confirm → last chance → error)
 *     hand off in place: dialog A's overlay fades out and its card
 *     fade-out-0 + zoom-out-95 while dialog B's overlay fades in and its card
 *     fade-in-0 + zoom-in-95 — 150ms CSS ease each, so the two rgba(6,11,24,.4)
 *     overlays briefly stack (the web's double dim). Natively ONE <Modal>
 *     hosts a stack of keyed layers (overlay + glass card each, own presence
 *     progress); a stage change retires the top layer and pushes a new one,
 *     and a layer unmounts after its exit. Each card sizes to its own
 *     content, like the web's separate cards. Reduce Motion: unchanged —
 *     the web's tw-animate fade/zoom classes are not motion-gated.
 *   - Legal footer links: text t3 → accent while pressed, 150ms (legal
 *     layout footer `hover:text-accent transition-colors`).
 */
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, {
  Easing,
  interpolateColor,
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  type LayoutAnimation,
} from "react-native-reanimated";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { SymbolView } from "expo-symbols";
import { api } from "@convex/api";
import { BILLING_ENABLED, PLAN_META } from "../../../convex/billingLimits";
import { API_URL } from "~/lib/config";
import { C } from "~/lib/theme";
import { EASE, REDUCE_MOTION, useReduceMotion } from "~/lib/motion";
import { rtlRow, rtlText, useLocale } from "~/i18n";
import { ScreenEnter, Skeleton, PressableScale } from "~/components/motion";
import { AccountCard, FADE_GLASS_FRAME, FadeGlass, PressRow } from "~/components/account-card";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { LanguagePicker } from "~/components/language-picker";
import { Toggle } from "~/components/toggle";
import { PromptDialog } from "~/components/prompt-dialog";
import { ConfirmDialog, dialogStyles } from "~/components/confirm-dialog";
import { usePresenceProgress } from "~/components/motion/presence";

/** positioning-tips.tsx ACK_KEY (web "livetranscribe:positioning-tips-ack"). */
const POSITIONING_TIPS_ACK_KEY = "livetranscribe.positioning-tips-ack";
/** Same app defaults as the Record screen (index.tsx). */
const DEFAULT_SOURCE = "ar";
const DEFAULT_TARGET = "en";

// ─── auto-animate (billing block) ───────────────────────────────────────────

const AUTO_MS = 220;
/** CSS `ease-in` = bezier(.42,0,1,1) applied to the WHOLE keyframe timeline. */
const easeInFn = Easing.bezierFn(0.42, 0, 1, 1);
/** CSS `ease-out` = bezier(0,0,.58,1) (auto-animate's remove easing). */
const CSS_EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
/** Keyframes [.98/0, .98/0 @ .5, 1/1] under a whole-timeline ease-in. */
const autoAddProgress = (t: number) => {
  "worklet";
  const e = easeInFn(t);
  return e < 0.5 ? 0 : (e - 0.5) * 2;
};

const autoAdd = (_v: EntryAnimationsValues): LayoutAnimation => {
  "worklet";
  const d = REDUCE_MOTION.value ? 0 : AUTO_MS * 1.5;
  const cfg = { duration: d, easing: autoAddProgress, reduceMotion: ReduceMotion.Never };
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.98 }] },
    animations: { opacity: withTiming(1, cfg), transform: [{ scale: withTiming(1, cfg) }] },
  } as LayoutAnimation;
};

const autoRemove = (_v: ExitAnimationsValues): LayoutAnimation => {
  "worklet";
  const d = REDUCE_MOTION.value ? 0 : AUTO_MS;
  const cfg = { duration: d, easing: CSS_EASE_OUT, reduceMotion: ReduceMotion.Never };
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: { opacity: withTiming(0, cfg), transform: [{ scale: withTiming(0.98, cfg) }] },
  } as LayoutAnimation;
};

// ─── helpers ────────────────────────────────────────────────────────────────

/** lib/utils formatDate: en-US "Mon D". */
function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type DeleteStage = "confirm" | "final" | "error";

export default function SettingsScreen() {
  const router = useRouter();
  const { t, dir } = useLocale();
  const reduce = useReduceMotion();
  const me = useQuery(api.users.me);
  const prefs = useQuery(api.preferences.get);
  const subscription = useQuery(api.subscriptions.getMySubscription);
  const plan = useQuery(api.subscriptions.getMyUsageThisMonth, {});
  const updatePrefs = useMutation(api.preferences.update);
  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const { signOut } = useAuthActions();

  const [nameOpen, setNameOpen] = useState(false);
  // Optimistic local overrides so the toggle/pickers feel instant.
  const [localLangs, setLocalLangs] = useState<{ s: string; t: string } | null>(null);
  const [localMain, setLocalMain] = useState<boolean | null>(null);
  const [tipsReset, setTipsReset] = useState(false);
  // Delete flow (one dialog, staged — see header).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStage, setDeleteStage] = useState<DeleteStage>("confirm");
  const [deleteErrorMessage, setDeleteErrorMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const row = rtlRow(dir);
  const text = rtlText(dir);

  // Web returns early with ONLY the skeleton layout while loading: its bordered
  // 90×11 + 50%×22 skeleton header stands in for the real header.
  const loading = me === undefined || prefs === undefined;

  const body = (() => {
    if (loading) {
      return (
        <View>
          <View style={styles.skelHeader}>
            <Skeleton style={{ width: 90, height: 11 }} />
            <Skeleton style={{ width: "50%", height: 22 }} />
          </View>
          <View style={styles.skelCards}>
            <Skeleton style={{ width: "100%", height: 64 }} rounded={16} />
            <Skeleton style={{ width: "100%", height: 100 }} rounded={16} />
            <Skeleton style={{ width: "100%", height: 64 }} rounded={16} />
          </View>
        </View>
      );
    }
    if (me === null) return null;

    const sourceLang = localLangs?.s ?? prefs?.defaultSourceLanguage ?? DEFAULT_SOURCE;
    const targetLang = localLangs?.t ?? prefs?.defaultTargetLanguage ?? DEFAULT_TARGET;
    // The Record screen defaults this to ON (index.tsx) — show what it does.
    const mainSpeakerOnly = localMain ?? prefs?.mainSpeakerOnly ?? true;

    const isPro = subscription?.plan === "pro";
    const periodEnd = subscription && "currentPeriodEnd" in subscription ? subscription.currentPeriodEnd : null;
    const cancelAtEnd = subscription && "cancelAtPeriodEnd" in subscription ? subscription.cancelAtPeriodEnd : false;
    const proStatusLine = cancelAtEnd
      ? periodEnd
        ? t("settingsAuthNav.cancelsOn", { date: formatDate(periodEnd) })
        : t("settingsAuthNav.cancelsAtEnd")
      : periodEnd
        ? t("settingsAuthNav.renewsOn", { date: formatDate(periodEnd) })
        : t("settingsAuthNav.activeSubscription");
    const showUsage =
      !isPro && plan && plan.sessionsLimit !== null && plan.summariesLimit !== null;

    return (
      <>
        {/* Account */}
        <View style={styles.sectionFirst}>
          <Text style={[styles.sectionLabel, text]}>{t("settings.account")}</Text>
          {/* Profile picture: AccountCard ships a built-in photo-library picker
              (optional expo-image-picker). Once that package is installed and
              prebuilt, the avatar uploads IN PLACE with the spinning ring and
              the held edit overlay, as on the web. Until then it opens the web
              Settings page. */}
          <AccountCard me={me} onEditName={() => setNameOpen(true)} />
        </View>

        {/* Default languages */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, text]}>{t("settings.defaultLanguages")}</Text>
          <LanguagePicker
            source={sourceLang}
            target={targetLang}
            onChange={(next) => {
              setLocalLangs({ s: next.source, t: next.target });
              void updatePrefs({ defaultSourceLanguage: next.source, defaultTargetLanguage: next.target });
            }}
          />
          <Text style={[styles.hint, text]}>{t("settingsAuthNav.defaultPairHint")}</Text>
        </View>

        {/* App language (UI locale) */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, text]}>{t("settings.appLanguage")}</Text>
          {/* Web: rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3. */}
          <View style={[styles.card, styles.cardPad, styles.cardRow, { gap: 12 }, row]}>
            <Text style={[styles.rowTitle, { flexShrink: 1 }, text]}>{t("settings.appLanguage")}</Text>
            <LocaleSwitcher variant="row" />
          </View>
        </View>

        {/* Subscription — only where the web shows it (billing live, or dev ≙ SHOW_PRICING). */}
        {BILLING_ENABLED || __DEV__ ? (
          <LayoutAnimationConfig skipEntering>
            {/* auto-animate's `remain(parent)`: the block itself (the mutation
                target) glides its height 220ms, so everything below follows. */}
            <Animated.View style={styles.section} layout={billingLayout(reduce)}>
              <Animated.View layout={billingLayout(reduce)}>
                <Text style={[styles.sectionLabel, text]}>{t("settings.subscription")}</Text>
              </Animated.View>
              {subscription === undefined ? (
                <Animated.View key="loading" entering={autoAdd} exiting={autoRemove} layout={billingLayout(reduce)}>
                  <View style={[styles.card, styles.cardPad]}>
                    <Text style={[styles.rowTitle, { color: C.t3 }, text]}>{t("history.loading")}</Text>
                  </View>
                </Animated.View>
              ) : isPro ? (
                <Animated.View key="pro" entering={autoAdd} exiting={autoRemove} layout={billingLayout(reduce)}>
                  <PressRow
                    // Web row carries inline style={cardStyle}; its background
                    // beats `hover:bg-black/10`, so no press overlay (dim 0).
                    dim={0}
                    onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/plans/manage`).catch(() => {})}
                    style={[styles.card, styles.cardPad, styles.cardRow, row]}
                  >
                    <View style={{ flexShrink: 1 }}>
                      <View style={[styles.proTitleRow, row]}>
                        <Text style={styles.rowTitle}>{t("settingsAuthNav.proTitle")}</Text>
                        <View style={styles.proBadge}>
                          <Text style={styles.proBadgeText}>{t("settingsAuthNav.proBadge")}</Text>
                        </View>
                      </View>
                      <Text style={[styles.rowSub, text]}>
                        {t("settingsAuthNav.manageBilling", { status: proStatusLine })}
                      </Text>
                    </View>
                    <Chevron dir={dir} />
                  </PressRow>
                </Animated.View>
              ) : (
                <Animated.View key="upgrade" entering={autoAdd} exiting={autoRemove} layout={billingLayout(reduce)}>
                  <PressRow
                    accessibilityRole="link"
                    // Web row carries inline style={cardStyle}; its background
                    // beats `hover:bg-black/10`, so no press overlay (dim 0).
                    dim={0}
                    onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/plans`).catch(() => {})}
                    style={[styles.card, styles.cardPad, styles.cardRow, row]}
                  >
                    <View style={{ flexShrink: 1 }}>
                      <Text style={[styles.rowTitle, text]}>{t("settingsAuthNav.upgrade")}</Text>
                      <Text style={[styles.rowSub, text]}>
                        {t("settingsAuthNav.upgradeSub", { price: PLAN_META.pro.priceLabel })}
                      </Text>
                    </View>
                    <SymbolView name="sparkles" size={16} tintColor={C.accent} />
                  </PressRow>
                </Animated.View>
              )}
              {showUsage ? (
                <Animated.View key="usage" entering={autoAdd} exiting={autoRemove} layout={billingLayout(reduce)}>
                  <Text style={[styles.hint, text]}>
                    {t("settingsAuthNav.usageLine", {
                      su: plan.sessionsUsed,
                      sl: plan.sessionsLimit ?? 0,
                      mu: plan.summariesUsed,
                      ml: plan.summariesLimit ?? 0,
                    })}
                  </Text>
                </Animated.View>
              ) : null}
            </Animated.View>
          </LayoutAnimationConfig>
        ) : null}

        {/* Audio & voice */}
        <Animated.View style={styles.section} layout={billingLayout(reduce)}>
          <Text style={[styles.sectionLabel, text]}>{t("settings.audioVoice")}</Text>
          <View style={[styles.card, { overflow: "hidden" }]}>
            <Toggle
              label={t("settings.focusSpeaker")}
              description={t("settingsAuthNav.focusSpeakerDesc")}
              checked={mainSpeakerOnly}
              onChange={() => {
                const next = !mainSpeakerOnly;
                setLocalMain(next);
                void updatePrefs({ mainSpeakerOnly: next });
              }}
            />
          </View>
        </Animated.View>

        {/* Onboarding */}
        <Animated.View style={styles.section} layout={billingLayout(reduce)}>
          <Text style={[styles.sectionLabel, text]}>{t("settings.onboarding")}</Text>
          <PressRow
            // Web row: inline cardStyle background beats hover:bg-black/10 → no overlay.
            dim={0}
            onPress={() => {
              SecureStore.deleteItemAsync(POSITIONING_TIPS_ACK_KEY).catch(() => {});
              setTipsReset(true);
            }}
            disabled={tipsReset}
            style={[styles.card, styles.cardPad, styles.cardRow, row]}
          >
            <View style={{ flexShrink: 1 }}>
              <Text style={[styles.rowTitle, text]}>{t("settings.showTips")}</Text>
              <Text style={[styles.rowSub, text]}>
                {tipsReset ? t("settingsAuthNav.tipsResetDone") : t("settingsAuthNav.tipsResetSub")}
              </Text>
            </View>
            {tipsReset ? (
              <SymbolView name="checkmark" size={16} weight="semibold" tintColor={C.accent} />
            ) : (
              <Chevron dir={dir} />
            )}
          </PressRow>
        </Animated.View>

        {/* Sign out (native: the web keeps this in the account menu) */}
        <Animated.View style={styles.section} layout={billingLayout(reduce)}>
          <PressRow
            onPress={() => setSignOutOpen(true)}
            dim={0.2}
            style={[styles.card, styles.cardPad, styles.cardRow, row, { justifyContent: "flex-start" }]}
          >
            <SymbolView name="xmark" size={14} tintColor={C.t3} />
            <Text style={[styles.rowTitle, { color: C.t2 }]}>{t("settingsAuthNav.signOut")}</Text>
          </PressRow>
        </Animated.View>

        {/* Danger zone */}
        <Animated.View style={styles.section} layout={billingLayout(reduce)}>
          <Text style={[styles.sectionLabel, { color: C.red }, text]}>{t("settings.dangerZone")}</Text>
          <PressRow
            onPress={() => {
              setDeleteStage("confirm");
              setDeleteOpen(true);
            }}
            disabled={deleting}
            disabledOpacity={0.5}
            // Web danger button is `transition-colors disabled:opacity-50` with
            // NO hover:bg — so no press overlay here either.
            dim={0}
            style={[styles.danger, row]}
          >
            <SymbolView name="trash" size={16} tintColor={C.red} />
            <Text style={styles.dangerText}>
              {deleting ? t("settingsAuthNav.deleting") : t("settings.deleteAccount")}
            </Text>
          </PressRow>
          <Text style={[styles.hint, text]}>{t("settingsAuthNav.deleteWarning")}</Text>
        </Animated.View>

        {/* Legal (legal layout footer links) */}
        <Animated.View style={[styles.legal, row]} layout={billingLayout(reduce)}>
          <LegalLink label={t("settingsAuthNav.privacy")} path="/privacy" />
          <LegalLink label={t("settingsAuthNav.terms")} path="/terms" />
        </Animated.View>

        {/* Edit display name */}
        <PromptDialog
          open={nameOpen}
          onOpenChange={setNameOpen}
          title={t("settings.displayName")}
          label={t("settingsAuthNav.displayNameLabel")}
          placeholder={t("settingsAuthNav.displayNamePlaceholder")}
          defaultValue={me.name ?? ""}
          onSave={async (value) => {
            await updateProfile({ name: value });
          }}
        />
      </>
    );
  })();

  const performDelete = async () => {
    setDeleteOpen(false);
    setDeleting(true);
    try {
      await deleteAccount({});
      await signOut(); // the auth gate then routes to Welcome
    } catch (e) {
      setDeleting(false);
      setDeleteErrorMessage(
        t("settingsAuthNav.deleteErrorMessage", { error: e instanceof Error ? e.message : String(e) })
      );
      setDeleteStage("error");
      setDeleteOpen(true);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenEnter style={{ flex: 1 }}>
        {/* Header (web: back button + title). Settings is a pushed screen
            opened from the profile popup, so the back tile returns to where
            the user came from. While loading, the skeleton's own header bars
            take its place (web). */}
        {loading ? null : (
          <View style={[styles.header, row]}>
            <PressableScale
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
              accessibilityRole="button"
              accessibilityLabel={t("settingsAuthNav.back")}
              style={styles.back}
            >
              <SymbolView
                name={dir === "rtl" ? "chevron.right" : "chevron.left"}
                size={16}
                weight="semibold"
                tintColor={C.t2}
              />
            </PressableScale>
            <Text style={styles.headerTitle} accessibilityRole="header">
              {t("settings.title")}
            </Text>
          </View>
        )}
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      </ScreenEnter>

      <DeleteAccountDialog
        open={deleteOpen}
        stage={deleteStage}
        errorMessage={deleteErrorMessage}
        onClose={() => setDeleteOpen(false)}
        onContinue={() => setDeleteStage("final")}
        onDelete={() => void performDelete()}
      />
      <ConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title={t("settingsAuthNav.signOutConfirmTitle")}
        message={t("settingsAuthNav.signOutConfirmMessage")}
        confirmLabel={t("settingsAuthNav.signOut")}
        destructive
        onConfirm={async () => {
          await signOut();
        }}
      />
    </SafeAreaView>
  );
}

/** Siblings of the billing block glide 220ms on the auto-animate curve. */
function billingLayout(reduce: boolean) {
  return reduce ? undefined : LinearTransition.duration(AUTO_MS).easing(EASE.smooth);
}

function Chevron({ dir }: { dir: "ltr" | "rtl" }) {
  return (
    <SymbolView name={dir === "rtl" ? "chevron.left" : "chevron.right"} size={14} weight="semibold" tintColor={C.t4} />
  );
}

/** Legal footer link: t3 → accent while pressed, transition-colors 150ms. */
function LegalLink({ label, path }: { label: string; path: string }) {
  const p = useSharedValue(0);
  const color = useAnimatedStyle(() => ({
    color: interpolateColor(p.value, [0, 1], [C.t3, C.accent]) as string,
  }));
  const cfg = { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never };
  return (
    <Pressable
      accessibilityRole="link"
      hitSlop={8}
      onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}${path}`).catch(() => {})}
      onPressIn={() => {
        p.value = withTiming(1, cfg);
      }}
      onPressOut={() => {
        p.value = withTiming(0, cfg);
      }}
    >
      <Animated.Text style={[styles.legalText, color]}>{label}</Animated.Text>
    </Pressable>
  );
}

// ─── Delete-account dialog ───────────────────────────────────────────────────

/** Radix overlay/card `fade-*-0` + `zoom-*-95 duration-150`, CSS ease. */
const DIALOG_T = { duration: 150, easing: EASE.css };

interface DeleteLayer {
  id: number;
  stage: DeleteStage;
  open: boolean;
}

function DeleteAccountDialog({
  open,
  stage,
  errorMessage,
  onClose,
  onContinue,
  onDelete,
}: {
  open: boolean;
  stage: DeleteStage;
  errorMessage: string;
  onClose: () => void;
  onContinue: () => void;
  onDelete: () => void;
}) {
  // A stack of dialog layers in ONE Modal: the top one is live, the ones
  // below are playing their exit (see header).
  const [layers, setLayers] = useState<DeleteLayer[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const id = nextId.current + 1;
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (!open) {
        return prev.some((l) => l.open) ? prev.map((l) => (l.open ? { ...l, open: false } : l)) : prev;
      }
      if (top && top.open && top.stage === stage) return prev;
      nextId.current = id;
      return [...prev.map((l) => (l.open ? { ...l, open: false } : l)), { id, stage, open: true }];
    });
  }, [open, stage]);

  const removeLayer = (id: number) => setLayers((prev) => prev.filter((l) => l.id !== id));

  return (
    <Modal
      visible={layers.length > 0}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {layers.map((l) => (
        <DeleteDialogLayer
          key={l.id}
          open={l.open}
          stage={l.stage}
          errorMessage={errorMessage}
          onClose={onClose}
          onContinue={onContinue}
          onDelete={onDelete}
          onExited={() => removeLayer(l.id)}
        />
      ))}
    </Modal>
  );
}

function DeleteDialogLayer({
  open,
  stage,
  errorMessage,
  onClose,
  onContinue,
  onDelete,
  onExited,
}: {
  open: boolean;
  stage: DeleteStage;
  errorMessage: string;
  onClose: () => void;
  onContinue: () => void;
  onDelete: () => void;
  onExited: () => void;
}) {
  const { t } = useLocale();
  const { progress } = usePresenceProgress(open, { enter: DIALOG_T, exit: DIALOG_T, onExited });
  const overlay = useAnimatedStyle(() => ({ opacity: progress.value }));
  // The card's fade never puts alpha on the blur's ancestor (UIKit drops the
  // blur mid-fade): FadeGlass ramps blur intensity + fades tint/frame, and
  // the text/actions fade in their own layer.
  const cardContent = useAnimatedStyle(() => ({ opacity: progress.value }));
  const card = useAnimatedStyle(() => ({
    // tw-animate zoom-95 is not motion-gated on the web — it plays under
    // Reduce Motion too.
    transform: [{ scale: 0.95 + 0.05 * progress.value }],
  }));

  const copy =
    stage === "confirm"
      ? {
          title: t("settingsAuthNav.deleteTitle"),
          message: t("settingsAuthNav.deleteMessage"),
          confirm: t("settingsAuthNav.continue"),
          destructive: true,
          cancel: true,
          action: onContinue,
        }
      : stage === "final"
        ? {
            title: t("settingsAuthNav.lastChanceTitle"),
            message: t("settingsAuthNav.lastChanceMessage"),
            confirm: t("settingsAuthNav.deleteForever"),
            destructive: true,
            cancel: true,
            action: onDelete,
          }
        : {
            title: t("settingsAuthNav.deleteErrorTitle"),
            message: errorMessage,
            confirm: t("settingsAuthNav.ok"),
            destructive: false,
            cancel: false,
            action: onClose,
          };

  return (
    // A retiring layer ignores touches while it fades out beneath the new one.
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? "box-none" : "none"}>
      {/* AlertDialog overlay: no dismiss on tap. */}
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[StyleSheet.absoluteFill, styles.dialogOverlay, overlay]}
      />
      <View style={styles.dialogCenter} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal={open}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "yes" : "no-hide-descendants"}
          accessibilityLabel={copy.title}
          style={[styles.dialogCard, FADE_GLASS_FRAME, card]}
        >
          <FadeGlass progress={progress} radius={24} />
          <Animated.View style={cardContent}>
            <Text style={dialogStyles.title} accessibilityRole="header">
              {copy.title}
            </Text>
            <Text style={dialogStyles.message}>{copy.message}</Text>
            <View style={dialogStyles.actions}>
              {copy.cancel ? (
                <Pressable onPress={onClose} style={dialogStyles.cancel} accessibilityRole="button">
                  <Text style={dialogStyles.cancelText}>{t("foundation.cancel")}</Text>
                </Pressable>
              ) : null}
              <PressableScale
                onPress={copy.action}
                scaleTo={0.98}
                accessibilityRole="button"
                style={[dialogStyles.confirm, { backgroundColor: copy.destructive ? C.red : C.accent }]}
              >
                <Text style={[dialogStyles.confirmText, { color: copy.destructive ? C.w : "#0A0F1C" }]}>
                  {copy.confirm}
                </Text>
              </PressableScale>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { color: C.w, fontSize: 15, fontWeight: "700" },
  // web: w-9 h-9 rounded-lg grid place-items-center, background surface
  back: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: C.surface },
  // No tab bar under a pushed screen — just room past the home indicator.
  scroll: { paddingBottom: 48 },
  skelHeader: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  skelCards: { paddingHorizontal: 20, paddingVertical: 20, gap: 20 },
  sectionFirst: { paddingHorizontal: 20, paddingTop: 20 },
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.88,
    textTransform: "uppercase",
    color: C.t3,
    marginBottom: 8,
  },
  card: {
    borderRadius: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardPad: { paddingHorizontal: 16, paddingVertical: 14 },
  cardRow: { alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowTitle: { color: C.w, fontSize: 14, fontWeight: "600" },
  rowSub: { color: C.t3, fontSize: 12, marginTop: 2 },
  hint: { color: C.t3, fontSize: 12, marginTop: 8 },
  proTitleRow: { alignItems: "center", gap: 8 },
  proBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: C.accentSoft },
  proBadgeText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.9, textTransform: "uppercase", color: C.accent },
  danger: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    gap: 8,
    backgroundColor: C.redSoft,
    borderWidth: 1,
    borderColor: `${C.red}40`,
  },
  dangerText: { color: C.red, fontSize: 14, fontWeight: "600" },
  legal: { paddingHorizontal: 20, paddingTop: 28, gap: 16 },
  dialogOverlay: { backgroundColor: "rgba(6, 11, 24, 0.4)" },
  dialogCenter: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  dialogCard: { width: "100%", maxWidth: 420, borderRadius: 24, padding: 24 },
  legalText: { fontSize: 12 },
});

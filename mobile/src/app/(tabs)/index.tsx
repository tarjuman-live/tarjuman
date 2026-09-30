/**
 * Record screen — native port of src/app/(app)/record/page.tsx +
 * components/recording/recording-shell.tsx.
 *
 * Recording / STT / translation / persistence logic is unchanged from the
 * pre-animation version (see the "Controls" and "Persistence" sections); this
 * file only re-dresses the UI in the web's motion:
 *
 *   - Screen states idle ⇄ live shell ⇄ mic error: the web swaps them instantly;
 *     per the house "everything fluid" rule they crossfade here (200ms CSS ease,
 *     both layers absolutely filled so nothing jumps). The route enter (fade +
 *     8px rise, 200ms) replays on every tab focus via a local <ScreenEnter> copy
 *     that skips the one replay after returning from the completed push.
 *   - Status header: 10px dot + 13px label, colour red (Recording) / amber
 *     (Paused) with a static `0 0 8px color@60` glow; swaps instantly (web). Timer
 *     ticks every 250ms (web useSessionTimer) with no digit animation.
 *   - Language bar: three 4px dots chase every 600ms while connected and not
 *     paused (each dot crossfades accent ↔ accent@30 over 150ms tw); amber
 *     "Connecting…" / "Reconnecting… (attempt N)" or red "Transcription offline"
 *     replace them instantly. Layout toggle (stacked ⇄ split): selected
 *     segment bg transparent ↔ accentSoft 150ms tw, stroke swaps instantly;
 *     the transcript view swap is instant (rows replay their entrance).
 *   - Speaker bar (once >1 speaker was seen) with the Main-speaker chip:
 *     bg surfaceLight ↔ accent, text t2 ↔ #0A0F1C, border borderLight ↔ none,
 *     150ms tw.
 *   - Controls: .rec-ctl circles (see components/record-button.tsx).
 *   - Bottom nav: hidden while recording AND on the completed view (web
 *     hideNav = isActive || completedSession) via
 *     setRecordNavHidden → the tabs layout's JS-drawn BottomNav reads
 *     useRecordNavHidden() and slides translateY 0 ↔ (100% + 28px) over 320ms
 *     bezier(.4,0,.2,1) with a 320ms CSS-ease fade, both directions (web
 *     bottom-nav.tsx). The bar floats (absolute), so hiding it never changes
 *     this screen's bottom inset — no layout jump under the controls.
 *   - OS-interruption banner (web recording-shell.tsx): amber, tappable,
 *     "Recording paused by your device" while a call / Siri / another app holds
 *     the mic and no frames are flowing; tap → recover. Faded in/out (150ms).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AudioManager } from "react-native-audio-api";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import Animated, {
  interpolateColor,
  LayoutAnimationConfig,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import Svg, { Rect } from "react-native-svg";
import { api } from "@convex/api";
import type { Id } from "@convex/dataModel";
import { SEGMENT_FLUSH_INTERVAL_MS } from "@shared/constants";
import { stopTailSegment, takeFlushableSegments } from "@shared/recording-persistence";
import { LanguagePicker } from "~/components/language-picker";
import { AudioVisualizer } from "~/components/audio-visualizer";
import { IdleRecordButton, RecCtl, setRecordNavHidden } from "~/components/record-button";
import { MicErrorState } from "~/components/mic-error-state";
import { UpgradeCard } from "~/components/upgrade-card";
import { RecentSessions } from "~/components/recent-sessions";
import { PositioningTips } from "~/components/positioning-tips";
import { LocaleSwitcher, useRailLayout } from "~/components/locale-switcher";
import { SplitTranscript } from "~/components/split-transcript";
import { Transcript, type TranscriptRow } from "~/components/transcript";
import { AnchoredPopover, PressableScale, Spinner, usePulse } from "~/components/motion";
import { useLiveStt } from "~/hooks/use-live-stt";
import { useLiveTranslator } from "~/hooks/use-live-translator";
import { useNativeRecorder } from "~/hooks/use-native-recorder";
import { makeId } from "~/lib/ids";
import { formatDuration, langName } from "~/lib/lang";
import { C } from "~/lib/theme";
import { EASE, twEnter, twExit, TW_ENTER, TW_EXIT, useReduceMotion } from "~/lib/motion";
import { useLocale } from "~/i18n";

const DEFAULT_SOURCE = "ar";
const DEFAULT_TARGET = "en";

type TranscriptLayout = "paired" | "split";
/** Web localStorage "tarjuman:transcript-layout" (SecureStore: no colons). */
const LAYOUT_KEY = "tarjuman.transcript-layout";

/** Screen-state crossfade (house fluid rule; web swaps instantly). */
const SWAP_IN = twEnter({ opacity: 0, duration: 200 });
const SWAP_OUT = twExit({ opacity: 0, duration: 200 });

const TW_150 = { duration: 150, easing: EASE.tw, reduceMotion: ReduceMotion.Never };

function readLayout(wide: boolean): TranscriptLayout {
  try {
    const v = SecureStore.getItem(LAYOUT_KEY);
    if (v === "split" || v === "paired") return v;
  } catch {
    /* keychain unavailable */
  }
  // Web: split by default only on ≥1024px (desktop); stacked on phones.
  return wide ? "split" : "paired";
}

export default function RecordScreen() {
  const router = useRouter();
  const { t, dir } = useLocale();
  const rtl = dir === "rtl";
  const { width } = useWindowDimensions();
  // ≥1024pt: the SidebarRail is the tab bar and carries brand + locale pill +
  // account menu, so the idle header is dropped entirely (web record/page.tsx
  // `lg:hidden` on the brand row + its border) and the idle column takes the
  // web's lg: layout (max-w-2xl centred, px-8, pt-12, no bottom-nav padding).
  const { railActive } = useRailLayout();
  const prefs = useQuery(api.preferences.get);
  const usage = useQuery(api.subscriptions.getMyUsageThisMonth);
  const updatePrefs = useMutation(api.preferences.update);
  const createSession = useMutation(api.sessions.createSession);
  const addSegments = useMutation(api.sessions.addSegments);
  const updateSegmentMerge = useMutation(api.sessions.updateSegmentMerge);
  const pauseSession = useMutation(api.sessions.pauseSession);
  const resumeSession = useMutation(api.sessions.resumeSession);
  const completeSession = useMutation(api.sessions.completeSession);

  // Local override of the saved default pair; null = follow preferences.
  const [picked, setPicked] = useState<{ source: string; target: string } | null>(null);
  const source = picked?.source ?? prefs?.defaultSourceLanguage ?? DEFAULT_SOURCE;
  const target = picked?.target ?? prefs?.defaultTargetLanguage ?? DEFAULT_TARGET;
  // "Ignore side conversations" defaults ON, matching the web record page.
  // The live chip flips it immediately (web keeps local state) and persists it.
  const [mainOverride, setMainOverride] = useState<boolean | null>(null);
  const mainSpeakerOnly = mainOverride ?? prefs?.mainSpeakerOnly ?? true;
  useEffect(() => {
    if (mainOverride !== null && prefs?.mainSpeakerOnly === mainOverride) setMainOverride(null);
  }, [prefs?.mainSpeakerOnly, mainOverride]);
  const toggleMainSpeaker = () => {
    const next = !mainSpeakerOnly;
    setMainOverride(next);
    void updatePrefs({ mainSpeakerOnly: next });
  };

  // Transcript layout: stacked cards ("paired") vs split panes. Local pref.
  const [layout, setLayoutState] = useState<TranscriptLayout>(() => readLayout(width >= 1024));
  const setLayout = (l: TranscriptLayout) => {
    setLayoutState(l);
    SecureStore.setItemAsync(LAYOUT_KEY, l).catch(() => {});
  };

  // Free users past their monthly cap get the upgrade card instead of Record.
  const overSessionLimit = usage ? !usage.canStartSession : false;

  const recorder = useNativeRecorder();
  const active = recorder.phase === "recording" || recorder.phase === "paused";
  const stt = useLiveStt({
    recorder,
    sourceLanguage: source,
    enabled: active,
    paused: recorder.phase === "paused",
    mainSpeakerOnly,
  });
  const translator = useLiveTranslator({
    segments: stt.segments,
    sourceLanguage: source,
    targetLanguage: target,
  });

  // ── Pause-aware timer ────────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef({ accumulated: 0, since: null as number | null });
  const elapsedNow = () => {
    const t = timerRef.current;
    return t.accumulated + (t.since !== null ? (Date.now() - t.since) / 1000 : 0);
  };
  useEffect(() => {
    if (recorder.phase !== "recording") return;
    // 250ms, like the web's useSessionTimer (500 let the second lag visibly).
    const id = setInterval(() => setElapsed(elapsedNow()), 250);
    return () => clearInterval(id);
  }, [recorder.phase]);

  // ── Persistence (batched every 5s, forced on Stop) ────────────────────────
  const sessionIdRef = useRef<Id<"sessions"> | null>(null);
  const flushedRef = useRef(new Set<string>());
  const patchedMergesRef = useRef(new Set<string>());
  const latest = useRef({ stt, translator, source, target });
  useEffect(() => {
    latest.current = { stt, translator, source, target };
  });

  const flush = (force = false) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const { stt: s, translator: tr, source: src, target: tgt } = latest.current;
    const stored = takeFlushableSegments({
      segments: s.segments,
      flushed: flushedRef.current,
      filteredIds: tr.filteredIds,
      completedIds: tr.completedIds,
      translations: tr.translations,
      merges: tr.merges,
      sameLanguage: src === tgt,
      force,
    });
    // Convex queues mutations in order and retries across reconnects.
    if (stored.length) void addSegments({ sessionId, segments: stored });
  };

  useEffect(() => {
    if (recorder.phase !== "recording") return;
    const id = setInterval(() => flush(), SEGMENT_FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
    // flush reads live state through `latest`; binding to phase is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.phase]);

  // A verse/hadith merge can land after its parent was already saved — patch it.
  useEffect(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    for (const [parentId, m] of Object.entries(translator.merges)) {
      if (!flushedRef.current.has(parentId) || patchedMergesRef.current.has(parentId)) continue;
      patchedMergesRef.current.add(parentId);
      void updateSegmentMerge({
        sessionId,
        parentSegmentId: parentId,
        mergedFromIds: m.fromIds,
        combinedSourceText: m.combinedSourceText,
        combinedTranslatedText: m.combinedTranslatedText,
      });
    }
  }, [translator.merges, updateSegmentMerge]);

  // ── Controls ─────────────────────────────────────────────────────────────
  const [stopping, setStopping] = useState(false);
  // Web record/page.tsx keeps the nav hidden on the "Session complete" view
  // (hideNav = isActive || completedSession !== null) and only slides it back
  // in when the user leaves it (Done). Native shows that view as a pushed
  // screen, so the Record tab holds its live pose — nav hidden, live shell up,
  // controls frozen — until it regains focus after the push; THEN the nav's
  // 320ms slide-in and the live → idle crossfade play, on screen, like the web.
  const [completedPending, setCompletedPending] = useState(false);
  const completedPendingRef = useRef(false);
  /** Skip the one route-enter replay on that return (web: no route change). */
  const skipEnterRef = useRef(false);
  const { autostart } = useLocalSearchParams<{ autostart?: string }>();
  const autostartRef = useRef(autostart);
  autostartRef.current = autostart;
  const endCompletedPending = () => {
    completedPendingRef.current = false;
    setCompletedPending(false);
  };
  useFocusEffect(
    useCallback(() => {
      if (!completedPendingRef.current) return;
      // "New recording" returns with autostart=1: stay in the live pose until
      // the new capture is up (handleRecord clears it), so the nav doesn't
      // flash in and back out between the two sessions.
      if (autostartRef.current === "1") return;
      endCompletedPending();
    }, []),
  );

  const handleRecord = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    stt.reset();
    translator.reset();
    flushedRef.current = new Set();
    patchedMergesRef.current = new Set();
    timerRef.current = { accumulated: 0, since: null };
    setElapsed(0);
    const ok = await recorder.start();
    if (completedPendingRef.current) endCompletedPending();
    if (!ok) return;
    timerRef.current.since = Date.now();
    try {
      sessionIdRef.current = await createSession({
        sourceLanguage: source,
        targetLanguage: target,
      });
    } catch {
      // Transcription still works; it just won't be saved. Say so now rather
      // than after a 40-minute lecture.
      Alert.alert(t("record.notSavingTitle"), t("record.notSavingBody"));
    }
  };

  const handlePause = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const t = timerRef.current;
    t.accumulated = elapsedNow();
    t.since = null;
    setElapsed(t.accumulated);
    recorder.pause();
    flush();
    if (sessionIdRef.current) void pauseSession({ sessionId: sessionIdRef.current });
  };

  const handleResume = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    timerRef.current.since = Date.now();
    recorder.resume();
    if (sessionIdRef.current) void resumeSession({ sessionId: sessionIdRef.current });
  };

  const handleStop = async () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStopping(true);
    const duration = Math.round(elapsedNow());
    timerRef.current = { accumulated: duration, since: null };
    const tailText = stt.interimText;
    const idsBeforeStop = new Set(stt.segments.map((s) => s.id));

    await recorder.stop();
    // Stopping disables STT; the session core flushes its half-built sentence
    // as a final segment on the next render. Let that land before persisting.
    await new Promise((r) => setTimeout(r, 150));

    const sessionId = sessionIdRef.current;
    const { stt: s, source: src, target: tgt } = latest.current;
    if (sessionId) {
      flush(true);
      // Rescue the words on screen at Stop (often the closing du'a) — unless
      // the flushed final sentence already carries them.
      const flushedAtStop = s.segments.filter((seg) => !idsBeforeStop.has(seg.id));
      const tail = stopTailSegment(tailText, src, duration, makeId);
      if (tail && !flushedAtStop.some((seg) => seg.text.includes(tail.sourceText))) {
        void addSegments({ sessionId, segments: [tail] });
      }
      void completeSession({
        sessionId,
        duration,
        sourceLanguage: src,
        targetLanguage: tgt,
      });
      sessionIdRef.current = null;
      // `completed=1` → the detail screen shows the web completed-view footer
      // (Copy / New recording / Done) instead of the history-detail action bar.
      completedPendingRef.current = true;
      skipEnterRef.current = true;
      setCompletedPending(true);
      router.push({ pathname: "/session/[id]", params: { id: sessionId, completed: "1" } });
    } else {
      setElapsed(0);
    }
    setStopping(false);
  };

  // ── "New recording" from the completed view (web completed-view.tsx
  // onNewRecording starts a fresh capture immediately). The session screen
  // dismisses back here with `autostart=1`; consume it once, then clear it so
  // a later re-render / tab focus can't start a second recording.
  useEffect(() => {
    if (autostart !== "1") return;
    router.setParams({ autostart: undefined });
    if (recorder.phase === "idle" || recorder.phase === "error") void handleRecord();
    // handleRecord reads live state; only the param edge matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart]);

  // ── Nav visibility (web: hide the bottom nav while a session is live) ────
  const live = active || stopping || completedPending;
  // Frozen controls while stopping AND while the completed screen is up (the
  // spinner keeps turning under the outgoing push instead of snapping back).
  const finishing = stopping || completedPending;
  useEffect(() => {
    setRecordNavHidden(live);
  }, [live]);
  useEffect(() => () => setRecordNavHidden(false), []);

  // ── OS interruption (web: recorder.interrupted / recorder.recover) ───────
  // A call, Siri or another app takes the audio session mid-recording. The
  // hook auto-resumes only when iOS says `shouldResume`; otherwise the UI
  // would keep saying "Recording" over silence. This screen detects it: an
  // interruption "began" with no PCM frame since. The first frame that flows
  // again (auto-resume or a successful recover) clears it — so the banner never
  // claims recovery that didn't happen. Extra listener only; the hook's own
  // listener is untouched (the emitter is subscription-id based, so both
  // receive every event). Tap → recorder.recover() (web recorder.recover()):
  // re-activates the session AND restarts the interrupted audio engine through
  // the recorder's resume path — session activation alone never restarts it.
  const [osInterrupted, setOsInterrupted] = useState(false);
  useEffect(() => {
    if (!active) {
      setOsInterrupted(false);
      return;
    }
    const sub = AudioManager.addSystemEventListener("interruption", (e) => {
      if (e.type === "began") setOsInterrupted(true);
    });
    return () => sub?.remove();
  }, [active]);
  const subscribeFrames = recorder.subscribe;
  useEffect(() => {
    if (!osInterrupted) return;
    return subscribeFrames(() => setOsInterrupted(false));
  }, [osInterrupted, subscribeFrames]);
  const interrupted = osInterrupted;
  const handleRecover = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // The banner stays up until frames actually flow again.
    recorder.recover();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const rows: TranscriptRow[] = useMemo(
    () =>
      stt.segments
        .filter((s) => !translator.filteredIds.has(s.id) && !translator.suppressedIds.has(s.id))
        .map((s) => {
          const merge = translator.merges[s.id];
          return {
            id: s.id,
            sourceText: merge?.combinedSourceText ?? s.text,
            translatedText: merge?.combinedTranslatedText ?? translator.translations[s.id],
            error: translator.errors[s.id],
            // Web `pending` (in-flight set): keeps "…translating" up while a
            // streamed partial is "" (meta-guard hold / sentinel-first trailer).
            pending: !translator.completedIds.has(s.id) && !translator.errors[s.id],
            // Diarization → per-speaker tint/badge + the render-time
            // main-speaker filter (web live-transcript / split-transcript).
            speaker: s.speaker,
            durationSec: s.durationSec,
          };
        }),
    [stt.segments, translator],
  );

  // Show the speaker filter only once multiple speakers were actually seen.
  const speakerCount = useMemo(() => {
    const set = new Set<number>();
    for (const s of stt.segments) if (typeof s.speaker === "number") set.add(s.speaker);
    return set.size;
  }, [stt.segments]);

  const view: "live" | "error" | "idle" = live ? "live" : recorder.phase === "error" ? "error" : "idle";
  const paused = recorder.phase === "paused";
  const row = { flexDirection: rtl ? ("row-reverse" as const) : ("row" as const) };
  // Web `ml-2` on the dots / status label, on top of the bar's gap-2: 16px
  // after the target-language name. Leading side follows the row direction.
  const lead = rtl ? { marginRight: 8 } : { marginLeft: 8 };

  const header = (withLocale: boolean) => (
    <View style={[styles.appHeader, row]}>
      <View style={[styles.brand, row]}>
        <SymbolView name="globe" tintColor={C.accent} size={18} />
        <Text style={styles.brandText}>{t("record.brand")}</Text>
      </View>
      <View style={[styles.headerActions, row]}>
        {withLocale ? <LocaleSwitcher variant="pill" /> : null}
        <AccountMenu />
      </View>
    </View>
  );

  return (
    <RecordScreenEnter skipRef={skipEnterRef}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <LayoutAnimationConfig skipEntering>
          <View style={styles.stage}>
            {view === "idle" ? (
              <Animated.View key="idle" entering={SWAP_IN} exiting={SWAP_OUT} style={styles.layer}>
                {railActive ? null : header(true)}
                <ScrollView
                  contentContainerStyle={[styles.idle, railActive && styles.idleWide]}
                  showsVerticalScrollIndicator={false}
                  contentInsetAdjustmentBehavior="never"
                >
                  <LanguagePicker
                    source={source}
                    target={target}
                    onChange={setPicked}
                    disabled={recorder.phase === "starting"}
                  />

                  {overSessionLimit ? (
                    <UpgradeCard
                      title={t("record.limitTitle")}
                      message={t("record.limitBody", { limit: String(usage?.sessionsLimit ?? "") })}
                    />
                  ) : (
                    <>
                      <View style={styles.recordArea}>
                        <IdleRecordButton
                          onPress={handleRecord}
                          disabled={recorder.phase === "starting"}
                          accessibilityLabel={t("record.startRecording")}
                        />
                        <Text style={styles.recordHint}>
                          {recorder.phase === "starting" ? t("record.starting") : t("record.tapToStart")}
                        </Text>
                      </View>
                      {usage && usage.plan === "free" && usage.sessionsLimit !== null ? (
                        <Text style={styles.usage}>
                          {t("record.sessionsUsage", {
                            used: String(usage.sessionsUsed),
                            limit: String(usage.sessionsLimit),
                          })}
                        </Text>
                      ) : null}
                    </>
                  )}

                  <PositioningTips />
                  <RecentSessions />
                </ScrollView>
              </Animated.View>
            ) : view === "error" ? (
              <Animated.View key="error" entering={SWAP_IN} exiting={SWAP_OUT} style={styles.layer}>
                {header(false)}
                <MicErrorState
                  permissionDenied={!!recorder.error?.startsWith("Microphone access is off")}
                  message={recorder.error}
                  onRetry={handleRecord}
                />
              </Animated.View>
            ) : (
              <Animated.View key="live" entering={SWAP_IN} exiting={SWAP_OUT} style={styles.layer}>
                {/* Header: status dot + label + timer */}
                <View style={[styles.statusHeader, row]}>
                  <View style={[styles.statusLeft, row]}>
                    <View
                      style={[
                        styles.dot,
                        {
                          backgroundColor: paused ? C.amber : C.red,
                          boxShadow: `0 0 8px ${paused ? C.amber : C.red}60`,
                        },
                      ]}
                    />
                    <Text style={[styles.statusLabel, { color: paused ? C.amber : C.red }]}>
                      {paused ? t("record.paused") : t("record.recording")}
                    </Text>
                  </View>
                  <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
                </View>

                {/* Language bar + connection status + layout toggle */}
                <View style={styles.langBar}>
                  <View style={[styles.langBarCenter, row]}>
                    <Text style={styles.langSrc}>{langName(source)}</Text>
                    <Text style={styles.langArrow}>{rtl ? "←" : "→"}</Text>
                    <Text style={styles.langTgt}>{langName(target)}</Text>
                    {stt.connectionState === "connected" && !paused ? <PulseDots style={lead} /> : null}
                    {stt.connectionState === "reconnecting" || stt.connectionState === "connecting" ? (
                      <Text style={[styles.connLabel, lead, { color: C.amber }]}>
                        {stt.connectionState === "reconnecting"
                          ? t("record.reconnecting", { n: String(stt.reconnectAttempt) })
                          : t("record.connecting")}
                      </Text>
                    ) : null}
                    {stt.connectionState === "error" ? (
                      <Text style={[styles.connLabel, lead, { color: C.red }]}>{t("record.offline")}</Text>
                    ) : null}
                  </View>
                  <LayoutToggle value={layout} onChange={setLayout} rtl={rtl} />
                </View>

                {/* OS interruption banner (web: instant; faded here). Tapping
                    recovers inside the gesture, like the web. */}
                {interrupted && !paused ? (
                  <Animated.View entering={TW_ENTER.fade} exiting={TW_EXIT.fade}>
                    <Pressable
                      onPress={handleRecover}
                      accessibilityRole="button"
                      accessibilityHint={t("record.interruptedBody")}
                      style={styles.interruptBanner}
                    >
                      <Text style={[styles.bannerLabel, { color: C.amber }, rtl && styles.rtlText]}>
                        {t("record.interruptedTitle")}
                      </Text>
                      <Text style={[styles.bannerBody, rtl && styles.rtlText]}>{t("record.interruptedBody")}</Text>
                    </Pressable>
                  </Animated.View>
                ) : null}

                {/* Transcription error banner (web: instant; faded here) */}
                {stt.connectionState === "error" && stt.error ? (
                  <Animated.View
                    entering={TW_ENTER.fade}
                    exiting={TW_EXIT.fade}
                    style={styles.errorBanner}
                    accessibilityRole="alert"
                  >
                    <Text style={[styles.bannerLabel, { color: C.red }]}>{t("record.unavailableTitle")}</Text>
                    <Text style={styles.bannerBody}>{stt.error}</Text>
                  </Animated.View>
                ) : null}

                {/* Compact visualizer strip — frozen while paused. */}
                <View style={styles.vizStrip}>
                  <AudioVisualizer subscribe={recorder.subscribeMeter} active={active && !paused} compact barCount={20} />
                </View>

                {/* Speaker filter — only once multiple speakers are detected. */}
                {speakerCount > 1 ? (
                  <Animated.View entering={TW_ENTER.fade} exiting={TW_EXIT.fade} style={[styles.speakerBar, row]}>
                    <Text style={styles.speakerCount}>{t("record.speakersDetected", { n: String(speakerCount) })}</Text>
                    <SpeakerChip on={mainSpeakerOnly} onPress={toggleMainSpeaker} />
                  </Animated.View>
                ) : null}

                {/* Transcript (the hero) */}
                <View style={styles.transcript}>
                  {(() => {
                    const props = {
                      rows,
                      sourceLanguage: source,
                      targetLanguage: target,
                      interimText: paused ? "" : stt.interimText,
                      follow: true,
                      onRetry: translator.retry,
                      // Web recording-shell passes mainSpeakerOnly to the view
                      // (render-time filter); dominance is computed over ALL
                      // engine segments, not just the visible rows.
                      mainSpeakerOnly,
                      speakerSegments: stt.segments,
                      // No `empty` override: Transcript's DefaultEmpty is the web's
                      // live-transcript empty state ("Listening…" + hint) in every
                      // connection state; "Connecting…" lives in the header only
                      // (web recording-shell), mirrored by the language bar here.
                    };
                    return layout === "split" ? <SplitTranscript {...props} /> : <Transcript {...props} />;
                  })()}
                </View>

                {/* Controls */}
                <SafeAreaView edges={{ bottom: "maximum" }} style={[styles.controls, row]}>
                  {/* ONE persistent control (web: unkeyed ternary <button>) —
                      flipping `variant` crossfades amber ⇄ accent over 150ms
                      while the press squash releases; only the glyph swaps. */}
                  <RecCtl
                    variant={paused ? "resume" : "pause"}
                    onPress={paused ? handleResume : handlePause}
                    disabled={finishing}
                    accessibilityLabel={t(paused ? "record.resumeRecording" : "record.pauseRecording")}
                  />
                  <RecCtl
                    variant="stop"
                    onPress={handleStop}
                    disabled={finishing}
                    accessibilityLabel={t("record.stopRecording")}
                  >
                    {finishing ? <Spinner size={20} color={C.red} track="rgba(239,68,68,0.2)" /> : undefined}
                  </RecCtl>
                </SafeAreaView>
              </Animated.View>
            )}
          </View>
        </LayoutAnimationConfig>
      </SafeAreaView>
    </RecordScreenEnter>
  );
}

/**
 * Local copy of <ScreenEnter> (template.tsx route enter: opacity 0 → 1,
 * translateY 8 → 0, 200ms CSS ease, replayed on every tab focus, none under
 * Reduce Motion) with one addition the shared primitive lacks: `skipRef`
 * suppresses exactly one replay — the return from the completed-session push,
 * which on the web is an in-page view swap, not a route change.
 */
function RecordScreenEnter({
  children,
  skipRef,
}: {
  children: ReactNode;
  skipRef: { current: boolean };
}) {
  const reduce = useReduceMotion();
  const p = useSharedValue(reduce ? 1 : 0);
  useFocusEffect(
    useCallback(() => {
      if (reduce || skipRef.current) {
        skipRef.current = false;
        p.value = 1;
        return;
      }
      p.value = 0;
      p.value = withTiming(1, { duration: 200, easing: EASE.css, reduceMotion: ReduceMotion.Never });
    }, [reduce, p, skipRef]),
  );
  const animated = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: 8 * (1 - p.value) }],
  }));
  return <Animated.View style={[{ flex: 1 }, animated]}>{children}</Animated.View>;
}

// ─── Live-shell parts ────────────────────────────────────────────────────────

/** Three 4px dots; the lit one steps every 600ms (web setInterval 600). */
function PulseDots({ style }: { style?: StyleProp<ViewStyle> }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % 3), 600);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={[styles.dots, style]}>
      {[0, 1, 2].map((i) => (
        <PulseDot key={i} lit={phase === i} />
      ))}
    </View>
  );
}

function PulseDot({ lit }: { lit: boolean }) {
  const v = useSharedValue(lit ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(lit ? 1 : 0, TW_150);
  }, [lit, v]);
  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(v.value, [0, 1], [`${C.accent}30`, C.accent]),
  }));
  return <Animated.View style={[styles.pulseDot, style]} />;
}

/** Stacked ⇄ split segmented control (web: 28×24 buttons, SVG glyphs). */
function LayoutToggle({
  value,
  onChange,
  rtl,
}: {
  value: TranscriptLayout;
  onChange: (l: TranscriptLayout) => void;
  rtl: boolean;
}) {
  const { t } = useLocale();
  return (
    <View style={[styles.toggle, rtl ? { left: 12 } : { right: 12 }]}>
      {(["paired", "split"] as const).map((mode) => (
        <LayoutToggleButton
          key={mode}
          mode={mode}
          on={value === mode}
          label={mode === "paired" ? t("record.stackedView") : t("record.splitView")}
          onPress={() => onChange(mode)}
        />
      ))}
    </View>
  );
}

function LayoutToggleButton({
  mode,
  on,
  label,
  onPress,
}: {
  mode: TranscriptLayout;
  on: boolean;
  label: string;
  onPress: () => void;
}) {
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(on ? 1 : 0, TW_150);
  }, [on, v]);
  const bg = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(v.value, [0, 1], ["rgba(46,204,113,0)", C.accentSoft]),
  }));
  const stroke = on ? C.accent : C.t3;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} hitSlop={4}>
      <Animated.View style={[styles.toggleBtn, bg]}>
        <Svg width={13} height={13} viewBox="0 0 16 16" fill="none">
          {mode === "paired" ? (
            <>
              <Rect x={2.5} y={3} width={11} height={3.5} rx={1} stroke={stroke} strokeWidth={1.6} />
              <Rect x={2.5} y={9.5} width={11} height={3.5} rx={1} stroke={stroke} strokeWidth={1.6} />
            </>
          ) : (
            <>
              <Rect x={2.5} y={3} width={4.5} height={10} rx={1} stroke={stroke} strokeWidth={1.6} />
              <Rect x={9} y={3} width={4.5} height={10} rx={1} stroke={stroke} strokeWidth={1.6} />
            </>
          )}
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

/** "Main speaker only" chip — transition-colors 150ms. */
function SpeakerChip({ on, onPress }: { on: boolean; onPress: () => void }) {
  const { t } = useLocale();
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(on ? 1 : 0, TW_150);
  }, [on, v]);
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(v.value, [0, 1], [C.surfaceLight, C.accent]),
    // Border stays 1px and fades to transparent (avoids web's 2px jump).
    borderColor: interpolateColor(v.value, [0, 1], [C.borderLight, "rgba(46,204,113,0)"]),
  }));
  const text = useAnimatedStyle(() => ({
    color: interpolateColor(v.value, [0, 1], [C.t2, "#0A0F1C"]),
  }));
  return (
    <Pressable onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <Animated.View style={[styles.chip, box]}>
        <Animated.Text style={[styles.chipText, text]}>
          {on ? t("record.mainSpeakerOnlyOn") : t("record.mainSpeakerOnly")}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── Account menu (web components/auth/account-menu.tsx) ────────────────────

const MENU_T = { duration: 200, easing: EASE.css, reduceMotion: ReduceMotion.Never };

/**
 * 36×36 avatar tile, lit (border accent@40 → accent + `0 0 0 1px accent,
 * 0 0 16px accent@45`, 200ms ease) while pressed or open; active:scale-95
 * (150ms ease); animate-pulse while `me` loads. The menu grows out of the
 * avatar corner: fade + slide-from-top-1 (AnchoredPopover) + zoom .95 → 1 with
 * origin top-right, 200ms CSS ease — and back out the same way on close.
 *
 * Reduce Motion: the web's tw-animate classes are NOT reduced-motion gated, so
 * the full zoom + 4px slide plays there. AnchoredPopover drops its slide under
 * reduce (house policy for dropdowns), so this card re-adds the same -4 → 0
 * slide itself in that case — same 200ms CSS ease, in step with the fade.
 *
 * RTL UI: the header row reverses, putting the avatar at the far left, so the
 * menu anchors to the avatar's LEFT edge (bottom-start) and grows from its
 * top-left corner — otherwise the 224px panel would open off-screen.
 */
function AccountMenu() {
  const { t, dir } = useLocale();
  const rtl = dir === "rtl";
  const router = useRouter();
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const reduce = useReduceMotion();
  const [open, setOpen] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const trigger = useRef<View>(null);
  const loading = me === undefined;
  const pulse = usePulse(loading);
  const showImage = Boolean(me?.image) && !imageBroken;
  const initial = (me?.name?.[0] ?? me?.email?.[0] ?? "?").toUpperCase();

  // 0 = closed pose (scale .95, y -4), 1 = open. Not reduce-gated (web isn't).
  const p = useSharedValue(0);
  useEffect(() => {
    if (open) {
      p.value = 0;
      p.value = withTiming(1, MENU_T);
    } else {
      p.value = withTiming(0, MENU_T);
    }
  }, [open, p]);
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      // AnchoredPopover supplies the slide unless Reduce Motion is on.
      { translateY: reduce ? -4 * (1 - p.value) : 0 },
      { scale: 0.95 + 0.05 * p.value },
    ],
  }));

  return (
    <>
      {/* Web: `animate-pulse` sits on the WHOLE 36px button while `me` loads, so
          the accentSoft disc + accent@40 border pulse together (1 → .5 → 1,
          2s). The pulse therefore wraps the tile, not the (empty) inner view. */}
      <Animated.View style={pulse}>
      <PressableScale
        ref={trigger}
        onPress={() => setOpen((o) => !o)}
        scaleTo={0.95}
        easing={EASE.css}
        glow={{
          borderFrom: `${C.accent}40`,
          borderTo: C.accent,
          // Web ring = 1px accent border + 1px shadow OUTSIDE it (2px). The
          // glow layer starts inside the border, so 2px spread + 1px halo
          // spread puts both on the web's border-box edge.
          shadow: "0 0 0 2px #2ECC71, 0 0 16px 1px rgba(46,204,113,0.45)",
          duration: 200,
        }}
        glowActive={open}
        accessibilityRole="button"
        accessibilityLabel={t("record.accountMenu")}
        accessibilityState={{ busy: loading, expanded: open }}
        style={[styles.avatar, { backgroundColor: showImage ? "transparent" : C.accentSoft }]}
      >
        <View style={styles.avatarInner}>
          {showImage ? (
            <Image source={{ uri: me!.image! }} style={styles.avatarImg} onError={() => setImageBroken(true)} />
          ) : loading ? null : (
            <Text style={styles.avatarText}>{initial}</Text>
          )}
        </View>
      </PressableScale>
      </Animated.View>

      <AnchoredPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={trigger}
        placement={rtl ? "bottom-start" : "bottom-end"}
        gap={4}
        width={224}
        style={styles.menuPanel}
      >
        <Animated.View style={[styles.menuCard, rtl && { transformOrigin: "top left" }, zoomStyle]}>
          <View style={styles.menuClip}>
            <View style={styles.menuHead}>
              {me?.name ? (
                <Text style={styles.menuName} numberOfLines={1}>
                  {me.name}
                </Text>
              ) : null}
              <Text style={styles.menuEmail} numberOfLines={1}>
                {me?.email ?? (loading ? t("history.loading") : t("record.signedIn"))}
              </Text>
            </View>
            <PressableScale
              scaleTo={1}
              pressColors={{ backgroundColor: ["rgba(0,0,0,0)", "rgba(0,0,0,0.2)"] }}
              onPress={() => {
                setOpen(false);
                router.navigate("/settings");
              }}
              accessibilityRole="button"
              style={[styles.menuItem, { justifyContent: "space-between" }]}
            >
              <View style={styles.menuItemLeft}>
                <SymbolView name="gearshape" tintColor={C.t3} size={14} />
                <Text style={styles.menuItemText}>{t("settings.title")}</Text>
              </View>
              <SymbolView name="chevron.right" tintColor={C.t4} size={12} weight="semibold" />
            </PressableScale>
            <View style={styles.menuDivider} />
            <PressableScale
              scaleTo={1}
              pressColors={{ backgroundColor: ["rgba(0,0,0,0)", "rgba(0,0,0,0.2)"] }}
              onPress={() => {
                setOpen(false);
                void signOut();
              }}
              accessibilityRole="button"
              style={styles.menuItem}
            >
              <View style={styles.menuItemLeft}>
                <SymbolView name="xmark" tintColor={C.t3} size={13} />
                <Text style={styles.menuItemText}>{t("record.signOut")}</Text>
              </View>
            </PressableScale>
          </View>
        </Animated.View>
      </AnchoredPopover>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  stage: { flex: 1 },
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },

  // App header (idle / error)
  appHeader: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  brand: { alignItems: "center", gap: 8 },
  brandText: { color: C.w, fontSize: 16, fontWeight: "700" },
  headerActions: { alignItems: "center", gap: 8 },

  // Idle
  idle: { flexGrow: 1, padding: 20, gap: 16, paddingBottom: 110 },
  // Web `lg:max-w-2xl lg:w-full lg:mx-auto lg:px-8 lg:pt-12` + outer `lg:pb-0`
  // (the rail replaces the floating bottom nav, so only p-5's 20px remains).
  idleWide: { width: "100%", maxWidth: 672, alignSelf: "center", paddingHorizontal: 32, paddingTop: 48, paddingBottom: 20 },
  recordArea: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 28, minHeight: 220 },
  recordHint: { color: C.t3, fontSize: 14 },
  usage: { color: C.t3, fontSize: 12, textAlign: "center" },

  // Live shell
  statusHeader: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  statusLeft: { alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 13, fontWeight: "700" },
  timer: { color: C.w, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  langBar: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  langBarCenter: { alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 56 },
  langSrc: { color: C.t3, fontSize: 12, fontWeight: "600" },
  langArrow: { color: C.t4, fontSize: 12 },
  langTgt: { color: C.accent, fontSize: 12, fontWeight: "600" },
  dots: { flexDirection: "row", gap: 3 },
  pulseDot: { width: 4, height: 4, borderRadius: 2 },
  connLabel: { fontSize: 11, fontWeight: "600" },
  toggle: {
    position: "absolute",
    top: "50%",
    marginTop: -13,
    flexDirection: "row",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  toggleBtn: { width: 28, height: 24, alignItems: "center", justifyContent: "center" },
  interruptBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: C.amberSoft,
    borderWidth: 1,
    borderColor: `${C.amber}55`,
  },
  rtlText: { writingDirection: "rtl", textAlign: "right" },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: C.redSoft,
    borderWidth: 1,
    borderColor: `${C.red}40`,
  },
  bannerLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.88, textTransform: "uppercase", marginBottom: 4 },
  bannerBody: { color: C.t2, fontSize: 12 },
  vizStrip: { paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  speakerBar: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  speakerCount: { color: C.t3, fontSize: 11 },
  chip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  chipText: { fontSize: 11, fontWeight: "600" },
  transcript: { flex: 1 },
  controls: {
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    // The floating bottom nav slides away while live (useRecordNavHidden()),
    // so this is web pb-8-ish breathing room; the SafeAreaView "maximum" bottom
    // edge lifts it above the home indicator. The nav is absolutely positioned,
    // so its hide/show never shifts this padding.
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },

  // Account menu
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${C.accent}40`,
  },
  avatarInner: { flex: 1, borderRadius: 11, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  avatarImg: { width: "100%", height: "100%" },
  avatarText: { color: C.accent, fontSize: 12, fontWeight: "700" },
  menuPanel: { backgroundColor: "transparent", borderWidth: 0, boxShadow: [] },
  menuCard: {
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderLight,
    boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
    transformOrigin: "top right",
  },
  menuClip: { borderRadius: 11, overflow: "hidden" },
  menuHead: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  menuName: { color: C.w, fontSize: 13, fontWeight: "600" },
  menuEmail: { color: C.t3, fontSize: 12 },
  menuItem: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  menuItemLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  menuItemText: { color: C.t2, fontSize: 13, fontWeight: "600" },
  menuDivider: { height: 1, backgroundColor: C.border },
});

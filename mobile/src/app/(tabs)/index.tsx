import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { api } from "@convex/api";
import type { Id } from "@convex/dataModel";
import { SEGMENT_FLUSH_INTERVAL_MS } from "@shared/constants";
import { stopTailSegment, takeFlushableSegments } from "@shared/recording-persistence";
import { LanguagePicker } from "~/components/language-picker";
import { LevelMeter } from "~/components/level-meter";
import { SessionRow } from "~/components/session-row";
import { Transcript, type TranscriptRow } from "~/components/transcript";
import { useLiveStt } from "~/hooks/use-live-stt";
import { useLiveTranslator } from "~/hooks/use-live-translator";
import { useNativeRecorder } from "~/hooks/use-native-recorder";
import { makeId } from "~/lib/ids";
import { formatDuration, langName } from "~/lib/lang";
import { C, RADIUS } from "~/lib/theme";

const DEFAULT_SOURCE = "ar";
const DEFAULT_TARGET = "en";

export default function RecordScreen() {
  const router = useRouter();
  const prefs = useQuery(api.preferences.get);
  const recent = useQuery(api.sessions.getRecentSessions, { limit: 3 });
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
  const mainSpeakerOnly = prefs?.mainSpeakerOnly ?? true;

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
    const id = setInterval(() => setElapsed(elapsedNow()), 500);
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

  const handleRecord = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    stt.reset();
    translator.reset();
    flushedRef.current = new Set();
    patchedMergesRef.current = new Set();
    timerRef.current = { accumulated: 0, since: null };
    setElapsed(0);
    const ok = await recorder.start();
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
      Alert.alert("Not saving", "Couldn't create a session — this recording won't be saved.");
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
      router.push({ pathname: "/session/[id]", params: { id: sessionId } });
    }
    setStopping(false);
    setElapsed(0);
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
          };
        }),
    [stt.segments, translator],
  );

  if (!active && !stopping) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.idle}>
          <Text style={styles.heading}>Tarjuman</Text>
          <LanguagePicker
            source={source}
            target={target}
            onChange={setPicked}
            disabled={recorder.phase === "starting"}
          />

          <View style={styles.center}>
            <Pressable
              onPress={handleRecord}
              disabled={recorder.phase === "starting"}
              accessibilityRole="button"
              accessibilityLabel="Start recording"
              style={({ pressed }) => [styles.recordBtn, pressed && { transform: [{ scale: 0.96 }] }]}
            >
              <SymbolView name="mic.fill" tintColor={C.bg} size={40} />
            </Pressable>
            <Text style={styles.recordHint}>
              {recorder.phase === "starting" ? "Starting…" : "Tap to start transcribing"}
            </Text>
            {recorder.error && <Text style={styles.errorText}>{recorder.error}</Text>}
          </View>

          <View style={styles.tips}>
            <Text style={styles.tipsTitle}>For best results</Text>
            <Text style={styles.tip}>• Hold the phone near the speaker, mic pointed at it</Text>
            <Text style={styles.tip}>• Don't cover the mic at the bottom of the phone</Text>
            <Text style={styles.tip}>• You can lock the screen — recording continues</Text>
          </View>

          {recent && recent.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={styles.sectionLabel}>Recent sessions</Text>
              {recent.map((s) => (
                <SessionRow key={s._id} s={s} />
              ))}
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const paused = recorder.phase === "paused";
  const reconnecting = stt.connectionState === "reconnecting" || stt.connectionState === "connecting";
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.liveHeader}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: paused ? C.amber : C.red }]} />
          <Text style={[styles.status, { color: paused ? C.amber : C.w }]}>
            {paused ? "Paused" : reconnecting ? "Connecting…" : "Recording"}
          </Text>
          <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
        </View>
        <Text style={styles.pair}>
          {langName(source)} → {langName(target)}
        </Text>
        <LevelMeter level={recorder.level} active={!paused && stt.connectionState === "connected"} />
        {(stt.error || recorder.error) && (
          <Text style={styles.errorText}>{stt.error ?? recorder.error}</Text>
        )}
      </View>

      <View style={{ flex: 1 }}>
        <Transcript
          rows={rows}
          sourceLanguage={source}
          targetLanguage={target}
          interimText={stt.interimText}
          follow
          onRetry={translator.retry}
          empty={
            <Text style={styles.listening}>
              {stt.connectionState === "connected" ? "Listening…" : "Connecting to the transcriber…"}
            </Text>
          }
        />
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={paused ? handleResume : handlePause}
          disabled={stopping}
          style={({ pressed }) => [styles.ctrl, styles.ctrlSecondary, pressed && { opacity: 0.8 }]}
        >
          <SymbolView name={paused ? "play.fill" : "pause.fill"} tintColor={C.w} size={20} />
          <Text style={styles.ctrlText}>{paused ? "Resume" : "Pause"}</Text>
        </Pressable>
        <Pressable
          onPress={handleStop}
          disabled={stopping}
          style={({ pressed }) => [styles.ctrl, styles.ctrlStop, pressed && { opacity: 0.8 }]}
        >
          <SymbolView name="stop.fill" tintColor={C.w} size={20} />
          <Text style={styles.ctrlText}>{stopping ? "Saving…" : "Stop"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  idle: { flex: 1, paddingHorizontal: 20, paddingTop: 8, gap: 20 },
  heading: { color: C.w, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  center: { alignItems: "center", gap: 14, paddingVertical: 12 },
  recordBtn: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.accent,
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  recordHint: { color: C.t2, fontSize: 15 },
  tips: {
    backgroundColor: C.surface,
    borderRadius: RADIUS.md,
    padding: 14,
    gap: 4,
    borderColor: C.border,
    borderWidth: 1,
  },
  tipsTitle: { color: C.w, fontSize: 14, fontWeight: "700", marginBottom: 2 },
  tip: { color: C.t2, fontSize: 14, lineHeight: 20 },
  sectionLabel: { color: C.t3, fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 },
  errorText: { color: C.red, fontSize: 14, textAlign: "center", paddingHorizontal: 16 },
  liveHeader: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 6,
    borderBottomColor: C.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  status: { fontSize: 17, fontWeight: "700", flex: 1 },
  timer: { color: C.w, fontSize: 17, fontWeight: "600", fontVariant: ["tabular-nums"] },
  pair: { color: C.t2, fontSize: 14 },
  listening: { color: C.t3, fontSize: 16, textAlign: "center", marginTop: 40 },
  controls: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 96, // clear the floating native tab bar
  },
  ctrl: {
    flex: 1,
    height: 58,
    borderRadius: RADIUS.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ctrlSecondary: { backgroundColor: C.surfaceLight },
  ctrlStop: { backgroundColor: C.red },
  ctrlText: { color: C.w, fontSize: 17, fontWeight: "700" },
});

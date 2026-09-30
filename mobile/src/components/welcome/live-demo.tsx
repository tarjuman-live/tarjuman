/**
 * LiveDemo — port of src/components/landing/live-demo.tsx: a looping preview of
 * the recording screen framed as an iPhone 17 Pro Max. Each cycle picks a
 * RANDOM phrase + source + different target (never the previous combo), types
 * the source word by word, then fades the translation in, holds, and restarts.
 *
 * Timing (all lifted from the web):
 *   - word w revealed at 150·w ms; each word fades opacity 0→1 over 280ms CSS
 *     ease (all words stay in the layout → no reflow).
 *   - translation at 150·count + 350 ms: fade-in + 4px rise, 500ms CSS ease.
 *   - next cycle at that + 2400 ms. The card and the language pair are keyed by
 *     the combo, so each cycle HARD-CUTS (no exit) and the entrances replay;
 *     the pair fades in over 300ms CSS ease.
 *   - elapsed mm:ss ticks every 1000ms (no tween), reset each cycle.
 *   - recording dot + typing caret: animate-pulse (2s, 1 → .5 → 1).
 *   - equalizer: 5 bars scaleY .3 → 1 → .3, 900ms ease-in-out, +120ms each,
 *     origin bottom.
 * Reduce Motion (web: matchMedia one-shot): static frame — all words, the
 * translation, 00:06, bars frozen at scaleY .5, no loop / timer. The pulse is
 * not gated (web animate-pulse isn't either).
 * Native extra: the loop pauses while the screen is unfocused or the app is
 * backgrounded (the browser throttles hidden-tab timers the same way) and
 * starts a fresh cycle on return.
 */
import { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useIsFocused } from "expo-router";
import { C } from "~/lib/theme";
import { EASE, twEnter, twExit, useReduceMotion } from "~/lib/motion";
import { usePulse } from "~/components/motion/pulse";
import { useT } from "~/i18n";

type LangCode = "ar" | "en" | "fr" | "es" | "de" | "tr" | "id" | "ur";

const LANGS: { code: LangCode; label: string; rtl: boolean }[] = [
  { code: "ar", label: "Arabic", rtl: true },
  { code: "en", label: "English", rtl: false },
  { code: "fr", label: "French", rtl: false },
  { code: "es", label: "Spanish", rtl: false },
  { code: "de", label: "German", rtl: false },
  { code: "tr", label: "Turkish", rtl: false },
  { code: "id", label: "Indonesian", rtl: false },
  { code: "ur", label: "Urdu", rtl: true },
];
const LANG_BY_CODE = Object.fromEntries(LANGS.map((l) => [l.code, l])) as Record<
  LangCode,
  (typeof LANGS)[number]
>;

// Hand-translated, identical to the web demo ("Allah" preserved on purpose).
const PHRASES: Record<LangCode, string>[] = [
  {
    ar: "الحمد لله رب العالمين",
    en: "All praise is due to Allah, Lord of the worlds.",
    fr: "Toutes les louanges reviennent à Allah, Seigneur des mondes.",
    es: "Todas las alabanzas pertenecen a Allah, Señor de los mundos.",
    de: "Alles Lob gebührt Allah, dem Herrn der Welten.",
    tr: "Hamd, âlemlerin Rabbi olan Allah'a mahsustur.",
    id: "Segala puji bagi Allah, Tuhan semesta alam.",
    ur: "تمام تعریفیں اللہ کے لیے ہیں جو سارے جہانوں کا رب ہے",
  },
  {
    ar: "بسم الله الرحمن الرحيم",
    en: "In the name of Allah, the Most Gracious, the Most Merciful.",
    fr: "Au nom d'Allah, le Tout Miséricordieux, le Très Miséricordieux.",
    es: "En el nombre de Allah, el Compasivo, el Misericordioso.",
    de: "Im Namen Allahs, des Allerbarmers, des Barmherzigen.",
    tr: "Rahman ve Rahim olan Allah'ın adıyla.",
    id: "Dengan nama Allah, Yang Maha Pengasih, Maha Penyayang.",
    ur: "اللہ کے نام سے جو نہایت مہربان رحم والا ہے",
  },
  {
    ar: "اطلبوا العلم من المهد إلى اللحد",
    en: "Seek knowledge from the cradle to the grave.",
    fr: "Cherchez la connaissance du berceau jusqu'à la tombe.",
    es: "Buscad el conocimiento desde la cuna hasta la tumba.",
    de: "Suche Wissen von der Wiege bis zum Grabe.",
    tr: "Beşikten mezara kadar ilim öğrenin.",
    id: "Tuntutlah ilmu dari buaian hingga liang lahat.",
    ur: "علم حاصل کرو گہوارے سے قبر تک",
  },
];

const MS_PER_WORD = 150;
const TRANSLATION_DELAY_MS = 350;
const HOLD_MS = 2400;

/** `animate-in fade-in duration-300` (CSS ease). */
const PAIR_ENTER = twEnter({ opacity: 0, duration: 300 });
/**
 * `animate-in fade-in slide-in-from-bottom-1 duration-500` (4px, CSS ease).
 * tw-animate-css has no reduced-motion gate, so the rise plays under reduce too.
 */
const TRANSLATION_ENTER = twEnter({ opacity: 0, translateY: 4, duration: 500, reduce: "never" });
/** Web unmounts the caret instantly; house fluid rule → a 150ms fade out. */
const CARET_EXIT = twExit({ opacity: 0 });

const SIDE_BUTTONS: { side: "left" | "right"; top: number; h: number }[] = [
  { side: "left", top: 112, h: 26 },
  { side: "left", top: 152, h: 46 },
  { side: "left", top: 208, h: 46 },
  { side: "right", top: 150, h: 34 },
  { side: "right", top: 198, h: 64 },
];

/** App foreground state (the browser analogue: hidden tabs throttle timers). */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

export function LiveDemo() {
  const t = useT();
  const reduce = useReduceMotion();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const running = !reduce && focused && appActive;

  // Deterministic first frame (web: ar → en, phrase 0), random picks after.
  const [phrase, setPhrase] = useState(0);
  const [src, setSrc] = useState<LangCode>("ar");
  const [tgt, setTgt] = useState<LangCode>("en");
  const [words, setWords] = useState(() => (reduce ? 999 : 0));
  const [tgtShown, setTgtShown] = useState(reduce);
  const [elapsed, setElapsed] = useState(() => (reduce ? 6 : 0));
  const lastKey = useRef("");

  useEffect(() => {
    if (reduce) {
      // One-shot reduced-motion static frame (web parity).
      setWords(999);
      setTgtShown(true);
      setElapsed(6);
      return;
    }
    if (!running) return; // paused — keep the current frame

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => {
      const id = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
      timers.push(id);
    };

    const pick = () => {
      for (let tries = 0; tries < 12; tries++) {
        const p = Math.floor(Math.random() * PHRASES.length);
        const si = Math.floor(Math.random() * LANGS.length);
        let ti = Math.floor(Math.random() * LANGS.length);
        if (ti === si) ti = (ti + 1) % LANGS.length;
        const key = `${p}:${si}:${ti}`;
        if (key !== lastKey.current) {
          lastKey.current = key;
          return { p, s: LANGS[si].code, t: LANGS[ti].code };
        }
      }
      return { p: 0, s: "ar" as LangCode, t: "en" as LangCode };
    };

    const play = () => {
      const { p, s, t: tg } = pick();
      const count = PHRASES[p][s].split(" ").length;
      setPhrase(p);
      setSrc(s);
      setTgt(tg);
      setWords(0);
      setTgtShown(false);
      setElapsed(0);
      for (let w = 1; w <= count; w++) after(MS_PER_WORD * w, () => setWords(w));
      const doneWords = MS_PER_WORD * count + TRANSLATION_DELAY_MS;
      after(doneWords, () => setTgtShown(true));
      after(doneWords + HOLD_MS, play);
    };

    play();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduce, running]);

  // Elapsed timer (skipped under reduced motion / while paused).
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const dotPulse = usePulse();

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const srcLang = LANG_BY_CODE[src];
  const tgtLang = LANG_BY_CODE[tgt];
  const srcWords = PHRASES[phrase][src].split(" ");
  const tgtText = PHRASES[phrase][tgt];
  const pairKey = `${phrase}:${src}:${tgt}`;

  return (
    <View style={styles.root}>
      {/* soft glow behind the phone: radial-gradient(60% 50% at 50% 30%,
          accent@18%, transparent 70%), opacity .6 */}
      <View pointerEvents="none" style={styles.glow}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="demoGlow" cx="50%" cy="30%" rx="60%" ry="50%" fx="50%" fy="30%">
              <Stop offset="0" stopColor={C.accent} stopOpacity={0.18} />
              <Stop offset="0.7" stopColor={C.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#demoGlow)" />
        </Svg>
      </View>

      <View
        style={styles.phone}
        accessible
        accessibilityRole="image"
        accessibilityLabel={t("welcome-sections.demoA11y")}
      >
        {/* titanium side buttons */}
        {SIDE_BUTTONS.map((b, i) => (
          <LinearGradient
            key={i}
            colors={["#5b6478", "#2a3140"]}
            style={[
              styles.sideButton,
              { top: b.top, height: b.h },
              b.side === "left"
                ? { left: -2, borderTopLeftRadius: 2, borderBottomLeftRadius: 2 }
                : { right: -2, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
            ]}
          />
        ))}

        {/* titanium rim + black bezel */}
        <View style={styles.rim}>
          <View style={styles.screen}>
            {/* Dynamic Island */}
            <View style={styles.island}>
              <View style={styles.islandCam} />
            </View>

            {/* Recording header */}
            <View style={styles.header}>
              <View style={styles.rowBetween}>
                <View style={styles.row8}>
                  <Animated.View style={[styles.recDot, dotPulse]} />
                  <Text style={styles.recLabel}>{t("record.recording")}</Text>
                </View>
                <Text style={styles.elapsed}>
                  {mm}:{ss}
                </Text>
              </View>
              <View style={[styles.rowBetween, { marginTop: 8 }]}>
                {/* the language pair fades when it changes (no exit) */}
                <Animated.View key={pairKey} entering={PAIR_ENTER} style={styles.pair}>
                  <Text style={styles.pairText}>{srcLang.label}</Text>
                  <Text style={[styles.pairText, { color: C.t4 }]}>→</Text>
                  <Text style={[styles.pairText, { color: C.accent }]}>{tgtLang.label}</Text>
                </Animated.View>
                <EqBars reduce={reduce} />
              </View>
            </View>

            {/* Transcript — one card per pair, keyed so it resets cleanly */}
            <View key={pairKey} style={styles.transcript}>
              <View style={styles.card}>
                {/* source — types word by word */}
                <View style={[styles.words, { flexDirection: srcLang.rtl ? "row-reverse" : "row" }]}>
                  {srcWords.map((word, wi) => (
                    <DemoWord key={wi} word={word} shown={wi < words} rtl={srcLang.rtl} />
                  ))}
                  {words < srcWords.length && <Caret rtl={srcLang.rtl} />}
                </View>

                {/* translation — fades in once the source is read */}
                {tgtShown && (
                  <Animated.View entering={TRANSLATION_ENTER} style={styles.translation}>
                    <Text
                      style={[
                        styles.translationText,
                        tgtLang.rtl
                          ? { writingDirection: "rtl", textAlign: "right" }
                          : { writingDirection: "ltr", textAlign: "left" },
                      ]}
                    >
                      {tgtText}
                    </Text>
                  </Animated.View>
                )}
              </View>
            </View>

            {/* Controls (decorative) */}
            <View style={styles.controls}>
              <View style={[styles.ctl, { backgroundColor: C.amberSoft }]}>
                <View style={styles.pauseBars}>
                  <View style={styles.pauseBar} />
                  <View style={styles.pauseBar} />
                </View>
              </View>
              <View style={[styles.ctl, { backgroundColor: C.redSoft }]}>
                <View style={styles.stopSquare} />
              </View>
            </View>
          </View>
        </View>
      </View>

      <Text style={styles.caption}>{t("welcome-sections.demoCaption")}</Text>
    </View>
  );
}

/** One source word: `transition: opacity 280ms ease`, always in the layout. */
function DemoWord({ word, shown, rtl }: { word: string; shown: boolean; rtl: boolean }) {
  const o = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    o.value = withTiming(shown ? 1 : 0, { duration: 280, easing: EASE.css, reduceMotion: ReduceMotion.Never });
  }, [shown, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.Text style={[styles.word, { writingDirection: rtl ? "rtl" : "ltr" }, style]}>{word}</Animated.Text>
  );
}

/** 2px × 1em accent caret after the phrase, animate-pulse while typing. */
function Caret({ rtl }: { rtl: boolean }) {
  const pulse = usePulse();
  return (
    <Animated.View
      exiting={CARET_EXIT}
      // ms-0.5 → 2px from the last word (the row's 4px word gap minus 2).
      style={[styles.caret, rtl ? { marginRight: -2 } : { marginLeft: -2 }, pulse]}
    />
  );
}

/** Decorative equalizer: `demo-eq` 900ms ease-in-out infinite, +120ms per bar. */
function EqBars({ reduce }: { reduce: boolean }) {
  return (
    <View style={styles.eq}>
      {[0, 1, 2, 3, 4].map((i) => (
        <EqBar key={i} index={i} reduce={reduce} />
      ))}
    </View>
  );
}

function EqBar({ index, reduce }: { index: number; reduce: boolean }) {
  const s = useSharedValue(reduce ? 0.5 : 0.3);
  useEffect(() => {
    if (reduce) {
      cancelAnimation(s);
      s.value = 0.5; // globals.css reduce: animation none + inline scaleY(.5)
      return;
    }
    // Start at the 0% keyframe (avoids the web's full-height flash during the
    // per-bar animation-delay with fill-mode none).
    s.value = 0.3;
    const half = { duration: 450, easing: EASE.cssInOut, reduceMotion: ReduceMotion.Never };
    s.value = withDelay(
      index * 120,
      withRepeat(withSequence(withTiming(1, half), withTiming(0.3, half)), -1, false, undefined, ReduceMotion.Never),
      ReduceMotion.Never
    );
    return () => cancelAnimation(s);
  }, [reduce, index, s]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: s.value }] }));
  return <Animated.View style={[styles.eqBar, style]} />;
}

const styles = StyleSheet.create({
  root: { position: "relative", alignItems: "center" },
  glow: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0.6 },
  phone: { position: "relative", width: 300 },
  sideButton: { position: "absolute", width: 3 },
  rim: {
    borderRadius: 48,
    padding: 10,
    backgroundColor: "#05070c",
    boxShadow:
      "0 0 0 2px #343d50, 0 0 0 3px #0c0f17, 0 30px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
  },
  screen: {
    position: "relative",
    borderRadius: 37.6,
    overflow: "hidden",
    flexDirection: "column",
    backgroundColor: C.bg,
    height: 600,
  },
  island: {
    position: "absolute",
    top: 10,
    left: "50%",
    marginLeft: -55,
    zIndex: 20,
    width: 110,
    height: 31,
    borderRadius: 999,
    backgroundColor: "#000",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingRight: 10,
  },
  islandCam: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: "#0a0f1a",
    boxShadow: "inset 0 0 0 1px rgba(90,110,140,0.5)",
  },
  header: {
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  row8: { flexDirection: "row", alignItems: "center", gap: 8 },
  recDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: C.red },
  recLabel: { fontSize: 12, fontWeight: "600", color: C.w },
  elapsed: { fontSize: 13, fontWeight: "700", color: C.w, fontVariant: ["tabular-nums"] },
  pair: { flexDirection: "row", alignItems: "center", gap: 6 },
  pairText: { fontSize: 11, fontWeight: "600", color: C.t2 },
  eq: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 16 },
  eqBar: {
    width: 3,
    height: 16,
    borderRadius: 999,
    backgroundColor: C.accent,
    transformOrigin: "bottom",
  },
  transcript: { flex: 1, overflow: "hidden", paddingHorizontal: 16, paddingVertical: 16 },
  card: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: C.surface,
    borderLeftWidth: 2,
    borderLeftColor: C.blue,
  },
  words: { flexWrap: "wrap", columnGap: 4 },
  word: { fontSize: 15, lineHeight: 24.4, color: C.w },
  caret: { width: 2, height: 15, alignSelf: "center", backgroundColor: C.accent },
  translation: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  translationText: { fontSize: 13, lineHeight: 21.1, color: C.t2 },
  controls: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  ctl: { width: 44, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  pauseBars: { flexDirection: "row", gap: 3 },
  pauseBar: { width: 4, height: 14, borderRadius: 2, backgroundColor: C.amber },
  stopSquare: { width: 14, height: 14, borderRadius: 3, backgroundColor: C.red },
  caption: { marginTop: 16, textAlign: "center", fontSize: 12, color: C.t4 },
});

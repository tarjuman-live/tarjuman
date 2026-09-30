/**
 * AskLecture — the "Ask the lecture" tab of src/components/session/pro-ai-tools.tsx
 * (grounded Q&A over the transcript, streamed from /api/ask).
 *
 * Motion (web → native):
 *   - The web attaches `useAutoAnimate({ duration: 220, easing:
 *     "cubic-bezier(0.22, 1, 0.36, 1)" })` to the Q&A list. For every
 *     appended pair that produces:
 *       · ADD on the new child: `el.animate([{scale .98, opacity 0},
 *         {scale .98, opacity 0, offset .5}, {scale 1, opacity 1}],
 *         { duration: 330 (220 × 1.5), easing: "ease-in" })` — the effect-level
 *         ease-in means the element stays invisible until the eased progress
 *         reaches .5. `askItemEntering` reproduces that exactly: it holds for
 *         the time ease-in needs to reach .5, then runs the remainder of the
 *         same ease-in curve remapped onto 0→1.
 *      · the parent's HEIGHT FLIPs old → new over 220ms SMOOTH, so the input
 *         row (and everything below the card) glides down instead of jumping.
 *         `GlideHeight` animates a real height, so the layout below follows
 *         the same way. Only appends glide — streamed answer growth is instant,
 *         exactly like the web (auto-animate only watches direct children).
 *     The hint above the list unmounts instantly on the first question and
 *     the list FLIPs translateY(+hint block) → 0 over the same 220ms SMOOTH
 *     (auto-animate `remain()` on the parent), so it doesn't jump.
 *     The list is append-only, so no exit ever plays. Under Reduce Motion
 *     auto-animate isn't attached → no entrance, no glide (instant).
 *   - Streaming: a static "…thinking" line until the first chunk, then the
 *     markdown answer replaces it and grows per chunk (no smoothing).
 *   - Ask submit: `transition-all duration-200 active:scale-[0.98]
 *     hover:brightness-110 disabled:opacity-50` → ProButton (solid).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type EntryAnimationsValues,
  type LayoutAnimation,
} from "react-native-reanimated";
import { useAuthToken } from "@convex-dev/auth/react";
import { C } from "~/lib/theme";
import { EASE, useReduceMotion } from "~/lib/motion";
import { isRtl } from "~/lib/lang";
import { rtlRow, rtlText, useLocale } from "~/i18n";
import { isAbort, ProButton, ProMarkdown, streamText } from "./study-notes";

// ─── auto-animate "add" (exact) ─────────────────────────────────────────────

/** auto-animate: add duration = config.duration × 1.5. */
const ADD_MS = 220 * 1.5;
/** CSS `ease-in`. */
const easeIn = Easing.bezierFn(0.42, 0, 1, 1);
/** Fraction of the time at which ease-in progress hits the .5 keyframe. */
const T_HALF = (() => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (easeIn(mid) < 0.5) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
})();
/** The second keyframe segment: (easeIn(t) − .5) × 2 over t ∈ [T_HALF, 1]. */
const secondHalf = (u: number) => {
  "worklet";
  return (easeIn(T_HALF + u * (1 - T_HALF)) - 0.5) * 2;
};

export function askItemEntering(_values: EntryAnimationsValues): LayoutAnimation {
  "worklet";
  const hold = T_HALF * ADD_MS;
  const cfg = { duration: ADD_MS - hold, easing: secondHalf, reduceMotion: ReduceMotion.Never };
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.98 }] },
    animations: {
      opacity: withDelay(hold, withTiming(1, cfg)),
      transform: [{ scale: withDelay(hold, withTiming(1, cfg)) }],
    },
  } as LayoutAnimation;
}

// ─── auto-animate parent height FLIP ────────────────────────────────────────

const GLIDE_MS = 220;

/**
 * Animates its own height to its content's natural height when `glideKey`
 * changes (a child was appended); any other content-size change (streamed
 * text) is applied instantly, like the web. A change that lands while a glide
 * is still running retargets within the remaining time.
 */
function GlideHeight({
  glideKey,
  enabled,
  style,
  children,
}: {
  glideKey: number;
  enabled: boolean;
  style?: object;
  children: ReactNode;
}) {
  const h = useSharedValue(0);
  const measured = useRef(false);
  const lastKey = useRef(glideKey);
  const glideUntil = useRef(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    const now = Date.now();
    const keyChanged = glideKey !== lastKey.current;
    lastKey.current = glideKey;
    if (!measured.current || !enabled) {
      measured.current = true;
      h.value = next;
      return;
    }
    if (keyChanged) {
      glideUntil.current = now + GLIDE_MS;
      h.value = withTiming(next, { duration: GLIDE_MS, easing: EASE.smooth, reduceMotion: ReduceMotion.Never });
    } else if (now < glideUntil.current) {
      h.value = withTiming(next, {
        duration: glideUntil.current - now,
        easing: EASE.smooth,
        reduceMotion: ReduceMotion.Never,
      });
    } else {
      h.value = next;
    }
  };

  const animated = useAnimatedStyle(() => ({ height: h.value }));

  return (
    <Animated.View style={[styles.glideOuter, style, animated]}>
      <View style={styles.glideInner} onLayout={onLayout}>
        {children}
      </View>
    </Animated.View>
  );
}

// ─── Ask the lecture ────────────────────────────────────────────────────────

type Msg = { q: string; a: string; error?: boolean };

export function AskLecture({ transcript, targetLang }: { transcript: string; targetLang: string }) {
  const { t, dir } = useLocale();
  const authToken = useAuthToken();
  const reduce = useReduceMotion();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  // Cancel the in-flight answer stream if the user leaves the tab (unmount).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Hint dismiss: the hint unmounts instantly (web `messages.length === 0 &&`),
  // and auto-animate's `remain()` on the list element itself FLIPs it from
  // its old top (below the hint) to the new one — translate(0, +hint) → 0
  // over 220ms SMOOTH — alongside the height glide. Only the list carries the
  // transform (auto-animate never touches its siblings), exactly like the web.
  const hintBlockH = useRef(0);
  const listShift = useSharedValue(0);
  const prevCount = useRef(messages.length);
  useLayoutEffect(() => {
    const was = prevCount.current;
    prevCount.current = messages.length;
    if (reduce || was !== 0 || messages.length === 0 || hintBlockH.current <= 0) return;
    listShift.value = withSequence(
      withTiming(hintBlockH.current, { duration: 0, reduceMotion: ReduceMotion.Never }),
      withTiming(0, { duration: GLIDE_MS, easing: EASE.smooth, reduceMotion: ReduceMotion.Never })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);
  const listShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: listShift.value }],
  }));

  const submit = async () => {
    const question = input.trim();
    if (!question || asking) return;
    setInput("");
    setAsking(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const idx = messages.length;
    setMessages((m) => [...m, { q: question, a: "" }]);
    try {
      await streamText(
        "/api/ask",
        { transcript, question, targetLanguage: targetLang },
        authToken,
        (text) => {
          if (controller.signal.aborted) return;
          setMessages((m) => {
            const next = [...m];
            if (next[idx]) next[idx] = { ...next[idx], a: text };
            return next;
          });
        },
        controller.signal
      );
    } catch (err) {
      // Aborted (unmount) — leave the partial answer, don't flag an error.
      if (isAbort(err, controller.signal)) return;
      setMessages((m) => {
        const next = [...m];
        if (next[idx])
          next[idx] = {
            ...next[idx],
            a: err instanceof Error ? err.message : String(err),
            error: true,
          };
        return next;
      });
    } finally {
      setAsking(false);
    }
  };

  const answerRtl = isRtl(targetLang);
  const bubbleAlign = dir === "rtl" ? "flex-end" : "flex-start";

  return (
    <View>
      {messages.length === 0 ? (
        <Text
          style={[styles.hint, rtlText(dir)]}
          onLayout={(e) => {
            // + mb-3 (12): the distance the list moves up when the hint goes.
            hintBlockH.current = e.nativeEvent.layout.height + 12;
          }}
        >
          {t("proTools.askHint")}
        </Text>
      ) : null}

      {/* flex flex-col gap-3 mb-3 (auto-animated) */}
      <Animated.View style={listShiftStyle}>
      <GlideHeight glideKey={messages.length} enabled={!reduce} style={styles.listOuter}>
        <View style={styles.list}>
          {messages.map((m, i) => (
            <Animated.View key={i} entering={reduce ? undefined : askItemEntering}>
              <View style={[styles.bubble, { alignSelf: bubbleAlign }]}>
                <Text style={[styles.bubbleText, rtlText(dir)]} selectable>
                  {m.q}
                </Text>
              </View>
              {m.a ? (
                m.error ? (
                  <Text style={[styles.answerError, rtlText(dir)]}>{m.a}</Text>
                ) : (
                  <ProMarkdown fontSize={14} rtl={answerRtl}>
                    {m.a}
                  </ProMarkdown>
                )
              ) : (
                <Text style={[styles.thinking, rtlText(dir)]}>{t("proTools.thinking")}</Text>
              )}
            </Animated.View>
          ))}
        </View>
      </GlideHeight>
      </Animated.View>

      {/* form: flex gap-2 */}
      <View style={[styles.form, rtlRow(dir)]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={t("proTools.askPlaceholder")}
          placeholderTextColor={C.t3}
          style={[styles.input, rtlText(dir)]}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={() => void submit()}
          selectionColor={C.accent}
          keyboardAppearance="dark"
        />
        <ProButton
          variant="solid"
          onPress={() => void submit()}
          disabled={asking || !input.trim()}
          accessibilityLabel={t("proTools.askSubmit")}
        >
          {t("proTools.askSubmit")}
        </ProButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: C.t3, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  glideOuter: { overflow: "hidden" },
  glideInner: { position: "absolute", top: 0, left: 0, right: 0 },
  listOuter: { marginBottom: 12 },
  list: { gap: 12 },
  // inline-block px-3 py-2 rounded-2xl text-[13px] font-semibold mb-1.5
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    marginBottom: 6,
    backgroundColor: C.accentSoft,
    maxWidth: "100%",
  },
  bubbleText: { color: C.accent, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  answerError: { color: C.red, fontSize: 12.5, lineHeight: 18 },
  thinking: { color: C.t3, fontSize: 13, lineHeight: 19 },
  form: { gap: 8, alignItems: "center" },
  // flex-1 h-10 px-3 rounded-xl text-[13px], bg / borderLight
  input: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    fontSize: 13,
    color: C.w,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
});

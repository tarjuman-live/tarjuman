/**
 * HeadingReveal — mirror of src/components/landing/heading-reveal.tsx (GSAP
 * SplitText word rise). The heading is split into words, each clipped by its
 * own mask (equivalent to SplitText's line mask for pure vertical motion).
 * When the heading's top crosses 82% of the viewport (`start: 'top 82%'`)
 * each word rises from yPercent 110 → 0 and fades 0 → 1, power3.out, 0.7s,
 * stagger 0.035s. Scrolling back above the line REVERSES the whole timeline
 * (`toggleActions: 'play none none reverse'`), last word first; a mid-flight
 * reversal re-targets from the current time (like timeline.reverse()).
 *
 * Plain <Text> under Reduce Motion or an RTL UI locale (the web skips the
 * split for ar/ur to protect Arabic letter joining).
 *
 *   <HeadingReveal text={t("lp.featuresHeading")} style={styles.h2} lineHeight={36} />
 *
 * Must sit inside a <RevealScrollView> to track scrolling (outside it, it
 * plays once the heading is laid out within 82% of the window).
 */
import { type StyleProp, Text, View, type TextStyle, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { EASE_FN, HEADING, useReduceMotion } from "~/lib/motion";
import { useLocale } from "~/i18n";
import { useInView } from "./reveal";

export interface HeadingRevealProps {
  text: string;
  /** Font styles for the words (fontSize, fontWeight, color, letterSpacing…). */
  style?: StyleProp<TextStyle>;
  /** Line height in px — the rise distance is 110% of it. */
  lineHeight: number;
  align?: "center" | "left";
  containerStyle?: StyleProp<ViewStyle>;
}

export function HeadingReveal({ text, style, lineHeight, align = "center", containerStyle }: HeadingRevealProps) {
  const reduce = useReduceMotion();
  const { isRtl } = useLocale();
  if (reduce || isRtl) {
    return (
      <View style={containerStyle}>
        <Text accessibilityRole="header" style={[style, { lineHeight, textAlign: align }]}>
          {text}
        </Text>
      </View>
    );
  }
  // Keyed by the text: the web reverts + re-splits on a locale change
  // (useEffect [locale]) and gsap.from() re-renders the words hidden, so a
  // heading already past its trigger REPLAYS the rise. Remounting does the same.
  return <SplitHeading key={text} text={text} style={style} lineHeight={lineHeight} align={align} containerStyle={containerStyle} />;
}

function SplitHeading({ text, style, lineHeight, align, containerStyle }: Required<Omit<HeadingRevealProps, "style" | "containerStyle">> & Pick<HeadingRevealProps, "style" | "containerStyle">) {
  const words = text.split(/\s+/).filter(Boolean);
  const n = words.length;
  const total = HEADING.durationS + HEADING.staggerS * Math.max(0, n - 1);
  const time = useSharedValue(0);
  const { ref, onLayout, inView } = useInView({ mode: { kind: "topLine", at: HEADING.triggerAt } });

  useAnimatedReaction(
    () => inView.value,
    (on, prev) => {
      if (on === prev || (prev === null && !on)) return;
      if (on) {
        time.value = withTiming(total, { duration: Math.max(0, total - time.value) * 1000, easing: Easing.linear });
      } else {
        time.value = withTiming(0, { duration: Math.max(0, time.value) * 1000, easing: Easing.linear });
      }
    },
    [total]
  );

  return (
    <Animated.View
      ref={ref}
      onLayout={onLayout}
      accessible
      accessibilityRole="header"
      accessibilityLabel={text}
      style={[
        { flexDirection: "row", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start" },
        containerStyle,
      ]}
    >
      {words.map((w, i) => (
        <View key={`${i}-${w}`} style={{ overflow: "hidden", height: lineHeight }} importantForAccessibility="no-hide-descendants">
          <Word word={i < n - 1 ? `${w} ` : w} index={i} time={time} style={style} lineHeight={lineHeight} />
        </View>
      ))}
    </Animated.View>
  );
}

function Word({
  word,
  index,
  time,
  style,
  lineHeight,
}: {
  word: string;
  index: number;
  time: SharedValue<number>;
  style?: StyleProp<TextStyle>;
  lineHeight: number;
}) {
  const offset = index * HEADING.staggerS;
  const rise = (HEADING.yPercent / 100) * lineHeight;
  const a = useAnimatedStyle(() => {
    const l = Math.min(1, Math.max(0, (time.value - offset) / HEADING.durationS));
    const e = EASE_FN.power3Out(l);
    return { opacity: e, transform: [{ translateY: (1 - e) * rise }] };
  });
  return <Animated.Text style={[style, { lineHeight }, a]}>{word}</Animated.Text>;
}

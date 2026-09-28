import { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View, type NativeScrollEvent } from "react-native";
import { isRtl } from "~/lib/lang";
import { C, RADIUS, TRANSCRIPT_FONT } from "~/lib/theme";

export interface TranscriptRow {
  id: string;
  sourceText: string;
  /** undefined = still translating; "" = fail-open blank translation. */
  translatedText?: string;
  error?: string;
}

interface Props {
  rows: TranscriptRow[];
  sourceLanguage: string;
  targetLanguage: string;
  /** Live partial, rendered faded under the last card. */
  interimText?: string;
  /** Glide to the newest segment as it lands (live view). */
  follow?: boolean;
  header?: React.ReactNode;
  empty?: React.ReactNode;
  onRetry?: (id: string) => void;
}

/**
 * The transcript IS the product: large type, source card (blue edge, correct
 * RTL direction) above its translation (green edge). Auto-follows the bottom
 * while the user is at the bottom; scrolling up to re-read pauses following.
 */
export function Transcript({
  rows,
  sourceLanguage,
  targetLanguage,
  interimText,
  follow,
  header,
  empty,
  onRetry,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const stuckRef = useRef(true);
  const srcRtl = isRtl(sourceLanguage);
  const tgtRtl = isRtl(targetLanguage);
  const same = sourceLanguage === targetLanguage;

  useEffect(() => {
    if (follow && stuckRef.current) scrollRef.current?.scrollToEnd({ animated: true });
  }, [follow, rows, interimText]);

  const onScroll = ({ nativeEvent: e }: { nativeEvent: NativeScrollEvent }) => {
    const fromBottom = e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y;
    stuckRef.current = fromBottom < 120;
  };

  return (
    <ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={64}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      {header}
      {rows.length === 0 && !interimText ? empty : null}
      {rows.map((r) => (
        <View key={r.id} style={styles.pair}>
          <Text style={[styles.source, align(srcRtl)]}>{r.sourceText}</Text>
          {!same && (
            <View style={styles.translation}>
              {r.error ? (
                <Text style={styles.error} onPress={onRetry ? () => onRetry(r.id) : undefined}>
                  Translation failed{onRetry ? " — tap to retry" : ""}
                </Text>
              ) : r.translatedText === undefined ? (
                <Text style={styles.pending}>Translating…</Text>
              ) : r.translatedText ? (
                <Text style={[styles.translated, align(tgtRtl)]}>{r.translatedText}</Text>
              ) : null}
            </View>
          )}
        </View>
      ))}
      {interimText ? (
        <Text style={[styles.source, styles.interim, align(srcRtl)]}>{interimText}</Text>
      ) : null}
    </ScrollView>
  );
}

// RTL is not optional: Arabic/Urdu source must read right-to-left.
const align = (rtl: boolean) =>
  rtl ? ({ writingDirection: "rtl", textAlign: "right" } as const) : ({ writingDirection: "ltr" } as const);

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  pair: { gap: 8 },
  source: {
    color: C.w,
    fontSize: TRANSCRIPT_FONT + 1,
    lineHeight: (TRANSCRIPT_FONT + 1) * 1.6,
    backgroundColor: C.blueSoft,
    borderLeftColor: C.blue,
    borderLeftWidth: 3,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: "hidden",
  },
  interim: { opacity: 0.45 },
  translation: {
    backgroundColor: C.accentSoft,
    borderLeftColor: C.accent,
    borderLeftWidth: 3,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  translated: { color: C.w, fontSize: TRANSCRIPT_FONT, lineHeight: TRANSCRIPT_FONT * 1.5 },
  pending: { color: C.t3, fontSize: 15, fontStyle: "italic" },
  error: { color: C.red, fontSize: 15 },
});

/**
 * SummarySection — the summary half of src/components/session/session-body.tsx
 * (idle CTA → SummaryLoading → ready card / error card), ported with the web's
 * exact motion:
 *
 *   Generate button : `transition-transform active:scale-[0.98]` (150ms,
 *                     bezier(.4,0,.2,1)); disabled:opacity-40 snaps; gradient
 *                     135deg accent → accentDk + glow 0 0 24px accent@35.
 *   Language        : <LangDropdown/> beside it (any-language summary).
 *   Loading         : <SummaryLoading/> until the first streamed characters.
 *   Typewriter      : the two-pump drain (16ms tick, take =
 *                     min(buf, max(10, ceil(buf/6)), 48)) via useTypewriter.
 *                     The ready card appears on the first tick, instantly
 *                     (web: no crossfade between phases).
 *   Citations       : after the stream drains, the text is POSTed to
 *                     /api/verify-citations; a non-skipped result replaces the
 *                     summary. Web snaps; native crossfades the markdown
 *                     (out 120ms / in 180ms, fades only) per the fluid rule,
 *                     and the text slot's height glides old → new (220ms
 *                     SMOOTH, clipping the ghost) so the card and disclaimer
 *                     never snap under the crossfade (SwapHeight). Outside
 *                     that 220ms window the text is in normal layout, so the
 *                     streamed typewriter grows the card in-frame, unclipped.
 *
 * Also exports <SummaryMarkdown/> (the web's ReactMarkdown component map) and
 * renderLinks() (lib/citation-renderer's `[label](url)` → accent links).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent, type TextStyle } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { fetch as expoFetch } from "expo/fetch";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView } from "expo-symbols";
import { useAuthToken } from "@convex-dev/auth/react";
import { apiUrl } from "~/lib/config";
import { isRtl } from "~/lib/lang";
import { C } from "~/lib/theme";
import { EASE, twEnter, twExit, useReduceMotion } from "~/lib/motion";
import { useT } from "~/i18n";
import { PressableScale, useTypewriter } from "~/components/motion";
import { LangDropdown } from "~/components/lang-dropdown";
import { SummaryLoading } from "~/components/summary-loading";

/** Per-language base size — session-body.tsx (Arabic/Urdu and CJK read small). */
export function baseFontSize(lang: string): number {
  if (isRtl(lang)) return 21;
  if (lang === "zh" || lang === "ja" || lang === "ko") return 18;
  return 17;
}

const verifiedIn = twEnter({ opacity: 0, duration: 180 });
const unverifiedOut = twExit({ opacity: 0, duration: 120 });

type Phase =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export interface SummarySectionProps {
  /** Text sent to the LLM: translated || source, joined by spaces (web). */
  transcriptForLLM: string;
  hasSegments: boolean;
  targetLang: string;
  /** Persisted summary (Convex). Shown as the ready card while idle. */
  existingSummary: string | null;
  existingSummaryLang?: string | null;
  /** Called once after a successful generation so the caller can persist. */
  onSummaryGenerated?: (summary: string, language: string) => void | Promise<unknown>;
  /**
   * Rendered INSTEAD of the idle Generate row (web session-body.tsx:238-245:
   * `phase === "idle" && plan && !plan.canSummarize` → <UpgradeCard/> in a
   * mb-5 wrapper). Only replaces the idle CTA, so an in-flight or ready
   * summary is never swapped out.
   */
  idleReplacement?: ReactNode;
}

export function SummarySection({
  transcriptForLLM,
  hasSegments,
  targetLang,
  existingSummary,
  existingSummaryLang,
  onSummaryGenerated,
  idleReplacement,
}: SummarySectionProps) {
  const t = useT();
  const authToken = useAuthToken();
  const tw = useTypewriter();
  const [state, setState] = useState<Phase>({ phase: "idle" });
  const [summaryLang, setSummaryLang] = useState(targetLang);
  const [verified, setVerified] = useState(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const handleGenerate = async () => {
    if (!hasSegments) return;
    const lang = summaryLang;
    tw.reset();
    setVerified(false);
    setState({ phase: "loading" });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    try {
      const res = await expoFetch(apiUrl("/api/summarize"), {
        method: "POST",
        headers,
        body: JSON.stringify({ transcript: transcriptForLLM, targetLanguage: lang }),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !res.body || contentType.includes("application/json")) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (aliveRef.current) {
          setState({
            phase: "error",
            message: data.error ?? t("session.summaryFailedStatus", { status: res.status }),
          });
        }
        return;
      }

      // Pump 1: network → buffer (as fast as it arrives). Pump 2 (16ms drain)
      // lives in useTypewriter.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        if (!aliveRef.current) {
          void reader.cancel().catch(() => {});
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        tw.push(decoder.decode(value, { stream: true }));
      }
      const tail = decoder.decode();
      if (tail) tw.push(tail);
      const displayed = await tw.finish();
      if (!aliveRef.current) return;

      // Hadith/Quran verification pass (canonical text + sunnah.com links,
      // hallucinated numbers stripped). Silent fallback to the typed text.
      let finalText = displayed;
      try {
        const vRes = await expoFetch(apiUrl("/api/verify-citations"), {
          method: "POST",
          headers,
          body: JSON.stringify({ text: displayed, targetLanguage: lang }),
        });
        if (vRes.ok) {
          const vData = (await vRes.json().catch(() => ({}))) as { text?: string; skipped?: boolean };
          if (vData.text && vData.text.length > 0) {
            finalText = vData.text;
            if (!vData.skipped && aliveRef.current && finalText !== displayed) {
              tw.set(finalText);
              setVerified(true);
            }
          }
        }
      } catch {
        /* keep displayed text as-is */
      }

      if (!aliveRef.current) return;
      setState({ phase: "ready" });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await onSummaryGenerated?.(finalText, lang);
    } catch (e) {
      // Kill the drain BEFORE the error so a late tick can't overwrite it.
      tw.cancel();
      if (aliveRef.current) {
        setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  const showExisting = state.phase === "idle" && !!existingSummary;
  const showReady = state.phase === "ready" || (state.phase === "loading" && tw.started) || showExisting;
  const readyText = showExisting ? (existingSummary ?? "") : tw.text;
  const readyLang = showExisting ? (existingSummaryLang ?? targetLang) : summaryLang;

  return (
    <>
      {state.phase === "idle" && !existingSummary && idleReplacement ? (
        <View style={{ marginBottom: 20 }}>{idleReplacement}</View>
      ) : state.phase === "idle" && !existingSummary ? (
        <View style={styles.ctaRow}>
          <GenerateButton label={t("record.generateSummary")} disabled={!hasSegments} onPress={handleGenerate} />
          {/* Summary language — any of the 30+, not just the target. */}
          <LangDropdown value={summaryLang} onChange={setSummaryLang} />
        </View>
      ) : null}

      {state.phase === "loading" && !tw.started ? <SummaryLoading /> : null}

      {showReady ? (
        <View style={styles.readyCard}>
          <View style={styles.readyHeader}>
            <SymbolView name="sparkle" tintColor={C.accent} size={14} />
            <Text style={styles.readyLabel}>{t("session.summaryLabel")}</Text>
          </View>
          <SwapHeight swapKey={verified ? 1 : 0}>
            <Animated.View
              key={verified ? "verified" : "typed"}
              entering={verified ? verifiedIn : undefined}
              exiting={verified ? undefined : unverifiedOut}
            >
              <SummaryMarkdown text={readyText} lang={readyLang} baseSize={baseFontSize(targetLang)} />
            </Animated.View>
          </SwapHeight>
          <View style={styles.disclaimer}>
            <Text style={styles.disclaimerText}>{t("session.summaryDisclaimer")}</Text>
          </View>
        </View>
      ) : null}

      {state.phase === "error" ? (
        <View style={styles.errorCard} accessibilityRole="alert">
          <Text style={styles.errorLabel}>{t("session.summaryFailed")}</Text>
          <Text style={styles.errorMessage}>{state.message}</Text>
          <Text style={styles.errorRetry} onPress={() => void handleGenerate()} accessibilityRole="button">
            {t("foundation.tryAgain")}
          </Text>
        </View>
      ) : null}
    </>
  );
}

// ─── Citation swap height ───────────────────────────────────────────────────

const SWAP_MS = 220;

/**
 * Holds the markdown's slot through the citation crossfade. The exiting ghost
 * leaves layout on Fabric, so without this the card and the disclaimer would
 * snap to the verified text's height while the old text (still fading) spilled
 * over them.
 *
 * Normal flow is the DEFAULT: the inner view sits in layout and the outer is
 * `height: auto`, so every typewriter tick grows the card in the same frame it
 * paints, with nothing clipped (web session-body.tsx:269-297). The inner
 * height is only tracked into `h`.
 *
 * Only for the swap does it lock, in two phases:
 *   1. When `swapKey` changes, it keeps rendering the PREVIOUS children and
 *      flips `locked` on the UI thread. The outer is pinned to the last
 *      measured height with overflow hidden, and the inner goes absolute, so
 *      nothing moves.
 *   2. Two frames later, once the lock has surely applied, it renders the new
 *      children. The inner's onLayout glides `h` old → new over 220ms SMOOTH,
 *      the ghost's fade is clipped to the slot, and at 220ms the slot unlocks
 *      back to normal flow at the same height, with no jump.
 * Under Reduce Motion the height snaps; the lock still clips the fading ghost.
 */
function SwapHeight({ swapKey, children }: { swapKey: number; children: ReactNode }) {
  const reduce = useReduceMotion();
  const h = useSharedValue(0);
  const locked = useSharedValue(false);
  const [shownKey, setShownKey] = useState(swapKey);
  const held = useRef<ReactNode>(children);
  const pending = swapKey !== shownKey;
  if (!pending) held.current = children;
  const content = pending ? held.current : children;

  const glideUntil = useRef(0);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 1: lock at the current height, then swap the content two frames later.
  useEffect(() => {
    if (!pending) return;
    locked.value = true;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        glideUntil.current = Date.now() + SWAP_MS;
        if (unlockTimer.current) clearTimeout(unlockTimer.current);
        unlockTimer.current = setTimeout(() => {
          unlockTimer.current = null;
          glideUntil.current = 0;
          locked.value = false;
        }, SWAP_MS);
        setShownKey(swapKey);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [pending, swapKey, locked]);

  useEffect(
    () => () => {
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    },
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    const remaining = glideUntil.current - Date.now();
    if (remaining > 0 && !reduce) {
      // Phase 2: the glide. Only the lock window reads `h` for layout.
      h.value = withTiming(next, { duration: remaining, easing: EASE.smooth, reduceMotion: ReduceMotion.Never });
    } else {
      // Unlocked this only tracks, so the next lock starts from the true height.
      h.value = next;
    }
  };

  const outerAnimated = useAnimatedStyle(() =>
    locked.value ? { height: h.value } : { height: "auto" as const },
  );
  const innerAnimated = useAnimatedStyle(() => ({
    position: locked.value ? ("absolute" as const) : ("relative" as const),
  }));

  return (
    <Animated.View style={[styles.swapOuter, outerAnimated]}>
      <Animated.View style={[styles.swapInner, innerAnimated]} onLayout={onLayout}>
        {content}
      </Animated.View>
    </Animated.View>
  );
}

// ─── Generate button ────────────────────────────────────────────────────────

/**
 * `linear-gradient(135deg, accent, accentDk)` resolved exactly for the box:
 * the CSS gradient line runs through the centre at 135deg with length
 * (W + H)·sin45°, which in unit coordinates starts at ((W−H)/4W, (H−W)/4H).
 */
function cssAngle135(w: number, h: number) {
  if (!w || !h) return { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
  const x = (w - h) / (4 * w);
  const y = (h - w) / (4 * h);
  return { start: { x, y }, end: { x: 1 - x, y: 1 - y } };
}

function GenerateButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const g = cssAngle135(size.w, size.h);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      disabledOpacity={0.4}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
      }}
      style={styles.generate}
    >
      <LinearGradient
        pointerEvents="none"
        colors={[C.accent, C.accentDk]}
        start={g.start}
        end={g.end}
        style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
      />
      <SymbolView name="sparkle" tintColor="#0A0F1C" size={16} />
      <Text style={styles.generateText}>{label}</Text>
    </PressableScale>
  );
}

// ─── Markdown ───────────────────────────────────────────────────────────────

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

const openLink = (url: string) => {
  void WebBrowser.openBrowserAsync(url).catch(() => {});
};

/** lib/citation-renderer.tsx: plain text with `[label](url)` → accent underlined links. */
export function renderLinks(text: string, keyPrefix = "l"): ReactNode {
  if (!text || !text.includes("[")) return text;
  const out: ReactNode[] = [];
  let cursor = 0;
  LINK_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = LINK_RE.exec(text)); ) {
    if (m.index > cursor) out.push(text.slice(cursor, m.index));
    const url = m[2];
    out.push(
      <Text key={`${keyPrefix}${m.index}`} style={styles.link} onPress={() => openLink(url)} accessibilityRole="link">
        {m[1]}
      </Text>
    );
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

const INLINE_RE = /(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE_RE).map((part, j) => {
    const k = `${keyPrefix}-${j}`;
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <Text key={k} style={{ fontWeight: "700", color: C.w }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith("[") && part.includes("](")) return <Text key={k}>{renderLinks(part, k)}</Text>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <Text key={k} style={styles.code}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      if (part.length > 2) {
        return (
          <Text key={k} style={{ fontStyle: "italic" }}>
            {part.slice(1, -1)}
          </Text>
        );
      }
    }
    return <Text key={k}>{part}</Text>;
  });
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: { marker: string; text: string }[] };

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of src.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "h", level: h[1].length, text: h[2] });
      continue;
    }
    const ul = /^\s*[-*•+]\s+(.*)$/.exec(line);
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const ordered = !!ol;
      const item = { marker: ol ? `${ol[1]}.` : "•", text: (ol ? ol[2] : ul![1]) ?? "" };
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "quote") last.text += ` ${q[1]}`;
      else blocks.push({ kind: "quote", text: q[1] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

/** session-body.tsx's ReactMarkdown component map, natively. */
export function SummaryMarkdown({ text, lang, baseSize }: { text: string; lang: string; baseSize: number }) {
  const rtl = isRtl(lang);
  const size = baseSize - 2;
  const dir: TextStyle = rtl ? { writingDirection: "rtl", textAlign: "right" } : { writingDirection: "ltr", textAlign: "left" };
  const body: TextStyle = {
    color: C.w,
    fontSize: size,
    lineHeight: size * 1.7,
    fontWeight: rtl ? "500" : "400",
    ...dir,
  };
  const blocks = parseBlocks(text);
  return (
    <View>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "h") {
          const hs: TextStyle =
            b.level === 1
              ? { fontSize: baseSize + 4, lineHeight: (baseSize + 4) * 1.35, fontWeight: "700", color: C.w, marginTop: 4, marginBottom: 12 }
              : b.level === 2
                ? { fontSize: baseSize + 1, lineHeight: (baseSize + 1) * 1.4, fontWeight: "700", color: C.accent, marginTop: 16, marginBottom: 8 }
                : { fontSize: baseSize, lineHeight: baseSize * 1.5, fontWeight: "600", color: C.w, marginTop: 12, marginBottom: 4 };
          return (
            <Text key={k} style={[dir, hs]} accessibilityRole="header">
              {inline(b.text, k)}
            </Text>
          );
        }
        if (b.kind === "quote") {
          return (
            <View
              key={k}
              style={[
                styles.quote,
                rtl ? { borderRightWidth: 3, paddingRight: 12 } : { borderLeftWidth: 3, paddingLeft: 12 },
              ]}
            >
              <Text style={[body, { fontStyle: "italic", color: "rgba(240, 244, 248, 0.8)" }]}>{inline(b.text, k)}</Text>
            </View>
          );
        }
        if (b.kind === "list") {
          return (
            <View key={k} style={[styles.list, rtl ? { paddingRight: 20 } : { paddingLeft: 20 }]}>
              {b.items.map((it, j) => (
                <View key={`${k}-${j}`} style={{ flexDirection: rtl ? "row-reverse" : "row" }}>
                  <Text style={[body, styles.marker, rtl ? { marginLeft: 6 } : { marginRight: 6 }]}>{it.marker}</Text>
                  <Text style={[body, { flex: 1 }]}>{inline(it.text, `${k}-${j}`)}</Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={k} style={[body, { marginBottom: 12 }]}>
            {inline(b.text, k)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 20 },
  generate: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    boxShadow: "0 0 24px rgba(46, 204, 113, 0.21)",
  },
  generateText: { color: "#0A0F1C", fontSize: 14, fontWeight: "700" },
  readyCard: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: "rgba(46, 204, 113, 0.19)",
  },
  swapOuter: { overflow: "hidden" },
  // `position` is animated (relative ↔ absolute) by SwapHeight; offsets are inert while relative.
  swapInner: { top: 0, left: 0, right: 0 },
  readyHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  readyLabel: { color: C.accent, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.55 },
  disclaimer: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.borderLight },
  disclaimerText: { color: C.t3, fontSize: 11, lineHeight: 16, fontStyle: "italic" },
  errorCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    marginBottom: 20,
    backgroundColor: C.redSoft,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
  },
  errorLabel: { color: C.red, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.55, marginBottom: 4 },
  errorMessage: { color: C.t2, fontSize: 12, lineHeight: 16 },
  errorRetry: { color: C.accent, fontSize: 12, fontWeight: "600", textDecorationLine: "underline", marginTop: 8, alignSelf: "flex-start" },
  link: { color: C.accent, textDecorationLine: "underline" },
  code: { fontFamily: "Menlo", fontSize: 14, backgroundColor: "rgba(240, 244, 248, 0.1)" },
  quote: { borderColor: C.accent, marginVertical: 12 },
  list: { marginBottom: 12, gap: 8 },
  marker: { color: C.w },
});

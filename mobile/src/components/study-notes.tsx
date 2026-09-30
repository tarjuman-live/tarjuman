/**
 * Pro AI tools — Study notes + full-transcript Translate panels, plus the
 * shared bits of src/components/session/pro-ai-tools.tsx (PrimaryButton,
 * ErrorLine), src/components/session/markdown.tsx and src/lib/stream-text.ts.
 *
 * Streaming parity: the web's streamText calls onUpdate with the accumulated
 * text on EVERY network chunk ("live, not throttled") and the panel re-renders
 * per chunk — no typewriter smoothing (unlike the summary). Same here, via
 * expo/fetch's streaming body. An AbortController cancels the in-flight
 * stream on tab switch (unmount) or re-run so the server stops generating.
 *
 * Buttons (web `transition-all duration-200 active:scale-[0.98]
 * hover:brightness-110 disabled:opacity-50`):
 *   - press: scale 1 → .98, 200ms bezier(.4,0,.2,1)
 *   - hover brightness(1.1) → press: a pre-brightened copy of the background
 *     (every channel ×1.1, i.e. exactly what the CSS filter computes) is
 *     cross-faded in over the same 200ms — linear per-channel, like the filter
 *     interpolation itself.
 *   - disabled: opacity FADES 1 ↔ .5 over 200ms (transition-all covers opacity)
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, {
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { fetch as expoFetch } from "expo/fetch";
import { useAuthToken } from "@convex-dev/auth/react";
import { C } from "~/lib/theme";
import { EASE } from "~/lib/motion";
import { apiUrl } from "~/lib/config";
import { isRtl, langName } from "~/lib/lang";
import { rtlRow, rtlText, translateNative, useLocale, useT } from "~/i18n";
import { LangDropdown } from "./lang-dropdown";

// ─── stream-text.ts ─────────────────────────────────────────────────────────

/**
 * Native port of src/lib/stream-text.ts. POSTs JSON with the Convex Bearer
 * token to the Next.js API, reads the text stream and calls `onUpdate` with
 * the accumulated text per chunk. Throws with the server's error message on a
 * non-OK / JSON response.
 */
export async function streamText(
  path: string,
  body: unknown,
  authToken: string | null | undefined,
  onUpdate: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await expoFetch(apiUrl(path), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || contentType.includes("application/json")) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      data.error ??
        translateNative("en", "proTools.requestFailed", { status: String(res.status) })
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onUpdate(text);
  }
  return text;
}

/** True when a thrown error is our own abort (superseded run / unmount). */
export function isAbort(e: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return e instanceof Error && e.name === "AbortError";
}

type Gen =
  | { phase: "idle" }
  | { phase: "loading"; text: string }
  | { phase: "ready"; text: string }
  | { phase: "error"; message: string };

/** The Gen state machine + abortable run shared by Study notes and Translate. */
function useStreamGen(path: string) {
  const authToken = useAuthToken();
  const [gen, setGen] = useState<Gen>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (body: unknown) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setGen({ phase: "loading", text: "" });
    try {
      const text = await streamText(
        path,
        body,
        authToken,
        (t) => {
          if (!controller.signal.aborted) setGen({ phase: "loading", text: t });
        },
        controller.signal
      );
      if (!controller.signal.aborted) setGen({ phase: "ready", text });
    } catch (e) {
      // Aborted (superseded run / unmount) — not a real error; leave state be.
      if (isAbort(e, controller.signal)) return;
      setGen({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return { gen, run };
}

// ─── Study notes ────────────────────────────────────────────────────────────

export function StudyNotes({ transcript, targetLang }: { transcript: string; targetLang: string }) {
  const t = useT();
  const { dir } = useLocale();
  const [lang, setLang] = useState(targetLang);
  const { gen, run } = useStreamGen("/api/study-notes");
  const go = () => void run({ transcript, targetLanguage: lang });

  return (
    <View>
      <View style={[styles.controls, rtlRow(dir)]}>
        <PrimaryButton onPress={go} disabled={gen.phase === "loading"} icon="doc.text">
          {gen.phase === "loading"
            ? t("record.generating")
            : gen.phase === "ready"
              ? t("proTools.regenerate")
              : t("proTools.generateNotes")}
        </PrimaryButton>
        <LangDropdown value={lang} onChange={setLang} disabled={gen.phase === "loading"} />
      </View>
      {(gen.phase === "loading" || gen.phase === "ready") && gen.text ? (
        <ProMarkdown fontSize={15} rtl={isRtl(lang)}>
          {gen.text}
        </ProMarkdown>
      ) : null}
      {gen.phase === "error" ? <ErrorLine message={gen.message} onRetry={go} /> : null}
    </View>
  );
}

// ─── Translate full transcript ──────────────────────────────────────────────

export function TranslateTranscript({
  transcript,
  sourceLang,
  targetLang,
}: {
  transcript: string;
  sourceLang: string;
  targetLang: string;
}) {
  const t = useT();
  const { dir } = useLocale();
  const [lang, setLang] = useState(targetLang === "en" ? "ur" : "en");
  const { gen, run } = useStreamGen("/api/translate-transcript");
  const go = () => void run({ transcript, targetLanguage: lang });
  const rtl = isRtl(lang);

  return (
    <View>
      <Text style={[styles.hint, rtlText(dir)]}>
        {t("proTools.translateHint", { lang: langName(sourceLang) })}
      </Text>
      <View style={[styles.controls, rtlRow(dir)]}>
        <PrimaryButton onPress={go} disabled={gen.phase === "loading"} icon="globe">
          {gen.phase === "loading"
            ? t("proTools.translating")
            : gen.phase === "ready"
              ? t("proTools.retranslate")
              : t("proTools.translate")}
        </PrimaryButton>
        <LangDropdown value={lang} onChange={setLang} disabled={gen.phase === "loading"} />
      </View>
      {(gen.phase === "loading" || gen.phase === "ready") && gen.text ? (
        <Text
          selectable
          style={[
            styles.translation,
            rtl
              ? { writingDirection: "rtl", textAlign: "right" }
              : { writingDirection: "ltr", textAlign: "left" },
          ]}
        >
          {gen.text}
        </Text>
      ) : null}
      {gen.phase === "error" ? <ErrorLine message={gen.message} onRetry={go} /> : null}
    </View>
  );
}

// ─── Shared: buttons ────────────────────────────────────────────────────────

const INK = "#0A0F1C";

/** CSS `filter: brightness(k)` applied to a #RRGGBB colour. */
export function brighten(hex: string, k = 1.1): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.min(255, Math.round(v * k));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

const GRADIENT: [string, string] = [C.accent, C.accentDk];
const GRADIENT_BRIGHT: [string, string] = [brighten(C.accent), brighten(C.accentDk)];

/**
 * CSS `linear-gradient(135deg, a, b)` on any box size: the gradient line runs
 * at 135deg through the centre with length (w+h)/√2, so its end points in
 * unit space are .5 ∓ (w+h)/4 / (w|h). (A plain (0,0)→(1,1) diagonal is only
 * equal to 135deg on a square.)
 */
export function CssGradient135({
  colors,
  style,
}: {
  colors: [string, string];
  style?: StyleProp<ViewStyle>;
}) {
  const [size, setSize] = useState({ w: 1, h: 1 });
  const d = (size.w + size.h) / 4;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== size.w || height !== size.h)) {
      setSize({ w: width, h: height });
    }
  };
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0.5 - d / size.w, y: 0.5 - d / size.h }}
      end={{ x: 0.5 + d / size.w, y: 0.5 + d / size.h }}
      style={[StyleSheet.absoluteFill, style]}
      onLayout={onLayout}
    />
  );
}

/**
 * `transition-all duration-200 active:scale-[0.98] hover:brightness-110
 * disabled:opacity-50` — the AI tools' PrimaryButton (gradient) and the Ask
 * submit (solid accent).
 */
export function ProButton({
  onPress,
  disabled = false,
  variant = "gradient",
  icon,
  children,
  style,
  accessibilityLabel,
}: {
  onPress: () => void;
  disabled?: boolean;
  variant?: "gradient" | "solid";
  icon?: SFSymbol;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const pressed = useSharedValue(0);
  const dim = useSharedValue(disabled ? 1 : 0);
  const cfg = { duration: 200, easing: EASE.tw, reduceMotion: ReduceMotion.Never };

  useEffect(() => {
    dim.value = withTiming(disabled ? 1 : 0, {
      duration: 200,
      easing: EASE.tw,
      reduceMotion: ReduceMotion.Never,
    });
    if (disabled) pressed.value = withTiming(0, { duration: 200, easing: EASE.tw, reduceMotion: ReduceMotion.Never });
  }, [disabled, dim, pressed]);

  const container = useAnimatedStyle(() => ({
    opacity: interpolate(dim.value, [0, 1], [1, 0.5]),
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, 0.98]) }],
  }));
  const bright = useAnimatedStyle(() => ({ opacity: pressed.value }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        pressed.value = withTiming(1, cfg);
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, cfg);
      }}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[styles.btn, style, container]}>
        <View pointerEvents="none" style={styles.btnFill}>
          {variant === "gradient" ? (
            <>
              <CssGradient135 colors={GRADIENT} />
              <Animated.View style={[StyleSheet.absoluteFill, bright]}>
                <CssGradient135 colors={GRADIENT_BRIGHT} />
              </Animated.View>
            </>
          ) : (
            <>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: C.accent }]} />
              <Animated.View
                style={[StyleSheet.absoluteFill, { backgroundColor: brighten(C.accent) }, bright]}
              />
            </>
          )}
        </View>
        {icon ? <SymbolView name={icon} tintColor={INK} size={15} /> : null}
        {typeof children === "string" ? <Text style={styles.btnText}>{children}</Text> : children}
      </Animated.View>
    </Pressable>
  );
}

/** Web PrimaryButton: gradient, h-10 px-4 rounded-xl, 13px bold, icon 15. */
export function PrimaryButton({
  onPress,
  disabled,
  icon,
  children,
}: {
  onPress: () => void;
  disabled?: boolean;
  icon: SFSymbol;
  children: string;
}) {
  return (
    <ProButton onPress={onPress} disabled={disabled} icon={icon} variant="gradient">
      {children}
    </ProButton>
  );
}

export function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  const { dir } = useLocale();
  return (
    <Text style={[styles.error, rtlText(dir)]}>
      {message}{" "}
      <Text style={styles.retry} onPress={onRetry} accessibilityRole="button">
        {t("foundation.tryAgain")}
      </Text>
    </Text>
  );
}

// ─── Shared: markdown (src/components/session/markdown.tsx) ─────────────────

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[]; start: number }
  | { kind: "quote"; text: string };

/** Line-level markdown blocks — enough for the AI output formats (streaming-safe). */
function parseBlocks(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join(" ") });
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
      out.push({ kind: "h", level: Math.min(3, h[1].length) as 1 | 2 | 3, text: h[2] });
      continue;
    }
    const ul = /^\s*[-*+•]\s+(.*)$/.exec(line);
    if (ul) {
      flush();
      const last = out[out.length - 1];
      if (last?.kind === "ul") last.items.push(ul[1]);
      else out.push({ kind: "ul", items: [ul[1]] });
      continue;
    }
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flush();
      const last = out[out.length - 1];
      if (last?.kind === "ol") last.items.push(ol[2]);
      else out.push({ kind: "ol", items: [ol[2]], start: Number(ol[1]) || 1 });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      flush();
      const last = out[out.length - 1];
      if (last?.kind === "quote") last.text += ` ${q[1]}`;
      else out.push({ kind: "quote", text: q[1] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

/** **bold**, *em* / _em_, `code`. Unterminated markers (mid-stream) stay literal. */
function Inline({ text, base }: { text: string; base: StyleProp<TextStyle> }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g);
  return (
    <Text style={base} selectable>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
          return (
            <Text key={i} style={styles.mdStrong}>
              {part.slice(2, -2)}
            </Text>
          );
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
          return (
            <Text key={i} style={styles.mdCode}>
              {part.slice(1, -1)}
            </Text>
          );
        if (
          part.length > 2 &&
          ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_")))
        )
          return (
            <Text key={i} style={styles.mdEm}>
              {part.slice(1, -1)}
            </Text>
          );
        return part;
      })}
    </Text>
  );
}

/**
 * Dark-theme markdown for AI output — the web's session/markdown.tsx sizes:
 * base fontSize, line-height 1.7, weight rtl ? 500 : 400; h1 +4 bold
 * (mb-3 mt-1), h2 +1 bold accent (mt-4 mb-2), h3 semibold (mt-3 mb-1),
 * p mb-3, lists pl-5 mb-3 space-y-2 (li leading-relaxed), blockquote 3px
 * accent rule pl-3 my-3 italic w/80%.
 */
export function ProMarkdown({
  children,
  fontSize = 15,
  rtl = false,
}: {
  children: string;
  fontSize?: number;
  rtl?: boolean;
}) {
  const blocks = parseBlocks(children);
  const dirStyle: TextStyle = rtl
    ? { writingDirection: "rtl", textAlign: "right" }
    : { writingDirection: "ltr", textAlign: "left" };
  const base: TextStyle = {
    color: C.w,
    fontSize,
    lineHeight: Math.round(fontSize * 1.7),
    fontWeight: rtl ? "500" : "400",
    ...dirStyle,
  };
  const li: TextStyle = { ...base, lineHeight: Math.round(fontSize * 1.625) };
  const row = { flexDirection: rtl ? "row-reverse" : "row" } as const;
  const listPad = rtl ? { paddingRight: 20 } : { paddingLeft: 20 };

  return (
    <View>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h":
            return b.level === 1 ? (
              <Inline
                key={i}
                text={b.text}
                base={[base, { fontSize: fontSize + 4, lineHeight: Math.round((fontSize + 4) * 1.4), fontWeight: "700", marginTop: 4, marginBottom: 12 }]}
              />
            ) : b.level === 2 ? (
              <Inline
                key={i}
                text={b.text}
                base={[base, { fontSize: fontSize + 1, lineHeight: Math.round((fontSize + 1) * 1.5), fontWeight: "700", color: C.accent, marginTop: 16, marginBottom: 8 }]}
              />
            ) : (
              <Inline key={i} text={b.text} base={[base, { fontWeight: "600", marginTop: 12, marginBottom: 4 }]} />
            );
          case "p":
            return <Inline key={i} text={b.text} base={[base, { marginBottom: 12 }]} />;
          case "ul":
          case "ol":
            return (
              <View key={i} style={[listPad, { marginBottom: 12, gap: 8 }]}>
                {b.items.map((item, j) => (
                  <View key={j} style={[row, { gap: 6 }]}>
                    <Text style={[li, { textAlign: rtl ? "right" : "left" }]}>
                      {b.kind === "ul" ? "•" : `${b.start + j}.`}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Inline text={item} base={li} />
                    </View>
                  </View>
                ))}
              </View>
            );
          case "quote":
            return (
              <View
                key={i}
                style={[
                  { marginVertical: 12 },
                  rtl
                    ? { borderRightWidth: 3, borderRightColor: C.accent, paddingRight: 12 }
                    : { borderLeftWidth: 3, borderLeftColor: C.accent, paddingLeft: 12 },
                ]}
              >
                <Inline text={b.text} base={[base, { fontStyle: "italic", color: "rgba(240,244,248,0.8)" }]} />
              </View>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // flex items-center gap-2 mb-3
  controls: { alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" },
  hint: { color: C.t3, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  // text-[15px] leading-relaxed whitespace-pre-wrap
  translation: { color: C.w, fontSize: 15, lineHeight: 24 },
  // flex items-center justify-center gap-2 px-4 h-10 rounded-xl
  btn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, overflow: "hidden" },
  btnText: { color: INK, fontSize: 13, fontWeight: "700" },
  error: { color: C.red, fontSize: 12.5, lineHeight: 18 },
  retry: { color: C.accent, fontWeight: "600", textDecorationLine: "underline" },
  mdStrong: { fontWeight: "700", color: C.w },
  mdEm: { fontStyle: "italic" },
  mdCode: { fontFamily: "Menlo", fontSize: 13, backgroundColor: "rgba(240,244,248,0.1)" },
});

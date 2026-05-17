"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuthToken } from "@convex-dev/auth/react";
import { COLORS } from "@/lib/constants";
import { isRtl } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { useStickyBottom } from "@/hooks/use-sticky-bottom";
import { renderTextWithLinks } from "@/lib/citation-renderer";

interface NormalizedSegment {
  id: string;
  sourceText: string;
  translatedText: string;
  /** Verse/hadith merge metadata persisted in Convex (see schema). */
  mergedFromIds?: string[];
  combinedSourceText?: string;
  combinedTranslatedText?: string;
}

interface SessionBodyProps {
  segments: NormalizedSegment[];
  sourceLang: string;
  targetLang: string;
  /** Pre-existing summary text (from storage). When null, show the Generate CTA. */
  existingSummary?: string | null;
  /** Called once after a successful generation so the parent can persist. */
  onSummaryGenerated?: (summary: string) => void;
}

type SummaryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; text: string }
  | { phase: "error"; message: string };

/**
 * Shared scrollable body used by both the post-stop CompletedView and the
 * /session/[id] detail page. Owns the summary-generation UI state but lets
 * the caller decide where to persist the result.
 */
export function SessionBody({
  segments,
  sourceLang,
  targetLang,
  existingSummary,
  onSummaryGenerated,
}: SessionBodyProps) {
  const sourceRtl = isRtl(sourceLang);
  const targetRtl = isRtl(targetLang);
  // Per-language base font sizes — Arabic, Urdu, and CJK render visually
  // smaller than Latin at the same px size, so we bump them up.
  const sourceFontSize = sourceRtl
    ? 21
    : sourceLang === "zh" || sourceLang === "ja" || sourceLang === "ko"
      ? 18
      : 17;
  const targetFontSize = targetRtl
    ? 21
    : targetLang === "zh" || targetLang === "ja" || targetLang === "ko"
      ? 18
      : 17;

  const [summary, setSummary] = useState<SummaryState>(() =>
    existingSummary ? { phase: "ready", text: existingSummary } : { phase: "idle" }
  );
  const { scrollRef, onScroll } = useStickyBottom<HTMLDivElement>(200);
  const authToken = useAuthToken();

  const handleGenerate = async () => {
    if (segments.length === 0) return;
    setSummary({ phase: "loading" });
    const transcriptForLLM = segments
      .map((s) => s.translatedText || s.sourceText)
      .join(" ");
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers,
        body: JSON.stringify({
          transcript: transcriptForLLM,
          targetLanguage: targetLang,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !res.body || contentType.includes("application/json")) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setSummary({
          phase: "error",
          message: data.error ?? `Summary failed (${res.status})`,
        });
        return;
      }

      // Smooth typewriter: Claude streams chunks in fast, but we display
      // characters on a steady rhythm so the text "flows" in.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ""; // unread characters waiting to be shown
      let displayed = ""; // what's currently on screen
      let streamDone = false;

      // ~60 chars/sec feels like natural reading pace. Tweak this if you
      // want it faster or slower:
      //   higher number  = faster flow
      //   lower  number  = slower flow
      const CHARS_PER_SEC = 120;
      const TICK_MS = 16; // ~60fps refresh
      const charsPerTick = Math.max(
        1,
        Math.round((CHARS_PER_SEC * TICK_MS) / 1000)
      );

      // Pump 1: read from the network as fast as it arrives, push into buffer.
      const readPump = (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            streamDone = true;
            break;
          }
          buffer += decoder.decode(value, { stream: true });
        }
      })();

      // Pump 2: drip from buffer to screen at a steady rhythm.
      const drainPump = new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (buffer.length > 0) {
            const take = Math.min(charsPerTick, buffer.length);
            displayed += buffer.slice(0, take);
            buffer = buffer.slice(take);
            setSummary({ phase: "ready", text: displayed });
          } else if (streamDone) {
            clearInterval(timer);
            resolve();
          }
        }, TICK_MS);
      });

      await Promise.all([readPump, drainPump]);

      // Sunnah.com verification pass on the completed summary text.
      // Hadith citations get replaced with sunnah.com's canonical body +
      // a clickable markdown link; hallucinated numbers get stripped.
      // Falls back silently to the un-enriched text on any error or when
      // SUNNAH_API_KEY isn't set on the server.
      let finalText = displayed;
      try {
        const vRes = await fetch("/api/verify-citations", {
          method: "POST",
          headers,
          body: JSON.stringify({
            text: displayed,
            targetLanguage: targetLang,
          }),
        });
        if (vRes.ok) {
          const vData = (await vRes.json().catch(() => ({}))) as {
            text?: string;
            skipped?: boolean;
          };
          if (vData.text && vData.text.length > 0) {
            finalText = vData.text;
            if (!vData.skipped) setSummary({ phase: "ready", text: finalText });
          }
        }
      } catch {
        /* keep displayed text as-is */
      }

      onSummaryGenerated?.(finalText);
    } catch (e) {
      setSummary({
        phase: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex-1 overflow-auto px-5 py-4"
    >
      {summary.phase === "idle" && (
        <button
          type="button"
          onClick={handleGenerate}
          disabled={segments.length === 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-bold text-sm cursor-pointer transition-transform active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed mb-5"
          style={{
            background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
            color: "#0A0F1C",
            boxShadow: `0 0 24px ${COLORS.accent}35`,
          }}
        >
          <Icon name="sparkle" size={16} color="#0A0F1C" />
          Generate AI Summary
        </button>
      )}

      {summary.phase === "loading" && (
        <div
          className="px-4 py-5 rounded-2xl mb-5 flex items-center gap-3"
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            className="w-4 h-4 rounded-full border-2 animate-spin"
            style={{
              borderColor: `${COLORS.accent} transparent ${COLORS.accent} ${COLORS.accent}`,
            }}
          />
          <span className="text-sm" style={{ color: COLORS.t2 }}>
            Generating summary…
          </span>
        </div>
      )}

      {summary.phase === "ready" && (
        <div
          className="px-4 py-4 rounded-2xl mb-5"
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.accent}30`,
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Icon name="sparkle" size={14} color={COLORS.accent} />
            <span
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: COLORS.accent }}
            >
              Summary
            </span>
          </div>
          <div
            className="summary-markdown"
            style={{
              color: COLORS.w,
              direction: targetRtl ? "rtl" : "ltr",
              textAlign: targetRtl ? "right" : "left",
              fontSize: targetFontSize - 2,
              lineHeight: 1.7,
              fontWeight: targetRtl ? 500 : 400,
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: (props) => (
                  <h1
                    className="font-bold mb-3 mt-1"
                    style={{ fontSize: targetFontSize + 4, color: COLORS.w }}
                    {...props}
                  />
                ),
                h2: (props) => (
                  <h2
                    className="font-bold mt-4 mb-2"
                    style={{ fontSize: targetFontSize + 1, color: COLORS.accent }}
                    {...props}
                  />
                ),
                h3: (props) => (
                  <h3
                    className="font-semibold mt-3 mb-1"
                    style={{ fontSize: targetFontSize, color: COLORS.w }}
                    {...props}
                  />
                ),
                p: (props) => <p className="mb-3" {...props} />,
                ul: (props) => (
                  <ul className="list-disc pl-5 mb-3 space-y-2" {...props} />
                ),
                ol: (props) => (
                  <ol className="list-decimal pl-5 mb-3 space-y-2" {...props} />
                ),
                li: (props) => <li className="leading-relaxed" {...props} />,
                strong: (props) => (
                  <strong
                    className="font-bold"
                    style={{ color: COLORS.w }}
                    {...props}
                  />
                ),
                em: (props) => <em className="italic" {...props} />,
                blockquote: (props) => (
                  <blockquote
                    className="pl-3 my-3 italic"
                    style={{
                      borderLeft: `3px solid ${COLORS.accent}`,
                      color: `${COLORS.w}cc`,
                    }}
                    {...props}
                  />
                ),
                code: (props) => (
                  <code
                    className="px-1.5 py-0.5 rounded font-mono text-[0.9em]"
                    style={{ background: `${COLORS.w}1a` }}
                    {...props}
                  />
                ),
                a: (props) => (
                  <a
                    className="underline"
                    style={{ color: COLORS.accent }}
                    target="_blank"
                    rel="noreferrer"
                    {...props}
                  />
                ),
              }}
            >
              {summary.text}
            </ReactMarkdown>
          </div>
          <div
            className="mt-4 pt-3 text-[11px] italic"
            style={{
              color: COLORS.t3,
              borderTop: `1px solid ${COLORS.borderLight}`,
            }}
          >
            Quranic and hadith references are best-effort recognition by the
            AI — verify against original sources before quoting or sharing.
          </div>
        </div>
      )}

      {summary.phase === "error" && (
        <div
          className="px-4 py-3 rounded-2xl mb-5"
          style={{
            background: COLORS.redSoft,
            border: `1px solid ${COLORS.red}40`,
          }}
          role="alert"
        >
          <div
            className="text-[11px] font-bold uppercase tracking-wider mb-1"
            style={{ color: COLORS.red }}
          >
            Summary failed
          </div>
          <div className="text-xs" style={{ color: COLORS.t2 }}>
            {summary.message}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            className="mt-2 text-xs font-semibold underline"
            style={{ color: COLORS.accent }}
          >
            Try again
          </button>
        </div>
      )}

      <div
        className="text-[11px] font-bold uppercase tracking-wider mb-3"
        style={{ color: COLORS.t4 }}
      >
        Transcript
      </div>

      {segments.length === 0 && (
        <div className="text-sm text-center py-8" style={{ color: COLORS.t4 }}>
          No transcript captured.
        </div>
      )}

      {/* Hide child segments that were merged into a later verse/hadith
          parent. The parent renders the combined source + translation. */}
      {(() => {
        const suppressed = new Set<string>();
        for (const s of segments) {
          for (const childId of s.mergedFromIds ?? []) suppressed.add(childId);
        }
        return segments
          .filter((s) => !suppressed.has(s.id))
          .map((seg) => {
            const sourceForDisplay = seg.combinedSourceText ?? seg.sourceText;
            const translatedForDisplay =
              seg.combinedTranslatedText ?? seg.translatedText;
            return (
              <div key={seg.id} className="mb-4">
                <div
                  className="px-4 py-3 rounded-2xl mb-[6px]"
                  style={{
                    background: `${COLORS.blue}14`,
                    borderLeft: `3px solid ${COLORS.blue}66`,
                    direction: sourceRtl ? "rtl" : "ltr",
                    textAlign: sourceRtl ? "right" : "left",
                  }}
                >
                  <div
                    style={{
                      color: COLORS.t2,
                      fontSize: sourceFontSize,
                      lineHeight: 1.7,
                      fontWeight: sourceRtl ? 500 : 400,
                    }}
                  >
                    {sourceForDisplay}
                  </div>
                </div>
                {translatedForDisplay && (
                  <div
                    className="px-4 py-3 rounded-2xl"
                    style={{
                      background: `${COLORS.accent}10`,
                      borderLeft: `3px solid ${COLORS.accent}66`,
                      direction: targetRtl ? "rtl" : "ltr",
                      textAlign: targetRtl ? "right" : "left",
                    }}
                  >
                    <div
                      style={{
                        color: COLORS.w,
                        fontSize: targetFontSize,
                        lineHeight: 1.7,
                        fontWeight: targetRtl ? 600 : 500,
                      }}
                    >
                      {renderTextWithLinks(translatedForDisplay)}
                    </div>
                  </div>
                )}
              </div>
            );
          });
      })()}
    </div>
  );
}

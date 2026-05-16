"use client";

import { useMemo, useState } from "react";
import { COLORS } from "@/lib/constants";
import { formatDuration, getLangName } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { SessionBody } from "./session-body";
import type { LiveSegment } from "@/types";

export interface CompletedSession {
  /** The persisted session id, if persistence is enabled. Null in tests / fallback. */
  _id: string | null;
  segments: LiveSegment[];
  translations: Record<string, string>;
  /** Verse/hadith merge records — keyed by parent segment id. */
  merges?: Record<
    string,
    { fromIds: string[]; combinedSourceText: string; combinedTranslatedText: string }
  >;
  durationSec: number;
  sourceLang: string;
  targetLang: string;
}

interface CompletedViewProps {
  session: CompletedSession;
  onNewRecording: () => void;
  /** Called once the user generates a summary, so the page can persist it. */
  onSummaryGenerated?: (summary: string) => void;
}

export function CompletedView({
  session,
  onNewRecording,
  onSummaryGenerated,
}: CompletedViewProps) {
  const [copied, setCopied] = useState(false);

  const normalizedSegments = useMemo(
    () =>
      session.segments
        .filter((s) => s.isFinal)
        .map((s) => {
          const merge = session.merges?.[s.id];
          return {
            id: s.id,
            sourceText: s.text,
            translatedText: session.translations[s.id] ?? "",
            ...(merge
              ? {
                  mergedFromIds: merge.fromIds,
                  combinedSourceText: merge.combinedSourceText,
                  combinedTranslatedText: merge.combinedTranslatedText,
                }
              : {}),
          };
        }),
    [session.segments, session.translations, session.merges]
  );

  const handleCopy = async () => {
    const lines: string[] = [];
    for (const seg of normalizedSegments) {
      lines.push(seg.sourceText);
      if (seg.translatedText) lines.push(`  → ${seg.translatedText}`);
      lines.push("");
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n").trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="flex flex-col flex-1" style={{ paddingBottom: 60 }}>
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full grid place-items-center"
            style={{ background: COLORS.accent }}
          >
            <Icon name="check" size={14} color="#0A0F1C" />
          </div>
          <span className="text-base font-bold" style={{ color: COLORS.w }}>
            Session complete
          </span>
        </div>
        <div
          className="text-sm font-bold tabular-nums"
          style={{ color: COLORS.t2, fontFamily: "var(--font-mono)" }}
        >
          {formatDuration(session.durationSec)}
        </div>
      </div>

      <div
        className="px-5 py-2 flex items-center justify-center gap-2"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <span className="text-xs font-semibold" style={{ color: COLORS.t3 }}>
          {getLangName(session.sourceLang)}
        </span>
        <span className="text-xs" style={{ color: COLORS.t4 }}>
          →
        </span>
        <span
          className="text-xs font-semibold"
          style={{ color: COLORS.accent }}
        >
          {getLangName(session.targetLang)}
        </span>
      </div>

      <SessionBody
        segments={normalizedSegments}
        sourceLang={session.sourceLang}
        targetLang={session.targetLang}
        onSummaryGenerated={onSummaryGenerated}
      />

      <div
        className="px-5 py-3 flex gap-2"
        style={{ borderTop: `1px solid ${COLORS.border}` }}
      >
        <button
          type="button"
          onClick={handleCopy}
          className="flex-1 h-11 rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold cursor-pointer transition-transform active:scale-[0.98]"
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.borderLight}`,
            color: copied ? COLORS.accent : COLORS.t2,
          }}
        >
          <Icon
            name={copied ? "check" : "copy"}
            size={16}
            color={copied ? COLORS.accent : COLORS.t2}
          />
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onNewRecording}
          className="flex-1 h-11 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold cursor-pointer transition-transform active:scale-[0.98]"
          style={{
            background: COLORS.accent,
            color: "#0A0F1C",
            boxShadow: `0 0 18px ${COLORS.accent}30`,
          }}
        >
          <Icon name="mic" size={16} color="#0A0F1C" />
          New recording
        </button>
      </div>
    </div>
  );
}

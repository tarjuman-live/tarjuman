"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { COLORS } from "@/lib/constants";
import { formatDate, formatDuration, getLangName } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { SessionBody } from "@/components/session/session-body";
import { useSession } from "@/hooks/use-sessions";
import { useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params?.id ?? null;
  const session = useSession(sessionId);

  const [copied, setCopied] = useState(false);

  // Rename / delete are intentionally not exposed on the detail page —
  // both actions live on the history-card buttons. Keeps the detail
  // header focused on viewing the session content.
  const saveSummaryM = useMutation(api.sessions.saveSummary);

  const normalizedSegments = useMemo(
    () =>
      session?.segments.map((s) => ({
        id: s.id,
        sourceText: s.sourceText,
        translatedText: s.translatedText,
        mergedFromIds: s.mergedFromIds,
        combinedSourceText: s.combinedSourceText,
        combinedTranslatedText: s.combinedTranslatedText,
      })) ?? [],
    [session?.segments]
  );

  // Loading
  if (session === undefined) {
    return (
      <div
        className="flex flex-col flex-1 items-center justify-center"
        style={{ paddingBottom: 60 }}
      >
        <div
          className="w-5 h-5 rounded-full border-2 animate-spin"
          style={{
            borderColor: `${COLORS.accent} transparent ${COLORS.accent} ${COLORS.accent}`,
          }}
        />
      </div>
    );
  }

  // Not found
  if (session === null) {
    return (
      <div className="flex flex-col flex-1" style={{ paddingBottom: 60 }}>
        <div
          className="px-5 py-4 flex items-center gap-3"
          style={{ borderBottom: `1px solid ${COLORS.border}` }}
        >
          <Link
            href="/history"
            className="w-9 h-9 rounded-lg grid place-items-center"
            aria-label="Back"
          >
            <Icon name="back" size={18} color={COLORS.t2} />
          </Link>
          <div className="text-base font-bold" style={{ color: COLORS.w }}>
            Session not found
          </div>
        </div>
        <div
          className="flex-1 grid place-items-center px-8 text-center text-sm"
          style={{ color: COLORS.t3 }}
        >
          This session no longer exists or was recorded on a different device.
        </div>
      </div>
    );
  }

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

  const handleSummaryGenerated = (summary: string) => {
    if (!sessionId) return;
    void saveSummaryM({
      sessionId: sessionId as Id<"sessions">,
      summary,
      summaryLanguage: session.targetLanguage,
    });
  };

  const handleDownloadMarkdown = () => {
    const lines: string[] = [];
    lines.push(`# ${session.title ?? "Untitled session"}`);
    lines.push("");
    lines.push(
      `*${getLangName(session.sourceLanguage)} → ${getLangName(
        session.targetLanguage
      )} · ${formatDate(session.createdAt)} · ${formatDuration(session.duration)}*`
    );
    lines.push("");
    if (session.summary) {
      lines.push("## Summary");
      lines.push("");
      lines.push(session.summary);
      lines.push("");
    }
    lines.push("## Transcript");
    lines.push("");
    for (const seg of normalizedSegments) {
      lines.push(`> ${seg.sourceText}`);
      if (seg.translatedText) {
        lines.push("");
        lines.push(seg.translatedText);
      }
      lines.push("");
    }
    const md = lines.join("\n").trimEnd() + "\n";

    // Slugify the title for the filename. Strip special chars, collapse
    // whitespace, cap at ~40 chars so it survives most filesystems.
    const slug =
      (session.title ?? "session")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 40) || "session";
    const date = new Date(session.createdAt).toISOString().slice(0, 10);
    const filename = `livetranscribe-${date}-${slug}.md`;

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const title = session.title ?? "Untitled session";

  return (
    <div className="flex flex-col flex-1" style={{ paddingBottom: 60 }}>
      {/* Header */}
      <div
        className="px-5 py-4 flex items-center gap-3"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <Link
          href="/history"
          className="w-9 h-9 rounded-lg grid place-items-center transition-colors"
          aria-label="Back"
          style={{ background: COLORS.surface }}
        >
          <Icon name="back" size={18} color={COLORS.t2} />
        </Link>
        <div className="flex-1 min-w-0">
          <div
            className="w-full text-left text-[15px] font-bold truncate"
            style={{ color: COLORS.w }}
          >
            {title}
          </div>
          <div className="text-[11px]" style={{ color: COLORS.t4 }}>
            {formatDuration(session.duration)}
          </div>
        </div>
      </div>

      {/* Language pair */}
      <div
        className="px-5 py-2 flex items-center justify-center gap-2"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <span className="text-xs font-semibold" style={{ color: COLORS.t3 }}>
          {getLangName(session.sourceLanguage)}
        </span>
        <span className="text-xs" style={{ color: COLORS.t4 }}>
          →
        </span>
        <span
          className="text-xs font-semibold"
          style={{ color: COLORS.accent }}
        >
          {getLangName(session.targetLanguage)}
        </span>
      </div>

      <SessionBody
        segments={normalizedSegments}
        sourceLang={session.sourceLanguage}
        targetLang={session.targetLanguage}
        existingSummary={session.summary ?? null}
        onSummaryGenerated={handleSummaryGenerated}
      />

      {/* Action bar */}
      <div
        className="px-5 py-3 flex gap-2"
        style={{ borderTop: `1px solid ${COLORS.border}` }}
      >
        <button
          type="button"
          onClick={handleCopy}
          className="flex-1 h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold cursor-pointer transition-transform active:scale-[0.98]"
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
          onClick={handleDownloadMarkdown}
          aria-label="Download as Markdown"
          className="flex-1 h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold cursor-pointer transition-transform active:scale-[0.98]"
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.borderLight}`,
            color: COLORS.t2,
          }}
        >
          <Icon name="doc" size={16} color={COLORS.t2} />
          Download .md
        </button>
      </div>
    </div>
  );
}

"use client";

import { memo } from "react";
import { COLORS } from "@/lib/constants";
import { isRtl, getLangName } from "@/lib/utils";
import { useStickyBottom } from "@/hooks/use-sticky-bottom";
import { Icon } from "@/components/shared/icon";
import { AnimateIn } from "./animate-in";
import { renderTextWithLinks } from "@/lib/citation-renderer";
import {
  fontSizeForLang,
  speakerColor,
  dominantSpeaker,
  type LiveTranscriptProps,
} from "./live-transcript";
import type { LiveSegment } from "@/types";

/**
 * One row in the SOURCE pane, memoized so a parent re-render (interim text /
 * pulse / timer, several times a second) doesn't reconcile every row of a long
 * lecture. Props are primitives + the stable seg object.
 */
const SplitSourceRow = memo(function SplitSourceRow({
  seg,
  text,
  sourceRtl,
  sourceFontSize,
  showSpeakerBadges,
}: {
  seg: LiveSegment;
  text: string;
  sourceRtl: boolean;
  sourceFontSize: number;
  showSpeakerBadges: boolean;
}) {
  const sc = speakerColor(seg.speaker);
  return (
    <AnimateIn
      variant="source"
      className="mb-3"
      style={{ textAlign: sourceRtl ? "right" : "left" }}
    >
      {showSpeakerBadges && typeof seg.speaker === "number" && (
        <div
          className="text-[10px] font-bold uppercase tracking-wider mb-[2px]"
          style={{ color: sc }}
        >
          Speaker {seg.speaker + 1}
        </div>
      )}
      <div
        style={{
          color: COLORS.t2,
          fontSize: sourceFontSize,
          lineHeight: 1.7,
          fontWeight: sourceRtl ? 500 : 400,
        }}
      >
        {text}
      </div>
    </AnimateIn>
  );
});

/** One row in the TARGET pane, memoized (see SplitSourceRow). */
const SplitTargetRow = memo(function SplitTargetRow({
  seg,
  translated,
  pending,
  error,
  targetRtl,
  targetFontSize,
  onRetry,
}: {
  seg: LiveSegment;
  translated: string | undefined;
  pending: boolean;
  error: string | undefined;
  targetRtl: boolean;
  targetFontSize: number;
  onRetry?: (id: string) => void;
}) {
  return (
    <div
      className="mb-3"
      style={{ textAlign: targetRtl ? "right" : "left" }}
    >
      {translated && translated.length > 0 ? (
        <AnimateIn variant="translation">
          <div
            style={{
              color: COLORS.w,
              fontSize: targetFontSize,
              lineHeight: 1.7,
              fontWeight: targetRtl ? 600 : 500,
            }}
          >
            {renderTextWithLinks(translated)}
          </div>
        </AnimateIn>
      ) : pending ? (
        <div className="text-[14px]" style={{ color: COLORS.t3 }}>
          …translating
        </div>
      ) : error ? (
        <button
          type="button"
          onClick={() => onRetry?.(seg.id)}
          className="text-left cursor-pointer text-[13px] font-semibold"
          style={{ color: COLORS.amber }}
        >
          Translation failed — tap to retry
        </button>
      ) : null /* fail-open: source-only, no translation for this segment */}
    </div>
  );
});

/**
 * Split ("half and half") transcript view — the same live data as
 * {@link LiveTranscript}, but with each language in its own independently
 * scrolling pane instead of paired cards.
 *
 * Responsive: stacks top (source) / bottom (target) on a phone, becomes
 * left / right columns on a tablet or wider screen (`md:`). Both panes pin to
 * the newest line (sticky-bottom); a "↓ latest" pill appears if the user
 * scrolls up. Drop-in: identical props to LiveTranscript, so the shell can
 * swap between the two with no other change.
 */
export function SplitTranscript({
  segments,
  interimText,
  sourceLang,
  translations,
  targetLang,
  mainSpeakerOnly = false,
  merges,
  suppressedIds,
  filteredIds,
  errors,
  pending,
  onRetry,
}: LiveTranscriptProps) {
  const {
    scrollRef: srcRef,
    onScroll: srcScroll,
    isStuck: srcStuck,
    scrollToBottom: srcToBottom,
  } = useStickyBottom<HTMLDivElement>(200);
  const {
    scrollRef: tgtRef,
    onScroll: tgtScroll,
    isStuck: tgtStuck,
    scrollToBottom: tgtToBottom,
  } = useStickyBottom<HTMLDivElement>(200);

  const sourceRtl = isRtl(sourceLang);
  const targetRtl = targetLang ? isRtl(targetLang) : false;
  const sourceFontSize = fontSizeForLang(sourceLang);
  const targetFontSize = fontSizeForLang(targetLang ?? "en");

  // Same visibility rules as the paired view: optional main-speaker filter,
  // then drop merge-children and server-filtered noise.
  const dominant = dominantSpeaker(segments);
  const speakerFiltered = mainSpeakerOnly
    ? segments.filter((s) => s.speaker === undefined || s.speaker === dominant)
    : segments;
  const visibleSegments = speakerFiltered.filter(
    (s) => !suppressedIds?.has(s.id) && !filteredIds?.has(s.id)
  );

  const speakerSet = new Set<number>();
  for (const s of segments) {
    if (typeof s.speaker === "number") speakerSet.add(s.speaker);
  }
  const showSpeakerBadges = speakerSet.size > 1;

  const showEmpty = visibleSegments.length === 0 && !interimText;

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
      {/* ── SOURCE half ── */}
      <section
        className="flex-1 min-h-0 flex flex-col relative overflow-hidden border-b md:border-b-0 md:border-r"
        style={{ borderColor: COLORS.border }}
      >
        <PaneLabel name={getLangName(sourceLang)} color={COLORS.t3} />
        <div
          ref={srcRef}
          onScroll={srcScroll}
          dir={sourceRtl ? "rtl" : "ltr"}
          className="flex-1 overflow-auto px-4 pb-4 transcript-scroll"
          style={{ direction: sourceRtl ? "rtl" : "ltr" }}
        >
          {showEmpty && (
            <div className="text-center py-10" style={{ color: COLORS.t4 }}>
              <div className="text-sm">Listening…</div>
              <div className="text-xs mt-1">Speak or play audio nearby.</div>
            </div>
          )}
          {visibleSegments.map((seg) => {
            const merge = merges?.[seg.id];
            return (
              <SplitSourceRow
                key={seg.id}
                seg={seg}
                text={merge?.combinedSourceText ?? seg.text}
                sourceRtl={sourceRtl}
                sourceFontSize={sourceFontSize}
                showSpeakerBadges={showSpeakerBadges}
              />
            );
          })}
          {interimText && (
            <div
              className="opacity-50"
              style={{ textAlign: sourceRtl ? "right" : "left" }}
            >
              <div
                style={{
                  color: COLORS.t3,
                  fontSize: sourceFontSize,
                  lineHeight: 1.7,
                  fontWeight: sourceRtl ? 500 : 400,
                }}
              >
                {interimText}
              </div>
            </div>
          )}
        </div>
        {!srcStuck && <LatestPill onClick={() => srcToBottom(true)} />}
      </section>

      {/* ── TARGET half ── */}
      <section className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
        <PaneLabel name={getLangName(targetLang ?? "en")} color={COLORS.accent} />
        <div
          ref={tgtRef}
          onScroll={tgtScroll}
          dir={targetRtl ? "rtl" : "ltr"}
          className="flex-1 overflow-auto px-4 pb-4 transcript-scroll"
          style={{ direction: targetRtl ? "rtl" : "ltr" }}
        >
          {showEmpty && (
            <div className="text-center py-10 text-xs" style={{ color: COLORS.t4 }}>
              Translation appears here.
            </div>
          )}
          {visibleSegments.map((seg) => {
            const merge = merges?.[seg.id];
            return (
              <SplitTargetRow
                key={seg.id}
                seg={seg}
                translated={
                  merge?.combinedTranslatedText ?? translations?.[seg.id]
                }
                pending={pending?.has(seg.id) ?? false}
                error={errors?.[seg.id]}
                targetRtl={targetRtl}
                targetFontSize={targetFontSize}
                onRetry={onRetry}
              />
            );
          })}
        </div>
        {!tgtStuck && <LatestPill onClick={() => tgtToBottom(true)} />}
      </section>
    </div>
  );
}

/** Fixed, non-scrolling language label at the top of each pane. */
function PaneLabel({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider shrink-0"
      style={{ color, borderBottom: `1px solid ${COLORS.border}` }}
    >
      {name}
    </div>
  );
}

/** "↓ latest" pill — shown when a pane is scrolled up off the bottom. */
function LatestPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to latest"
      className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 h-8 rounded-full flex items-center gap-1 text-[11px] font-bold cursor-pointer transition-transform active:scale-95 z-10"
      style={{
        background: COLORS.accent,
        color: "#0A0F1C",
        boxShadow: `0 6px 24px ${COLORS.accent}40, 0 0 0 1px ${COLORS.accent}`,
      }}
    >
      <span>latest</span>
      <Icon name="chevron" size={11} color="#0A0F1C" className="rotate-90" />
    </button>
  );
}

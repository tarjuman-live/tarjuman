"use client";

import { useEffect, useRef, useState } from "react";
import { COLORS } from "@/lib/constants";
import { isRtl } from "@/lib/utils";
import { useStickyBottom } from "@/hooks/use-sticky-bottom";
import { Icon } from "@/components/shared/icon";
import { renderTextWithLinks } from "@/lib/citation-renderer";
import type { LiveSegment } from "@/types";

export interface LiveTranscriptProps {
  segments: LiveSegment[];
  interimText: string;
  sourceLang: string;
  translations?: Record<string, string>;
  targetLang?: string;
  mainSpeakerOnly?: boolean;
  /**
   * Verse/hadith merge data from the translator. Parent segments listed
   * here render the combined source + translation; children appear in
   * `suppressedIds` and are skipped from the render entirely.
   */
  merges?: Record<
    string,
    { fromIds: string[]; combinedSourceText: string; combinedTranslatedText: string }
  >;
  suppressedIds?: Set<string>;
  /** Segments filtered as noise (too short / off-language) — hide entirely. */
  filteredIds?: Set<string>;
  /** Segment id → translation error message (failed after retries). */
  errors?: Record<string, string>;
  /** Segment ids whose translation is currently in flight. */
  pending?: Set<string>;
  /** Clear a segment's error and re-attempt its translation (tap to retry). */
  onRetry?: (id: string) => void;
}

const SPEAKER_COLORS = [
  "#3B82F6",
  "#A855F7",
  "#F59E0B",
  "#EF4444",
  "#10B981",
  "#EC4899",
];

export function speakerColor(s: number | undefined): string {
  if (s === undefined) return SPEAKER_COLORS[0];
  return SPEAKER_COLORS[s % SPEAKER_COLORS.length];
}

export function dominantSpeaker(segments: LiveSegment[]): number | undefined {
  const totals = new Map<number, number>();
  for (const s of segments) {
    if (typeof s.speaker !== "number") continue;
    totals.set(s.speaker, (totals.get(s.speaker) ?? 0) + (s.durationSec ?? 1));
  }
  if (totals.size === 0) return undefined;
  let maxDur = -1;
  let dominant: number | undefined;
  for (const [sp, d] of totals) {
    if (d > maxDur) {
      maxDur = d;
      dominant = sp;
    }
  }
  return dominant;
}

/**
 * Per-language base font sizes for transcript text.
 *
 * Arabic, Urdu, and other RTL/CJK scripts render visually smaller than
 * Latin at the same px size — same x-height, but more glyph density per
 * line. We bump these up so perceived readability matches.
 *
 * For RTL fallback we also nudge `letter-spacing` slightly looser since
 * the system Arabic fonts (SF Arabic on iOS, Geeza Pro on macOS) get a
 * touch tight at this size.
 */
export function fontSizeForLang(lang: string): number {
  if (isRtl(lang)) return 22; // Arabic / Urdu
  if (lang === "zh" || lang === "ja" || lang === "ko") return 20;
  return 19;
}

/**
 * Scrollable transcript column shown during recording.
 *
 * Auto-scroll: `useStickyBottom` keeps the view pinned to the latest
 * segment with a 200px lookahead. When the user scrolls up to read past
 * content, sticky disengages and a "↓ N new" pill appears in the bottom
 * corner — tapping it smooth-scrolls back and re-engages sticky.
 */
export function LiveTranscript({
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
  const { scrollRef, onScroll, isStuck, scrollToBottom } =
    useStickyBottom<HTMLDivElement>(200);
  const sourceRtl = isRtl(sourceLang);
  const targetRtl = targetLang ? isRtl(targetLang) : false;
  const sourceFontSize = fontSizeForLang(sourceLang);
  const targetFontSize = fontSizeForLang(targetLang ?? "en");

  const dominant = dominantSpeaker(segments);
  const speakerFiltered = mainSpeakerOnly
    ? segments.filter((s) => s.speaker === undefined || s.speaker === dominant)
    : segments;
  // Hide:
  //   - children merged into a parent (verse/hadith continuation absorbed
  //     by a later card)
  //   - noise segments filtered server-side (single-word, off-language)
  const visibleSegments = speakerFiltered.filter((s) => {
    if (suppressedIds?.has(s.id)) return false;
    if (filteredIds?.has(s.id)) return false;
    return true;
  });

  // Track unread count: every time a new VISIBLE segment arrives while the user
  // is scrolled up (not stuck), increment; reset when they scroll back to the
  // bottom. Counts visibleSegments — NOT raw segments — so a server-filtered /
  // merged-child / off-speaker segment that never renders doesn't inflate the
  // "N new" pill (which would otherwise scroll to no actual new line).
  const [unread, setUnread] = useState(0);
  const lastSeenLenRef = useRef(0);

  useEffect(() => {
    if (isStuck) {
      lastSeenLenRef.current = visibleSegments.length;
      setUnread(0);
      return;
    }
    if (visibleSegments.length > lastSeenLenRef.current) {
      setUnread(visibleSegments.length - lastSeenLenRef.current);
    }
  }, [visibleSegments.length, isStuck]);

  const speakerSet = new Set<number>();
  for (const s of segments) {
    if (typeof s.speaker === "number") speakerSet.add(s.speaker);
  }
  const showSpeakerBadges = speakerSet.size > 1;

  const showEmpty = visibleSegments.length === 0 && !interimText;

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="absolute inset-0 overflow-auto px-5 py-4 transcript-scroll"
      >
        {showEmpty && (
          <div className="text-center py-10" style={{ color: COLORS.t4 }}>
            <div className="text-sm">Listening…</div>
            <div className="text-xs mt-1">
              Speak or play audio through a speaker near your device.
            </div>
          </div>
        )}

        {visibleSegments.map((seg) => {
          // Verse/hadith merge: if this is a parent, display the combined
          // source + combined translation (children are already filtered).
          const merge = merges?.[seg.id];
          const sourceTextForDisplay = merge?.combinedSourceText ?? seg.text;
          const translated = merge?.combinedTranslatedText ?? translations?.[seg.id];
          const sc = speakerColor(seg.speaker);
          return (
            <div key={seg.id} className="mb-5">
              <div
                dir={sourceRtl ? "rtl" : "ltr"}
                className="px-4 py-3 rounded-2xl mb-[6px]"
                style={{
                  background: `${sc}14`,
                  // Logical property so the accent bar hugs the START (right for
                  // Arabic/Urdu RTL source), not always the physical left.
                  borderInlineStart: `3px solid ${sc}66`,
                  direction: sourceRtl ? "rtl" : "ltr",
                  textAlign: sourceRtl ? "right" : "left",
                }}
              >
                {showSpeakerBadges && typeof seg.speaker === "number" && (
                  <div
                    className="text-[10px] font-bold uppercase tracking-wider mb-1"
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
                  {sourceTextForDisplay}
                </div>
              </div>
              {translated && translated.length > 0 ? (
                <div
                  dir={targetRtl ? "rtl" : "ltr"}
                  className="px-4 py-3 rounded-2xl"
                  style={{
                    background: `${COLORS.accent}10`,
                    borderInlineStart: `3px solid ${COLORS.accent}66`,
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
                    {renderTextWithLinks(translated)}
                  </div>
                </div>
              ) : pending?.has(seg.id) ? (
                <div
                  className="px-4 py-3 rounded-2xl"
                  style={{
                    background: `${COLORS.accent}10`,
                    borderInlineStart: `3px solid ${COLORS.accent}66`,
                  }}
                >
                  <div className="text-[14px]" style={{ color: COLORS.t3 }}>
                    …translating
                  </div>
                </div>
              ) : errors?.[seg.id] ? (
                // Translation failed (after retries) — show it instead of a
                // silent gap, and let the user tap to re-attempt.
                <button
                  type="button"
                  onClick={() => onRetry?.(seg.id)}
                  className="w-full text-left px-4 py-3 rounded-2xl cursor-pointer transition active:scale-[0.99]"
                  style={{
                    background: `${COLORS.amber}14`,
                    borderLeft: `3px solid ${COLORS.amber}66`,
                  }}
                >
                  <div
                    className="text-[13px] font-semibold"
                    style={{ color: COLORS.amber }}
                  >
                    Translation failed — tap to retry
                  </div>
                  <div
                    className="text-[11px] mt-1 break-words"
                    style={{ color: COLORS.t3 }}
                  >
                    {errors[seg.id]}
                  </div>
                </button>
              ) : null /* fail-open: source-only (no translation), render nothing */}
            </div>
          );
        })}

        {interimText && (
          <div
            dir={sourceRtl ? "rtl" : "ltr"}
            className="px-4 py-3 rounded-2xl opacity-50"
            style={{
              background: `${COLORS.blue}0D`,
              borderInlineStart: `3px solid ${COLORS.blue}33`,
              direction: sourceRtl ? "rtl" : "ltr",
              textAlign: sourceRtl ? "right" : "left",
            }}
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

      {/* Floating "↓ N new" pill — appears when the user has scrolled up
          past the sticky threshold AND new content has arrived since.
          Tap re-engages sticky and smooth-scrolls down. Standard pattern
          from Slack / Discord / iMessage. */}
      {!isStuck && unread > 0 && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 h-9 rounded-full flex items-center gap-2 text-[12px] font-bold cursor-pointer transition-transform active:scale-95 z-10"
          style={{
            background: COLORS.accent,
            color: "#0A0F1C",
            boxShadow: `0 6px 24px ${COLORS.accent}40, 0 0 0 1px ${COLORS.accent}`,
          }}
          aria-label={`Scroll to ${unread} new ${unread === 1 ? "segment" : "segments"}`}
        >
          <span>{unread} new</span>
          <Icon
            name="chevron"
            size={12}
            color="#0A0F1C"
            className="rotate-90"
          />
        </button>
      )}
    </div>
  );
}

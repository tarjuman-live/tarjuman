/**
 * Which live segments get written to Convex, and in what shape — pure,
 * shared by the web record page and the native app so both persist the same
 * transcript from the same live state.
 */

import type { LiveSegment } from "../types";
import type { MergeRecord } from "./translate-client";
import { isOffLanguageScript } from "./script";

export interface StoredSegment {
  id: string;
  sourceText: string;
  translatedText: string;
  timestamp: number;
  mergedFromIds?: string[];
  combinedSourceText?: string;
  combinedTranslatedText?: string;
}

export interface FlushInput {
  segments: LiveSegment[];
  /** Ids already written. Mutated: filtered + selected ids are added. */
  flushed: Set<string>;
  filteredIds: Set<string>;
  completedIds: Set<string>;
  /**
   * Ids whose translation FAILED and isn't being retried right now. They're
   * saved source-only on a regular tick rather than holding back every later
   * segment until Stop (see the ordering note below); a successful retry is
   * patched in afterwards.
   */
  errorIds: Set<string>;
  translations: Record<string, string>;
  merges: Record<string, MergeRecord>;
  sameLanguage: boolean;
  /** Stop: persist untranslated finals too (blank translation). */
  force: boolean;
}

/**
 * Returns the batch for addSegments and marks it flushed.
 *
 * - Noise the translator filtered server-side is never persisted.
 * - Only a COMPLETED translation is ever written. `translations[id]` also holds
 *   the partial text of a translation still streaming; persisting that saved a
 *   sentence cut off mid-word, before the server's citation check had run.
 * - Regular ticks write only the contiguous run of ready segments from the
 *   start. Rows come back in insertion order, so writing a later segment
 *   before a slow earlier one (a long merge, a retry) scrambled the saved
 *   transcript — and a failed one used to surface at the very END.
 * - A forced flush (Stop) persists everything left, unfinished translations
 *   blank — better the Arabic source than losing the closing du'a because its
 *   translation hadn't landed yet. The record page patches late arrivals in.
 */
export function takeFlushableSegments(input: FlushInput): StoredSegment[] {
  const {
    segments,
    flushed,
    filteredIds,
    completedIds,
    errorIds,
    sameLanguage,
    force,
  } = input;
  const ready: LiveSegment[] = [];
  for (const seg of segments) {
    if (!seg.isFinal || flushed.has(seg.id)) continue;
    if (filteredIds.has(seg.id)) {
      flushed.add(seg.id); // don't reconsider it on every tick
      continue;
    }
    const isReady =
      force ||
      sameLanguage ||
      completedIds.has(seg.id) ||
      errorIds.has(seg.id);
    if (!isReady) break; // keep saved order = spoken order
    ready.push(seg);
  }

  for (const seg of ready) flushed.add(seg.id);
  return ready.map((seg) => {
    const merge = input.merges[seg.id];
    return {
      id: seg.id,
      sourceText: seg.text,
      translatedText: sameLanguage
        ? seg.text
        : completedIds.has(seg.id)
          ? (input.translations[seg.id] ?? "")
          : "",
      timestamp: seg.timestamp,
      // Include verse/hadith merge metadata on first flush when the
      // translator returned a merge before the flush tick fires.
      ...(merge
        ? {
            mergedFromIds: merge.fromIds,
            combinedSourceText: merge.combinedSourceText,
            combinedTranslatedText: merge.combinedTranslatedText,
          }
        : {}),
    };
  });
}

/**
 * The on-screen interim at Stop, rescued as a source-only segment — if Stop is
 * tapped mid-utterance (often the closing du'a) it would otherwise be lost.
 * Kept only if it's real source speech: ≥2 words and passes the off-language
 * script gate.
 */
export function stopTailSegment(
  interimText: string,
  sourceLanguage: string,
  timestamp: number,
  makeId: () => string,
): StoredSegment | null {
  const tail = interimText.trim();
  if (!tail) return null;
  if (tail.split(/\s+/).filter(Boolean).length < 2) return null;
  if (isOffLanguageScript(tail, sourceLanguage)) return null;
  return { id: makeId(), sourceText: tail, translatedText: "", timestamp };
}

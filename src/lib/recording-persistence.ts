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
 * - Regular ticks wait for the FINAL enriched translation (completedIds), not
 *   a partial streamed delta.
 * - A forced flush (Stop) persists in-flight finals with a blank translation —
 *   better the Arabic source than losing the closing du'a because its
 *   translation hadn't landed yet.
 */
export function takeFlushableSegments(input: FlushInput): StoredSegment[] {
  const { segments, flushed, filteredIds, completedIds, sameLanguage, force } =
    input;
  const ready = segments.filter((seg) => {
    if (!seg.isFinal || flushed.has(seg.id)) return false;
    if (filteredIds.has(seg.id)) {
      flushed.add(seg.id); // don't reconsider it on every tick
      return false;
    }
    if (sameLanguage) return true;
    if (completedIds.has(seg.id)) return true;
    return force;
  });

  for (const seg of ready) flushed.add(seg.id);
  return ready.map((seg) => {
    const merge = input.merges[seg.id];
    return {
      id: seg.id,
      sourceText: seg.text,
      translatedText: sameLanguage
        ? seg.text
        : (input.translations[seg.id] ?? ""),
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

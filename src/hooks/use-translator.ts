"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import type { LiveSegment } from "@/types";
import { translateSegment, type MergeRecord } from "@/lib/translate-client";

export type { MergeRecord };

export interface UseTranslatorOptions {
  segments: LiveSegment[];
  sourceLanguage: string;
  targetLanguage: string;
}

export interface UseTranslatorReturn {
  /** Map from segment id → translated text (current segment's own translation). */
  translations: Record<string, string>;
  /** Set of segment ids currently in-flight. */
  pending: Set<string>;
  /** Map from segment id → error message, if translation failed for that segment. */
  errors: Record<string, string>;
  /** Parent segment id → merge record (combined source/translation + absorbed children). */
  merges: Record<string, MergeRecord>;
  /** Segment ids that were merged INTO another segment — hide these from rendering. */
  suppressedIds: Set<string>;
  /**
   * Segment ids the server filtered as noise (too short, off-language).
   * These segments don't render at all and are skipped on persistence.
   */
  filteredIds: Set<string>;
  /**
   * Segment ids whose FINAL (enriched) translation has landed. Distinct from
   * `translations[id]` being defined, which is now true mid-stream on the first
   * partial delta. Persistence keys on this so partials are never saved.
   */
  completedIds: Set<string>;
  reset: () => void;
  /** Clear a segment's error so the effect re-attempts its translation. */
  retry: (id: string) => void;
}

/**
 * Translates each finalized segment exactly once.
 *
 * - Interim results are never translated (they change constantly; wasted API calls).
 * - In-flight requests are tracked per-segment so React StrictMode dev double-mount
 *   or rapid segment arrival can't fire duplicate requests for the same id.
 * - When source === target, segments pass through verbatim without an API call.
 * - When the server returns a `merge` directive (recognized Quran verse /
 *   hadith continuation), the absorbed children become "suppressed" and the
 *   current segment carries a combined source/translation for the renderer.
 */
export function useTranslator({
  segments,
  sourceLanguage,
  targetLanguage,
}: UseTranslatorOptions): UseTranslatorReturn {
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [merges, setMerges] = useState<Record<string, MergeRecord>>({});
  const [filteredIds, setFilteredIds] = useState<Set<string>>(new Set());
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  // Render-safe snapshot of inFlightRef (the ref is the synchronous dedupe
  // guard; reading it during render is not allowed).
  const [pending, setPending] = useState<Set<string>>(new Set());
  const syncPending = () => setPending(new Set(inFlightRef.current));
  // Convex Auth token — attached as Bearer to /api/translate so the route
  // can authorize the call and rate-limit the user. Auth is validated
  // server-side; we never trust the client to declare its own user.
  const authToken = useAuthToken();

  const reset = () => {
    setTranslations({});
    setErrors({});
    setMerges({});
    setFilteredIds(new Set());
    setCompletedIds(new Set());
    inFlightRef.current = new Set();
    syncPending();
  };

  // Clear a segment's recorded error so the translate effect picks it up again
  // (the effect skips ids that already have an error). Drives the "tap to
  // retry" affordance on a failed translation card.
  const retry = useCallback((id: string) => {
    setErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    if (sourceLanguage === targetLanguage) {
      // Identity case: mirror source text into translations so the UI still
      // renders the green card without going through the translator API.
      setTranslations((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const seg of segments) {
          if (seg.isFinal && next[seg.id] === undefined) {
            next[seg.id] = seg.text;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setCompletedIds((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const seg of segments) {
          if (seg.isFinal && !next.has(seg.id)) {
            next.add(seg.id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      return;
    }

    const toTranslate = segments.filter(
      (s) =>
        s.isFinal &&
        translations[s.id] === undefined &&
        !inFlightRef.current.has(s.id) &&
        !errors[s.id] &&
        !filteredIds.has(s.id)
    );
    if (toTranslate.length === 0) return;

    for (const seg of toTranslate) {
      inFlightRef.current.add(seg.id);
      syncPending();

      // Build disambiguation context: up to 6 most-recent FINAL segments
      // strictly preceding this one (wider than the old 3 so a hadith or verse
      // spanning several segments is fully visible as a consecutive run the
      // model can collapse into ONE merge). Each entry carries the segment's
      // stable id so the server can name them in a `<<<MERGE>>>` directive.
      const segIndex = segments.indexOf(seg);
      const priorFinals = segments
        .slice(0, segIndex)
        .filter((s) => s.isFinal)
        .slice(-6);
      const requestContext = priorFinals.map((s) => ({
        id: s.id,
        sourceText: s.text,
        translatedText: translations[s.id],
      }));

      void (async () => {
        // Drop a segment's partial/streamed text on failure so the existing
        // retry(id) affordance (which clears errors[id]) lets the effect re-run
        // — its `translations[id] === undefined` guard re-includes the segment.
        const clearPartial = () =>
          setTranslations((prev) => {
            if (prev[seg.id] === undefined) return prev;
            const next = { ...prev };
            delete next[seg.id];
            return next;
          });
        const markCompleted = () =>
          setCompletedIds((prev) => {
            if (prev.has(seg.id)) return prev;
            const next = new Set(prev);
            next.add(seg.id);
            return next;
          });
        const setError = (message: string) =>
          setErrors((prev) => ({ ...prev, [seg.id]: message }));

        try {
          // Retry policy, stream/trailer parsing and the meta-commentary guard
          // live in the shared client so the native app can't drift from them.
          const outcome = await translateSegment(
            {
              text: seg.text,
              source: sourceLanguage,
              target: targetLanguage,
              context: requestContext,
            },
            {
              url: "/api/translate",
              authToken,
              onPartial: (shown) =>
                setTranslations((prev) =>
                  prev[seg.id] === shown ? prev : { ...prev, [seg.id]: shown }
                ),
            }
          );
          switch (outcome.kind) {
            case "error":
              clearPartial();
              setError(outcome.message);
              break;
            case "filtered":
              setFilteredIds((prev) => {
                if (prev.has(seg.id)) return prev;
                const next = new Set(prev);
                next.add(seg.id);
                return next;
              });
              markCompleted();
              break;
            case "blank":
              // FAIL-OPEN: keep the segment with a blank translation so its
              // source card persists to the live view and the saved session.
              setTranslations((prev) =>
                prev[seg.id] === "" ? prev : { ...prev, [seg.id]: "" }
              );
              markCompleted();
              break;
            case "ok": {
              const { translatedText, merge } = outcome;
              setTranslations((prev) => ({ ...prev, [seg.id]: translatedText }));
              if (merge) setMerges((prev) => ({ ...prev, [seg.id]: merge }));
              markCompleted();
              break;
            }
          }
        } catch (e) {
          clearPartial();
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          inFlightRef.current.delete(seg.id);
          syncPending();
        }
      })();
    }
  }, [
    segments,
    sourceLanguage,
    targetLanguage,
    translations,
    errors,
    filteredIds,
    authToken,
  ]);

  // Derive the suppressed set from the merge records. Cheap; recomputes
  // only when `merges` changes.
  const suppressedIds = useMemo(() => {
    const s = new Set<string>();
    for (const record of Object.values(merges)) {
      for (const id of record.fromIds) s.add(id);
    }
    return s;
  }, [merges]);

  return {
    translations,
    pending,
    errors,
    merges,
    suppressedIds,
    filteredIds,
    completedIds,
    reset,
    retry,
  };
}

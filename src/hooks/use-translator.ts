"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import type { LiveSegment } from "@/types";

export interface UseTranslatorOptions {
  segments: LiveSegment[];
  sourceLanguage: string;
  targetLanguage: string;
}

export interface MergeRecord {
  /** IDs of prior segments absorbed into this one (children — hide them). */
  fromIds: string[];
  /** Combined source-language text covering children + parent. */
  combinedSourceText: string;
  /** Combined translation with citation. */
  combinedTranslatedText: string;
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
  reset: () => void;
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
  const inFlightRef = useRef<Set<string>>(new Set());
  const [, forcePendingRender] = useState(0);
  // Convex Auth token — attached as Bearer to /api/translate so the route
  // can authorize the call and rate-limit the user. Auth is validated
  // server-side; we never trust the client to declare its own user.
  const authToken = useAuthToken();

  const reset = () => {
    setTranslations({});
    setErrors({});
    setMerges({});
    inFlightRef.current = new Set();
    forcePendingRender((n) => n + 1);
  };

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
      return;
    }

    const toTranslate = segments.filter(
      (s) =>
        s.isFinal &&
        translations[s.id] === undefined &&
        !inFlightRef.current.has(s.id) &&
        !errors[s.id]
    );
    if (toTranslate.length === 0) return;

    let cancelled = false;

    for (const seg of toTranslate) {
      inFlightRef.current.add(seg.id);
      forcePendingRender((n) => n + 1);

      // Build disambiguation context: up to 3 most-recent FINAL segments
      // strictly preceding this one. Each entry carries the segment's stable
      // id so the server can refer to specific segments in a merge directive
      // (verse/hadith continuation detection).
      const segIndex = segments.indexOf(seg);
      const priorFinals = segments
        .slice(0, segIndex)
        .filter((s) => s.isFinal)
        .slice(-3);
      const requestContext = priorFinals.map((s) => ({
        id: s.id,
        sourceText: s.text,
        translatedText: translations[s.id],
      }));

      void (async () => {
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
          const res = await fetch("/api/translate", {
            method: "POST",
            headers,
            body: JSON.stringify({
              text: seg.text,
              source: sourceLanguage,
              target: targetLanguage,
              context: requestContext.length > 0 ? requestContext : undefined,
            }),
          });
          if (cancelled) return;
          const data = (await res.json().catch(() => ({}))) as {
            translatedText?: string;
            merge?: MergeRecord;
            error?: string;
          };
          if (!res.ok || !data.translatedText) {
            const msg = data.error ?? `Translation failed (${res.status})`;
            setErrors((prev) => ({ ...prev, [seg.id]: msg }));
          } else {
            setTranslations((prev) => ({
              ...prev,
              [seg.id]: data.translatedText!,
            }));
            if (data.merge && data.merge.fromIds.length > 0) {
              setMerges((prev) => ({
                ...prev,
                [seg.id]: data.merge!,
              }));
            }
          }
        } catch (e) {
          if (cancelled) return;
          setErrors((prev) => ({
            ...prev,
            [seg.id]: e instanceof Error ? e.message : String(e),
          }));
        } finally {
          inFlightRef.current.delete(seg.id);
          if (!cancelled) forcePendingRender((n) => n + 1);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [segments, sourceLanguage, targetLanguage, translations, errors, authToken]);

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
    pending: inFlightRef.current,
    errors,
    merges,
    suppressedIds,
    reset,
  };
}

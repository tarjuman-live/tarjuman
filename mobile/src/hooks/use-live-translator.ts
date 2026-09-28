import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetch as expoFetch } from "expo/fetch";
import { useAuthToken } from "@convex-dev/auth/react";
import { translateSegment, type MergeRecord } from "@shared/translate-client";
import type { LiveSegment } from "@shared-types";
import { apiUrl } from "~/lib/config";

/**
 * Native twin of the web's use-translator.ts: each FINAL segment is translated
 * exactly once through the shared client (same retry policy, stream/trailer
 * parsing and meta-commentary guard). expo/fetch gives a real streaming body,
 * so the translation paints progressively like on web.
 */
export function useLiveTranslator({
  segments,
  sourceLanguage,
  targetLanguage,
}: {
  segments: LiveSegment[];
  sourceLanguage: string;
  targetLanguage: string;
}) {
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [merges, setMerges] = useState<Record<string, MergeRecord>>({});
  const [filteredIds, setFilteredIds] = useState<Set<string>>(new Set());
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const startedRef = useRef<Set<string>>(new Set());
  // Bumped by retry() so the effect revisits a segment it already started.
  const [retryTick, setRetryTick] = useState(0);
  const authToken = useAuthToken();
  const same = sourceLanguage === targetLanguage;

  const addTo = (setter: typeof setCompletedIds, id: string) =>
    setter((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  useEffect(() => {
    for (const seg of segments) {
      if (!seg.isFinal || startedRef.current.has(seg.id)) continue;
      startedRef.current.add(seg.id);

      if (same) {
        setTranslations((p) => ({ ...p, [seg.id]: seg.text }));
        addTo(setCompletedIds, seg.id);
        continue;
      }

      // Up to 6 prior finals as disambiguation context (ids let the server
      // name them in a verse/hadith merge directive).
      const idx = segments.indexOf(seg);
      const context = segments
        .slice(0, idx)
        .filter((s) => s.isFinal)
        .slice(-6)
        .map((s) => ({ id: s.id, sourceText: s.text, translatedText: translations[s.id] }));

      void translateSegment(
        { text: seg.text, source: sourceLanguage, target: targetLanguage, context },
        {
          url: apiUrl("/api/translate"),
          authToken,
          fetchImpl: expoFetch as unknown as typeof fetch,
          onPartial: (shown) =>
            setTranslations((p) => (p[seg.id] === shown ? p : { ...p, [seg.id]: shown })),
        },
      ).then((out) => {
        switch (out.kind) {
          case "error":
            setTranslations((p) => {
              const n = { ...p };
              delete n[seg.id];
              return n;
            });
            setErrors((p) => ({ ...p, [seg.id]: out.message }));
            break;
          case "filtered":
            addTo(setFilteredIds, seg.id);
            addTo(setCompletedIds, seg.id);
            break;
          case "blank":
            // Fail-open: the source card stays, translation blank.
            setTranslations((p) => ({ ...p, [seg.id]: "" }));
            addTo(setCompletedIds, seg.id);
            break;
          case "ok":
            setTranslations((p) => ({ ...p, [seg.id]: out.translatedText }));
            if (out.merge) {
              const merge = out.merge;
              setMerges((p) => ({ ...p, [seg.id]: merge }));
            }
            addTo(setCompletedIds, seg.id);
            break;
        }
      });
    }
    // translations is read for context only; re-running on it would be a no-op
    // thanks to startedRef, so it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, sourceLanguage, targetLanguage, same, authToken, retryTick]);

  const retry = useCallback((id: string) => {
    startedRef.current.delete(id);
    setErrors((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
    setRetryTick((t) => t + 1);
  }, []);

  const reset = useCallback(() => {
    startedRef.current = new Set();
    setTranslations({});
    setErrors({});
    setMerges({});
    setFilteredIds(new Set());
    setCompletedIds(new Set());
  }, []);

  const suppressedIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of Object.values(merges)) for (const id of m.fromIds) s.add(id);
    return s;
  }, [merges]);

  return { translations, errors, merges, filteredIds, completedIds, suppressedIds, retry, reset };
}

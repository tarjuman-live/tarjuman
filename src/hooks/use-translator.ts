"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import type { LiveSegment } from "@/types";

// Matches the sentinel in src/app/api/translate/route.ts — separates the
// streamed plain-translation deltas from the final metadata JSON trailer.
const META_SENTINEL = "\n␞__TARJUMAN_META__␞\n";

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
  const [, forcePendingRender] = useState(0);
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
    forcePendingRender((n) => n + 1);
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
      forcePendingRender((n) => n + 1);

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
        // Finalize from the metadata trailer (streamed) or the small JSON body
        // (source===target passthrough) — identical handling for both shapes.
        const applyResult = (data: {
          translatedText?: string;
          merge?: MergeRecord;
          filtered?: boolean;
          error?: string;
        }) => {
          if (data.error) {
            clearPartial();
            setErrors((prev) => ({ ...prev, [seg.id]: data.error! }));
            return;
          }
          if (data.filtered) {
            setFilteredIds((prev) => {
              if (prev.has(seg.id)) return prev;
              const next = new Set(prev);
              next.add(seg.id);
              return next;
            });
            markCompleted();
            return;
          }
          if (!data.translatedText) {
            clearPartial();
            setErrors((prev) => ({
              ...prev,
              [seg.id]: "Translator returned no text",
            }));
            return;
          }
          setTranslations((prev) => ({ ...prev, [seg.id]: data.translatedText! }));
          if (data.merge && data.merge.fromIds.length > 0) {
            setMerges((prev) => ({ ...prev, [seg.id]: data.merge! }));
          }
          markCompleted();
        };

        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

          const TRANSLATE_ATTEMPTS = 3;
          const body = JSON.stringify({
            text: seg.text,
            source: sourceLanguage,
            target: targetLanguage,
            context: requestContext.length > 0 ? requestContext : undefined,
          });

          // The retry loop wraps only the HANDSHAKE — a transient 5xx/429/
          // network failure before the stream opens retries with backoff. Once
          // a 200 stream is open, a failure is terminal-for-segment (tap to
          // retry). A 4xx (e.g. 401 auth) fails fast.
          for (let attempt = 1; attempt <= TRANSLATE_ATTEMPTS; attempt++) {
            let r: Response;
            try {
              r = await fetch("/api/translate", { method: "POST", headers, body });
            } catch (netErr) {
              if (attempt === TRANSLATE_ATTEMPTS) throw netErr;
              await new Promise((rs) => setTimeout(rs, 400 * attempt));
              continue;
            }

            if (!r.ok) {
              if (
                (r.status >= 500 || r.status === 429) &&
                attempt < TRANSLATE_ATTEMPTS
              ) {
                await new Promise((rs) => setTimeout(rs, 400 * attempt));
                continue;
              }
              const d = (await r.json().catch(() => ({}))) as { error?: string };
              setErrors((prev) => ({
                ...prev,
                [seg.id]: d.error ?? `Translation failed (${r.status})`,
              }));
              break;
            }

            // Read the body and decide the shape by CONTENT, NOT the
            // Content-Type header. Next 16 behind the custom server can drop or
            // rewrite Content-Type on a streamed Response, which previously sent
            // a streamed (text/plain) body down the JSON branch → JSON.parse of
            // prose threw → silent `{}` → "Translator returned no text" on every
            // segment. The durable contract is the in-band META_SENTINEL:
            //   - body contains META_SENTINEL → streamed translation + trailer
            //   - no sentinel → a small JSON body (source===target passthrough,
            //     or a noise-filter result)
            if (!r.body) {
              const d = (await r.json().catch(() => null)) as
                | Parameters<typeof applyResult>[0]
                | null;
              if (!d) {
                clearPartial();
                setErrors((prev) => ({
                  ...prev,
                  [seg.id]: "Malformed translation response",
                }));
                break;
              }
              applyResult(d);
              break;
            }

            const reader = r.body.getReader();
            const decoder = new TextDecoder();
            let acc = "";
            let sentinelAt = -1;
            let looksLikeJson = false;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                acc += decoder.decode(value, { stream: true });
                if (sentinelAt === -1) sentinelAt = acc.indexOf(META_SENTINEL);
                // Progressive display only for the streamed prose shape — never
                // render a JSON body (passthrough/filtered) as the translation.
                if (sentinelAt !== -1) {
                  const visible = acc.slice(0, sentinelAt);
                  setTranslations((prev) =>
                    prev[seg.id] === visible ? prev : { ...prev, [seg.id]: visible }
                  );
                } else if (!looksLikeJson && acc.trimStart().startsWith("{")) {
                  looksLikeJson = true; // JSON body — wait for it whole, don't show
                } else if (!looksLikeJson) {
                  // Hold back the last META_SENTINEL.length chars: if the
                  // sentinel straddles a chunk boundary, indexOf can't match it
                  // until the next read, and showing `acc` raw would flash the
                  // sentinel's prefix on screen for a frame. The final value is
                  // set by applyResult after the loop regardless.
                  const safeEnd = acc.length - META_SENTINEL.length;
                  if (safeEnd > 0) {
                    const visible = acc.slice(0, safeEnd);
                    setTranslations((prev) =>
                      prev[seg.id] === visible
                        ? prev
                        : { ...prev, [seg.id]: visible }
                    );
                  }
                }
              }
            } catch {
              clearPartial();
              setErrors((prev) => ({
                ...prev,
                [seg.id]: "Translation stream interrupted",
              }));
              break;
            }

            const idx = acc.indexOf(META_SENTINEL);
            if (idx !== -1) {
              // Streamed shape: parse the metadata trailer.
              let meta: Parameters<typeof applyResult>[0];
              try {
                meta = JSON.parse(acc.slice(idx + META_SENTINEL.length));
              } catch {
                clearPartial();
                setErrors((prev) => ({
                  ...prev,
                  [seg.id]: "Malformed translation trailer",
                }));
                break;
              }
              applyResult(meta);
            } else {
              // No sentinel → a plain JSON body. Parse it; an empty/garbled body
              // is an explicit error, never a silent {} that reads as "no text".
              let d: Parameters<typeof applyResult>[0];
              try {
                d = JSON.parse(acc);
              } catch {
                clearPartial();
                setErrors((prev) => ({
                  ...prev,
                  [seg.id]: "Malformed translation response",
                }));
                break;
              }
              applyResult(d);
            }
            break;
          }
        } catch (e) {
          clearPartial();
          setErrors((prev) => ({
            ...prev,
            [seg.id]: e instanceof Error ? e.message : String(e),
          }));
        } finally {
          inFlightRef.current.delete(seg.id);
          forcePendingRender((n) => n + 1);
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
    pending: inFlightRef.current,
    errors,
    merges,
    suppressedIds,
    filteredIds,
    completedIds,
    reset,
    retry,
  };
}

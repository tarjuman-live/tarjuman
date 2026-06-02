"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import type { LiveSegment } from "@/types";
import type { RollingAudioBuffer } from "@/lib/audio-buffer";

export interface UseTranslatorOptions {
  segments: LiveSegment[];
  sourceLanguage: string;
  targetLanguage: string;
  /**
   * Rolling PCM audio buffer mirroring what was sent to Deepgram. When
   * present, each finalized segment is also sent to OpenAI Whisper for a
   * second-opinion transcription; both Arabic versions get passed to
   * Claude which reconciles them before translating. When unset, behaves
   * exactly like the old single-engine path.
   */
  audioBuffer?: RollingAudioBuffer | null;
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
  audioBuffer,
}: UseTranslatorOptions): UseTranslatorReturn {
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [merges, setMerges] = useState<Record<string, MergeRecord>>({});
  const [filteredIds, setFilteredIds] = useState<Set<string>>(new Set());
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
        !errors[s.id] &&
        !filteredIds.has(s.id)
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

          // Parallel-engine pass: also ask OpenAI Whisper to transcribe the
          // same audio window. Claude will reconcile both Arabic versions
          // before translating. Silent fallback: if anything fails (no
          // audio buffer, slice out of range, 503 because OPENAI_API_KEY
          // isn't set, Whisper error, timeout) we just send Deepgram alone.
          const alternativeText = await tryWhisperAlternative({
            seg,
            audioBuffer,
            sourceLanguage,
            authToken,
          });
          if (cancelled) return;

          const res = await fetch("/api/translate", {
            method: "POST",
            headers,
            body: JSON.stringify({
              text: seg.text,
              source: sourceLanguage,
              target: targetLanguage,
              context: requestContext.length > 0 ? requestContext : undefined,
              alternativeText,
            }),
          });
          if (cancelled) return;
          const data = (await res.json().catch(() => ({}))) as {
            translatedText?: string;
            merge?: MergeRecord;
            filtered?: boolean;
            error?: string;
          };
          if (!res.ok) {
            const msg = data.error ?? `Translation failed (${res.status})`;
            setErrors((prev) => ({ ...prev, [seg.id]: msg }));
          } else if (data.filtered) {
            // Server filtered as noise (too short / off-language) — suppress
            // the whole segment from the transcript without rendering an error.
            setFilteredIds((prev) => {
              if (prev.has(seg.id)) return prev;
              const next = new Set(prev);
              next.add(seg.id);
              return next;
            });
          } else if (!data.translatedText) {
            const msg = data.error ?? "Translator returned no text";
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
    reset,
  };
}

/**
 * Fire-and-forget Whisper transcription of the segment's audio window.
 * Returns the Whisper Arabic text on success, or undefined on any failure
 * (no audio buffer, slice out of range, 503, network, timeout). Failure
 * never blocks the primary Deepgram → Claude path.
 *
 * We pad the slice by 200ms on each side to catch leading/trailing words
 * Deepgram's endpointing might have cut off.
 */
async function tryWhisperAlternative(opts: {
  seg: LiveSegment;
  audioBuffer?: RollingAudioBuffer | null;
  sourceLanguage: string;
  authToken: string | null | undefined;
}): Promise<string | undefined> {
  const { seg, audioBuffer, sourceLanguage, authToken } = opts;
  if (!audioBuffer) return undefined;
  const start = Math.max(0, seg.timestamp - 0.2);
  const end = seg.timestamp + (seg.durationSec ?? 5) + 0.2;
  // Skip very short segments — Whisper struggles with sub-second clips
  // and they're usually noise filtered upstream anyway.
  if (end - start < 0.5) return undefined;

  let blob: Blob | null;
  try {
    blob = audioBuffer.sliceWav(start, end);
  } catch {
    return undefined;
  }
  if (!blob) return undefined;

  try {
    const form = new FormData();
    form.append("file", blob, "segment.wav");
    if (/^[a-z]{2}$/.test(sourceLanguage))
      form.append("language", sourceLanguage);
    const headers: Record<string, string> = {};
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers,
      body: form,
    });
    if (!res.ok) return undefined;
    const data = (await res.json().catch(() => ({}))) as { text?: string };
    const text = (data.text ?? "").trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

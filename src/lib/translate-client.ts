/**
 * Client for POST /api/translate — framework-free, shared by the web
 * translator hook and the native app.
 *
 * Owns every client-side rule of the translation contract so the two
 * platforms can't drift: handshake retry policy, the streamed body +
 * META_SENTINEL trailer, the JSON-body fallback, and the last-line
 * meta-commentary guard (see @/lib/translation-guard and the
 * no-model-commentary rule — never weaken it).
 */

import { looksLikeMetaCommentary } from "./translation-guard";

// Matches the sentinel in src/app/api/translate/route.ts — separates the
// streamed plain-translation deltas from the final metadata JSON trailer.
export const META_SENTINEL = "\n␞__TARJUMAN_META__␞\n";

export interface MergeRecord {
  /** IDs of prior segments absorbed into this one (children — hide them). */
  fromIds: string[];
  /** Combined source-language text covering children + parent. */
  combinedSourceText: string;
  /** Combined translation with citation. */
  combinedTranslatedText: string;
}

export interface TranslateRequest {
  text: string;
  source: string;
  target: string;
  context?: { id: string; sourceText: string; translatedText?: string }[];
}

export type TranslateOutcome =
  | { kind: "ok"; translatedText: string; merge?: MergeRecord }
  /** Server judged the segment noise — never render or persist it. */
  | { kind: "filtered" }
  /**
   * Fail-open: an empty (or meta-commentary) translation. The transcribed
   * source is ground truth and must NEVER be deleted by a translation verdict
   * — keep the segment with a blank translation.
   */
  | { kind: "blank" }
  | { kind: "error"; message: string };

interface TranslateResponseData {
  translatedText?: string;
  merge?: MergeRecord;
  filtered?: boolean;
  error?: string;
}

export interface TranslateOptions {
  /** Absolute on native ("https://tarjuman.live/api/translate"). */
  url: string;
  authToken?: string | null;
  /** Native passes expo/fetch, whose Response.body is a real stream. */
  fetchImpl?: typeof fetch;
  /** Progressive text while the stream is open. Already guard-filtered. */
  onPartial?: (visible: string) => void;
  attempts?: number;
}

function outcomeFrom(data: TranslateResponseData): TranslateOutcome {
  if (data.error) return { kind: "error", message: data.error };
  if (data.filtered) return { kind: "filtered" };
  if (!data.translatedText || looksLikeMetaCommentary(data.translatedText)) {
    return { kind: "blank" };
  }
  return data.merge && data.merge.fromIds.length > 0
    ? { kind: "ok", translatedText: data.translatedText, merge: data.merge }
    : { kind: "ok", translatedText: data.translatedText };
}

const sleep = (ms: number) => new Promise((rs) => setTimeout(rs, ms));

export async function translateSegment(
  req: TranslateRequest,
  opts: TranslateOptions,
): Promise<TranslateOutcome> {
  const { url, authToken, fetchImpl = fetch, onPartial, attempts = 3 } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const body = JSON.stringify({
    text: req.text,
    source: req.source,
    target: req.target,
    context: req.context && req.context.length > 0 ? req.context : undefined,
  });

  // The retry loop wraps only the HANDSHAKE — a transient 5xx/429/network
  // failure before the stream opens retries with backoff. Once a 200 stream is
  // open, a failure is terminal-for-segment (tap to retry). A 4xx fails fast.
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let r: Response;
    try {
      r = await fetchImpl(url, { method: "POST", headers, body });
    } catch (netErr) {
      if (attempt === attempts) {
        return {
          kind: "error",
          message: netErr instanceof Error ? netErr.message : String(netErr),
        };
      }
      await sleep(400 * attempt);
      continue;
    }

    if (!r.ok) {
      // Retry transient handshake failures (429/500/502/503), but NOT 504:
      // the server already fails fast on a 15s upstream timeout, so retrying
      // it 3× would stall the segment at "translating…" for ~45s.
      if (
        (r.status === 429 || (r.status >= 500 && r.status !== 504)) &&
        attempt < attempts
      ) {
        await sleep(400 * attempt);
        continue;
      }
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      return {
        kind: "error",
        message: d.error ?? `Translation failed (${r.status})`,
      };
    }

    // Decide the shape by CONTENT, not Content-Type (Next behind the custom
    // server can rewrite it on a streamed Response). The durable contract is
    // the in-band META_SENTINEL:
    //   - body contains META_SENTINEL → streamed translation + trailer
    //   - no sentinel → a small JSON body (passthrough or noise-filter result)
    let acc = "";
    const reader = r.body?.getReader?.();
    if (!reader) {
      // No streaming body available (plain RN fetch) — read it whole.
      acc = await r.text();
    } else {
      const decoder = new TextDecoder();
      let sentinelAt = -1;
      let looksLikeJson = false;
      const show = (visible: string) =>
        onPartial?.(looksLikeMetaCommentary(visible) ? "" : visible);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          if (sentinelAt === -1) sentinelAt = acc.indexOf(META_SENTINEL);
          // Progressive display only for the streamed prose shape — never
          // render a JSON body (passthrough/filtered) as the translation.
          if (sentinelAt !== -1) {
            show(acc.slice(0, sentinelAt));
          } else if (!looksLikeJson && acc.trimStart().startsWith("{")) {
            looksLikeJson = true;
          } else if (!looksLikeJson) {
            // Hold back the sentinel's length: if it straddles a chunk
            // boundary, showing `acc` raw would flash its prefix on screen.
            const safeEnd = acc.length - META_SENTINEL.length;
            if (safeEnd > 0) show(acc.slice(0, safeEnd));
          }
        }
      } catch {
        return { kind: "error", message: "Translation stream interrupted" };
      }
    }

    const idx = acc.indexOf(META_SENTINEL);
    try {
      return outcomeFrom(
        JSON.parse(idx !== -1 ? acc.slice(idx + META_SENTINEL.length) : acc),
      );
    } catch {
      return {
        kind: "error",
        message:
          idx !== -1
            ? "Malformed translation trailer"
            : "Malformed translation response",
      };
    }
  }
  return { kind: "error", message: "Translation failed" };
}

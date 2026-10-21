import { NextRequest, NextResponse } from "next/server";
import {
  SYSTEM_PROMPT,
  MERGE_MARKER,
  META_SENTINEL,
  routeModel,
  buildUserMessage,
  parseMergeDirective,
  shouldFilterAsNoise,
} from "@/lib/translate-prompt";
import { requireAuthFromHeader, checkRateLimit } from "@/lib/api-auth";
import { verifyAndEnrich } from "@/lib/sunnah";
import { verifyAndEnrichQuran } from "@/lib/quran";
import { looksLikeMetaCommentary } from "@/lib/translation-guard";
import { trackAnthropicCall, upstreamErrorMessage } from "@/lib/usage/ingest";

interface TranslateRequest {
  text: string;
  source?: string;
  target: string;
  /**
   * Recent prior segments (sourceText + optional translatedText) sent for
   * disambiguation only. The model is instructed never to translate or
   * include these in its output — they exist solely so a short ambiguous
   * `text` is interpreted in the surrounding flow rather than in isolation.
   *
   * Each entry carries the segment's stable `id` so the model can refer
   * to specific prior segments in a verse/hadith merge directive (see the
   * `<<<MERGE>>>` protocol below).
   */
  context?: { id: string; sourceText: string; translatedText?: string }[];
}

const LANGUAGE_NAMES: Record<string, string> = {
  // Tier 1
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  ru: "Russian",
  hi: "Hindi",
  ja: "Japanese",
  // Tier 2
  ar: "Arabic",
  ko: "Korean",
  zh: "Chinese",
  vi: "Vietnamese",
  id: "Indonesian",
  ms: "Malay",
  tr: "Turkish",
  pl: "Polish",
  cs: "Czech",
  hu: "Hungarian",
  no: "Norwegian",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  el: "Greek",
  he: "Hebrew",
  ro: "Romanian",
  ca: "Catalan",
  uk: "Ukrainian",
};

function languageName(code: string | undefined): string {
  if (!code) return "the source language";
  return LANGUAGE_NAMES[code] ?? code;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server" },
      { status: 500 },
    );
  }

  // 1. Authenticate. Without this, anyone who finds the route URL can
  //    drain the Anthropic budget — see /Users/ard/.claude/plans/...
  const auth = await requireAuthFromHeader(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Sign in to use translation." },
      { status: 401 },
    );
  }

  // 2. Per-user rate limit (60/min token bucket).
  const limit = checkRateLimit(auth.userId, "translate");
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Translation rate limit hit. Try again in ${limit.retryAfterSec}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  let body: TranslateRequest;
  try {
    body = (await req.json()) as TranslateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { text, source, target, context } = body;
  if (!text || typeof text !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid `text`" },
      { status: 400 },
    );
  }
  if (!target || typeof target !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid `target` language code" },
      { status: 400 },
    );
  }

  // Cap input size. A live segment is normally well under 1KB; an 8KB ceiling
  // is far above any legitimate segment and removes the per-request cost
  // amplification lever (forwarding a huge body of input tokens to Claude on an
  // authenticated loop).
  if (text.length > 8000) {
    return NextResponse.json({ error: "Segment too large" }, { status: 413 });
  }

  // No-op when source === target. Skipping the upstream call avoids both
  // unnecessary cost and unnecessary latency.
  if (source && source === target) {
    return NextResponse.json({ translatedText: text });
  }

  // Noise filter: drop single-word and off-language-script segments BEFORE
  // hitting the LLM. Saves cost + latency, and the client uses the
  // `filtered: true` flag to suppress the segment from the transcript
  // entirely (neither source card nor translation card renders).
  const noise = shouldFilterAsNoise(text, source);
  if (noise.filter) {
    return NextResponse.json({
      translatedText: "",
      filtered: true,
      filterReason: noise.reason,
    });
  }

  const sourceName = languageName(source);
  const targetName = languageName(target);

  // Every segment runs on Haiku — the Sonnet escalation was measured to buy
  // nothing (see the routing block in src/lib/translate-prompt.ts).
  const model = routeModel(text, context);
  // 1500 for every request, NOT the old 500-for-Haiku. Merges used to be
  // Sonnet's job and rode Sonnet's larger cap; Haiku now emits them, and a
  // <<<MERGE>>> carries the plain translation PLUS a JSON trailer holding both
  // the full combined source (Arabic, which tokenizes poorly) and its full
  // translation, up to the prompt's ~1200-character cap. That overruns 500
  // tokens on a long hadith, and truncation is silent: the JSON arrives
  // unparseable, parseMergeDirective swallows it, and the merge just never
  // happens. max_tokens is a ceiling, not a reservation, so raising it costs
  // nothing on the ~99% of segments that are ordinary prose.
  const maxTokens = 1500;

  // Usage/cost report for the admin dashboard (sent after the response; never
  // blocks or throws). Every exit below this point settles it.
  const usage = trackAnthropicCall({
    kind: "translate",
    model,
    userId: auth.userId,
    // 2 × 15s attempts + citation enrichment headroom.
    timeoutMs: 45_000,
  });

  const requestBody = JSON.stringify({
    model,
    max_tokens: maxTokens,
    stream: true,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: buildUserMessage({
          text,
          sourceName,
          targetName,
          context,
        }),
      },
    ],
  });

  // Translation is the product, so a transient upstream blip (429 rate limit,
  // 529 overloaded, 5xx, or a brief network error) must not error the segment.
  // Retry once with a short backoff on those retryable failures.
  //
  // 15s timeout per attempt. Haiku usually responds in 0.3–1.5s; Sonnet ~1–3s.
  // Timeouts/aborts are NOT retried — doubling a 15s wait would stall the live
  // transcript, so those fail fast.
  const MAX_ATTEMPTS = 2;
  const RETRY_BACKOFF_MS = 400;
  let response: Response | null = null;
  let lastTransientDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: requestBody,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      // Rate-limited / overloaded / server error → transient; retry if budget left.
      if ((r.status === 429 || r.status >= 500) && attempt < MAX_ATTEMPTS) {
        lastTransientDetail = `HTTP ${r.status}`;
        await new Promise((res) => setTimeout(res, RETRY_BACKOFF_MS));
        continue;
      }
      response = r;
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/timed out|abort/i.test(msg)) {
        usage.settle({ ok: false, status: 504, error: "upstream timeout" });
        return NextResponse.json(
          { error: "Translation timed out. Try again." },
          { status: 504 },
        );
      }
      // Network-level throw → transient; retry if budget left, else give up.
      lastTransientDetail = msg;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((res) => setTimeout(res, RETRY_BACKOFF_MS));
        continue;
      }
      usage.settle({ ok: false, error: msg });
      return NextResponse.json(
        { error: `Translation failed: ${msg}` },
        { status: 502 },
      );
    }
  }

  if (!response) {
    usage.settle({ ok: false, error: lastTransientDetail || "upstream error" });
    return NextResponse.json(
      {
        error: `Translation failed: ${lastTransientDetail || "upstream error"}`,
      },
      { status: 502 },
    );
  }

  // We requested stream:true, so `response.ok` means the SSE stream is open.
  // Non-ok statuses stay JSON-with-real-HTTP-status (429/5xx already handled in
  // the retry loop above; guard the rest here) so the client's status-based
  // retry keeps working. Only the HTTP-200 success path streams.
  if (!response.ok || !response.body) {
    // Log the upstream body server-side; don't echo provider diagnostics to the
    // client (model ids / account hints / internal phrasing aid reconnaissance).
    const errText = await response.text().catch(() => "");
    console.error(
      `[translate] upstream HTTP ${response.status}: ${errText.slice(0, 300)}`,
    );
    // Includes the "credit balance is too low" 400 — the alert cron keys on it.
    usage.settle({
      ok: false,
      status: response.status,
      error: upstreamErrorMessage(errText),
    });
    return NextResponse.json(
      { error: "Translation temporarily unavailable." },
      { status: 502 },
    );
  }

  // Sanity-check merge ids against what the client actually sent so a
  // hallucinated id can't break the client's segment state.
  const validContextIds = new Set<string>(
    (context ?? []).map((c) => c.id).filter((id): id is string => !!id),
  );

  const upstream = response;
  const reader = upstream.body!.getReader();
  const stream = new ReadableStream<Uint8Array>({
    // The client went away mid-stream: stop reading (and paying for) the
    // upstream response and report what was consumed as a partial call.
    cancel() {
      usage.settle({ partial: true });
      reader.cancel().catch(() => {});
    },
    async start(controller) {
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = ""; // SSE line buffer
      let rawText = ""; // full accumulated model output (incl. any MERGE block)
      let emitted = 0; // chars of pre-MERGE text already streamed to the client
      let mergeSeen = false;
      // Set when Anthropic itself reports an error mid-stream (vs. the client
      // disconnecting), so the usage report can tell the two apart.
      let upstreamStreamError: string | null = null;

      const emitMeta = (meta: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(META_SENTINEL + JSON.stringify(meta)),
        );
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json || json === "[DONE]") continue;
            let evt: {
              type?: string;
              delta?: { type?: string; text?: string };
              error?: { message?: string };
            };
            try {
              evt = JSON.parse(json);
            } catch {
              continue; // ignore malformed SSE line
            }
            usage.observe(evt);
            // Anthropic emits an `error` event mid-stream on upstream trouble.
            if (evt.type === "error") {
              upstreamStreamError = evt.error?.message ?? "stream-error";
              throw new Error(upstreamStreamError);
            }
            if (
              evt.type === "content_block_delta" &&
              evt.delta?.type === "text_delta" &&
              typeof evt.delta.text === "string"
            ) {
              rawText += evt.delta.text;
              if (mergeSeen) continue;
              const markerIdx = rawText.indexOf(MERGE_MARKER);
              if (markerIdx === -1) {
                // Hold back the last MERGE_MARKER.length chars so a marker
                // split across two deltas is never partially shown.
                const safeEnd = Math.max(
                  0,
                  rawText.length - MERGE_MARKER.length,
                );
                if (safeEnd > emitted) {
                  controller.enqueue(
                    encoder.encode(rawText.slice(emitted, safeEnd)),
                  );
                  emitted = safeEnd;
                }
              } else {
                mergeSeen = true;
                if (markerIdx > emitted) {
                  controller.enqueue(
                    encoder.encode(rawText.slice(emitted, markerIdx)),
                  );
                  emitted = markerIdx;
                }
              }
            }
          }
        }

        // Flush any held-back tail of the pre-MERGE text.
        if (!mergeSeen && rawText.length > emitted) {
          controller.enqueue(encoder.encode(rawText.slice(emitted)));
        }

        // Post-process the COMPLETE output exactly as the old non-streaming
        // path did, then deliver it in the metadata trailer.
        const parsed = parseMergeDirective(rawText, validContextIds);
        if (
          !parsed.translation.trim() ||
          looksLikeMetaCommentary(parsed.translation)
        ) {
          // The model returned an empty translation (its "untranslatable /
          // off-language" verdict) — OR it disobeyed the "output nothing"
          // instruction and leaked first-person meta-commentary about the
          // input ("I recognize this as a transliteration artifact…"). Either
          // way it is NOT a translation. FAIL-OPEN: emit an empty translatedText
          // WITHOUT `filtered`, so the client keeps the segment's
          // transcribed source (ground truth) with a blank translation
          // rather than deleting it. The deterministic noise filter
          // (shouldFilterAsNoise above) is the ONLY path that sets filtered=true
          // and removes a segment; a translation-model verdict must never delete
          // valid source speech — off-language gating must fail-open.
          usage.settle();
          emitMeta({ translatedText: "" });
          controller.close();
          return;
        }
        // Citation enrichment: verify hadith (sunnah.com) + Quran (quran.com),
        // swap in canonical bodies + clickable links. Off the perceived path —
        // the plain translation already streamed; this lands in the trailer.
        const hadithEnriched = await verifyAndEnrich(parsed.translation);
        const quranEnriched = await verifyAndEnrichQuran(
          hadithEnriched.text,
          target,
        );
        const enrichedMerge = parsed.merge
          ? await (async () => {
              const h = await verifyAndEnrich(
                parsed.merge!.combinedTranslatedText,
              );
              const q = await verifyAndEnrichQuran(h.text, target);
              return { ...parsed.merge!, combinedTranslatedText: q.text };
            })()
          : undefined;
        usage.settle();
        emitMeta({
          translatedText: quranEnriched.text,
          ...(enrichedMerge ? { merge: enrichedMerge } : {}),
        });
        controller.close();
      } catch {
        usage.settle(
          upstreamStreamError
            ? { ok: false, error: upstreamStreamError }
            : { partial: true },
        );
        // Upstream read failed mid-stream. The HTTP 200 + partial body is
        // already committed, so we can't change status — signal failure in the
        // trailer and let the client treat it as a retryable error.
        try {
          emitMeta({ error: "stream-interrupted" });
          controller.close();
        } catch {
          /* controller already closed/errored */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

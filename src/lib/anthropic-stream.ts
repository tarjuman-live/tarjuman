import { NextResponse } from "next/server";
import type { Id } from "../../convex/_generated/dataModel";
import type { UsageKind } from "../../convex/usageShared";
import { trackAnthropicCall, upstreamErrorMessage } from "@/lib/usage/ingest";
import { fetchAnthropicStream, thinkingOff } from "@/lib/anthropic-fetch";

/**
 * Shared Anthropic streaming helper for the AI API routes (study-notes, ask,
 * translate-transcript). Opens a streaming Messages request, parses Anthropic's
 * SSE, and re-emits just the text deltas as plain UTF-8 the browser reads
 * directly — the same shape /api/summarize uses. Returns either the streaming
 * Response or a JSON error Response (so routes can `return` it as-is).
 *
 * The system prompt is sent with `cache_control: ephemeral` so the shared
 * Islamic-terminology block is cached across a session once it clears the
 * caching threshold.
 */
export async function streamAnthropicText(opts: {
  apiKey: string;
  system: string;
  userMessage: string;
  model?: string;
  maxTokens?: number;
  /**
   * Upper bound on the whole call, for the usage tracker's bookkeeping only.
   * The request itself is bounded by first-byte + idle timeouts, so a long
   * answer that keeps streaming is never cut off at a wall-clock limit.
   */
  timeoutMs?: number;
  /** Label for server-side error logs. */
  logTag: string;
  /** Who/what to attribute this call to in the admin usage log. */
  usage: { kind: UsageKind; userId: Id<"users"> };
}): Promise<Response> {
  const model = opts.model ?? "claude-sonnet-5";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  // Usage/cost report for the admin dashboard (after the response; never
  // blocks or throws). Every exit below settles it.
  const tracker = trackAnthropicCall({
    kind: opts.usage.kind,
    model,
    userId: opts.usage.userId,
    timeoutMs,
  });
  let upstream: Response;
  try {
    upstream = await fetchAnthropicStream("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 4000,
        // Sonnet 5 thinks by default; that thinking would come out of
        // max_tokens and delay the first word. These routes stream prose
        // straight to the user — keep it off.
        ...thinkingOff(model),
        stream: true,
        system: [
          {
            type: "text",
            text: opts.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: opts.userMessage }],
      }),
      cache: "no-store",
    }, { firstByteMs: 30_000, idleMs: 30_000 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tracker.settle({ ok: false, error: msg });
    return NextResponse.json({ error: `AI failed: ${msg}` }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    console.error(
      `[${opts.logTag}] upstream HTTP ${upstream.status}: ${errText.slice(0, 300)}`
    );
    tracker.settle({
      ok: false,
      status: upstream.status,
      error: upstreamErrorMessage(errText),
    });
    return NextResponse.json(
      { error: "AI temporarily unavailable." },
      { status: 502 }
    );
  }

  const reader = upstream.body!.getReader();
  const stream = new ReadableStream({
    // Client went away: stop the upstream read and report a partial call.
    cancel() {
      tracker.settle({ partial: true });
      reader.cancel().catch(() => {});
    },
    async start(controller) {
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      // Capture WHY the model stopped. "max_tokens" means the output was
      // truncated mid-answer — without surfacing it, a 2h-transcript
      // translation that stops at the ⅓ mark renders as if it were the
      // complete result, silently losing the majority of the lecture.
      let stopReason: string | null = null;
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
            try {
              const evt = JSON.parse(json);
              tracker.observe(evt);
              // Anthropic can emit an `error` event mid-stream on upstream
              // trouble — propagate it instead of silently ending the output.
              if (evt.type === "error") {
                tracker.settle({
                  ok: false,
                  error: evt.error?.message ?? "AI stream error",
                });
                controller.error(
                  new Error(evt.error?.message ?? "AI stream error")
                );
                return;
              }
              if (
                evt.type === "message_delta" &&
                typeof evt.delta?.stop_reason === "string"
              ) {
                stopReason = evt.delta.stop_reason;
              }
              if (
                evt.type === "content_block_delta" &&
                evt.delta?.type === "text_delta" &&
                typeof evt.delta.text === "string"
              ) {
                controller.enqueue(encoder.encode(evt.delta.text));
              }
            } catch {
              /* ignore malformed line */
            }
          }
        }
      } catch (e) {
        tracker.settle({ partial: true });
        controller.error(e);
        return;
      }
      tracker.settle();
      // Truncated by the token cap — append a visible marker so the user knows
      // it's incomplete and can regenerate in smaller parts.
      if (stopReason === "max_tokens") {
        controller.enqueue(
          encoder.encode(
            "\n\n---\n⚠️ This response was cut off because it reached the maximum length. For a very long transcript, translate or summarize it in shorter sections."
          )
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

/** Human-readable language names for building AI prompts, matching the app set. */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese",
  it: "Italian", nl: "Dutch", ru: "Russian", hi: "Hindi", ja: "Japanese",
  ar: "Arabic", ur: "Urdu", ko: "Korean", zh: "Chinese", vi: "Vietnamese",
  id: "Indonesian", ms: "Malay", tr: "Turkish", pl: "Polish", cs: "Czech",
  hu: "Hungarian", no: "Norwegian", sv: "Swedish", da: "Danish", fi: "Finnish",
  el: "Greek", he: "Hebrew", ro: "Romanian", ca: "Catalan", uk: "Ukrainian",
  bn: "Bengali",
};

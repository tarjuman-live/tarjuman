import { NextResponse } from "next/server";

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
  timeoutMs?: number;
  /** Label for server-side error logs. */
  logTag: string;
}): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model ?? "claude-sonnet-5",
        max_tokens: opts.maxTokens ?? 2000,
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
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI failed: ${msg}` }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    console.error(
      `[${opts.logTag}] upstream HTTP ${upstream.status}: ${errText.slice(0, 300)}`
    );
    return NextResponse.json(
      { error: "AI temporarily unavailable." },
      { status: 502 }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
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
        controller.error(e);
        return;
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

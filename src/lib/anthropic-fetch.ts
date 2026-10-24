/**
 * fetch() for a STREAMING Anthropic request, with two timeouts instead of
 * AbortSignal.timeout's one.
 *
 * AbortSignal.timeout(n) bounds the WHOLE request, response body included: a
 * long lecture summary still streaming at n seconds was cut off mid-sentence
 * and replaced by an error, even though the model was working fine. Here:
 *   - `firstByteMs` bounds only the wait for the response headers;
 *   - `idleMs` bounds the gap between body chunks — a stream that keeps
 *     producing (Anthropic also sends periodic `ping` events) is never killed,
 *     a stalled one is.
 *
 * A timeout rejects / errors the stream with a message containing "timed out",
 * which callers already match on.
 */
export async function fetchAnthropicStream(
  url: string,
  init: Omit<RequestInit, "signal">,
  timeouts: { firstByteMs: number; idleMs: number },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutError = (what: string) =>
    new Error(`Anthropic request timed out (${what})`);

  const headerTimer = setTimeout(
    () => controller.abort(timeoutError("no response")),
    timeouts.firstByteMs,
  );
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(headerTimer);
  }
  if (!response.body) return response;

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  };
  const arm = () => {
    disarm();
    idleTimer = setTimeout(
      () => controller.abort(timeoutError("stream stalled")),
      timeouts.idleMs,
    );
  };
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start: arm,
      transform(chunk, ctrl) {
        arm();
        ctrl.enqueue(chunk);
      },
      flush: disarm,
      // Consumer cancelled (client went away): don't leave the timer armed.
      cancel: disarm,
    } as Transformer<Uint8Array, Uint8Array>),
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Request fields that turn thinking OFF for `model`.
 *
 * Sonnet 5 and Opus 5 run ADAPTIVE thinking when `thinking` is omitted —
 * unlike Haiku 4.5 / Sonnet 4.6, where omitting it means none — and thinking
 * shares `max_tokens` with the visible answer, so a summary sized for the
 * answer alone could come back truncated or nearly empty (and slower to
 * start). Models where `{type: "disabled"}` is a 400 (Sonnet 5.5, Opus 5.5)
 * are deliberately not listed: moving to one of those is a decision to make
 * with effort tuning, not a silent default.
 */
export function thinkingOff(model: string): { thinking?: { type: "disabled" } } {
  return model === "claude-sonnet-5" || model === "claude-opus-5"
    ? { thinking: { type: "disabled" } }
    : {};
}

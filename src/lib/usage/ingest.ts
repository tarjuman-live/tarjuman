import "server-only";
import { after } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UsageEventInput, UsageKind } from "../../../convex/usageShared";
import { costMicroUsd } from "./pricing";

/**
 * Server-side usage reporting for the admin dashboard (AI spend, error rates,
 * STT credential mints). Every API route that calls a paid upstream reports
 * one event per request through here.
 *
 * Design rules — this sits on the hottest paths in the app, so it must never
 * hurt them:
 *  - NEVER throws and never blocks a response. Sends happen in Next's
 *    `after()`, i.e. once the response has been delivered (Vercel keeps the
 *    function alive via waitUntil until they finish).
 *  - One ingest call per request, no in-memory buffering: a buffer flushed by
 *    a timer would run outside any request on Vercel and silently drop events.
 *  - No-op unless USAGE_INGEST_SECRET is set (the same value must be set on
 *    the Convex deployment — convex/usage.ts verifies it). Locally without the
 *    secret, nothing is sent and nothing breaks.
 *  - `error` strings are short upstream diagnostics, never user content.
 */

const ERROR_CHARS = 200;

/** Send events to Convex. Swallows every failure (logs a warning). */
export async function sendUsage(events: UsageEventInput[]): Promise<void> {
  const secret = process.env.USAGE_INGEST_SECRET;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!secret || !url || events.length === 0) return;
  try {
    // Fresh client per call: ConvexHttpClient queues mutations per instance,
    // and a shared one would serialize every route's ingest behind each other.
    const client = new ConvexHttpClient(url);
    await client.mutation(api.usage.ingest, { secret, events });
  } catch (e) {
    console.warn(
      "[usage] ingest failed:",
      e instanceof Error ? e.message.slice(0, 200) : String(e),
    );
  }
}

/** Record one event after the response is sent. Safe to call anywhere in a route. */
export function recordUsageAfter(event: UsageEventInput): void {
  try {
    after(() => sendUsage([event]));
  } catch {
    // Outside a request scope (e.g. a unit test) — drop silently.
  }
}

/**
 * Pull a short, human-readable message out of an Anthropic error body, e.g.
 * {"type":"error","error":{"type":"invalid_request_error","message":"Your
 * credit balance is too low…"}} → "Your credit balance is too low…".
 */
export function upstreamErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") {
      return parsed.error.message.slice(0, ERROR_CHARS);
    }
  } catch {
    /* not JSON */
  }
  return body.slice(0, ERROR_CHARS);
}

export interface SettleOutcome {
  ok?: boolean;
  status?: number;
  error?: string;
  /** The call ended before the model finished (client aborted / timed out). */
  partial?: boolean;
}

export interface AnthropicUsageTracker {
  /** Feed every parsed Anthropic SSE event (or a non-streaming response body). */
  observe(evt: unknown): void;
  /** Finish the call. Idempotent — the first settle wins. */
  settle(outcome?: SettleOutcome): void;
}

type UsageFields = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
};

function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

/**
 * Track one Anthropic Messages call and report it after the response.
 *
 * MUST be called synchronously inside the route handler (request scope) —
 * `after()` is registered here, never from inside a stream body. The
 * registered callback waits for `settle()`, but never longer than
 * `timeoutMs + 5s`: if some path forgets to settle (or the client vanishes
 * mid-stream), it reports what it saw as `partial` instead of holding the
 * function open until maxDuration.
 *
 * Token counts come from `message_start.message.usage` (input + cache) and
 * `message_delta.usage` (cumulative output); for a non-streaming body, pass
 * the parsed response — its top-level `usage` is read the same way.
 */
export function trackAnthropicCall(opts: {
  kind: UsageKind;
  model: string;
  userId?: Id<"users">;
  timeoutMs: number;
}): AnthropicUsageTracker {
  const startedAt = Date.now();
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let sawStop = false;
  let settled = false;
  let resolveDone!: (e: UsageEventInput) => void;
  const done = new Promise<UsageEventInput>((r) => (resolveDone = r));

  const absorb = (u: UsageFields | undefined) => {
    if (!u) return;
    // Take the max: message_delta's output_tokens is cumulative, and some
    // API versions repeat input counts there too.
    input = Math.max(input, num(u.input_tokens) ?? 0);
    output = Math.max(output, num(u.output_tokens) ?? 0);
    cacheRead = Math.max(cacheRead, num(u.cache_read_input_tokens) ?? 0);
    cacheWrite = Math.max(cacheWrite, num(u.cache_creation_input_tokens) ?? 0);
  };

  const build = (o: SettleOutcome): UsageEventInput => {
    const tokens = {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    };
    const anyTokens = input + output + cacheRead + cacheWrite > 0;
    const cost = anyTokens ? costMicroUsd(opts.model, tokens) : 0;
    const ok = o.ok ?? true;
    return {
      ...(opts.userId ? { userId: opts.userId } : {}),
      kind: opts.kind,
      model: opts.model,
      ...(anyTokens ? tokens : {}),
      ...(cost !== null ? { costMicroUsd: cost } : {}),
      ok,
      ...(ok && (o.partial || !sawStop) ? { partial: true } : {}),
      ...(o.status !== undefined ? { status: o.status } : {}),
      ...(o.error ? { error: o.error.slice(0, ERROR_CHARS) } : {}),
      latencyMs: Date.now() - startedAt,
    };
  };

  const tracker: AnthropicUsageTracker = {
    observe(evt) {
      if (!evt || typeof evt !== "object") return;
      const e = evt as {
        type?: string;
        message?: { usage?: UsageFields };
        usage?: UsageFields;
        stop_reason?: unknown;
      };
      if (e.type === "message_start") absorb(e.message?.usage);
      else if (e.type === "message_delta") absorb(e.usage);
      else if (e.type === "message_stop") sawStop = true;
      else if (e.type === "message") {
        // Non-streaming response body.
        absorb(e.usage);
        sawStop = true;
      }
    },
    settle(o = {}) {
      if (settled) return;
      settled = true;
      resolveDone(build(o));
    },
  };

  try {
    after(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<UsageEventInput>((r) => {
        timer = setTimeout(
          () => r(build({ partial: true })),
          opts.timeoutMs + 5_000,
        );
      });
      const evt = await Promise.race([done, timeout]);
      if (timer) clearTimeout(timer);
      await sendUsage([evt]);
    });
  } catch {
    // Outside a request scope — tracking is best-effort.
  }

  return tracker;
}

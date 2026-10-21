/**
 * Claude per-token pricing → per-call cost, for the admin dashboard's AI-spend
 * panel. Pure; unit-tested in pricing.test.ts.
 *
 * Rates are USD per million tokens, Anthropic first-party API, verified
 * 2026-10-21 against the claude-api skill's model table. A $/MTok figure is
 * numerically equal to micro-USD per token, which is why costs are stored as
 * integer micro-dollars (convex/usage.ts).
 *
 * Cache multipliers: reads 0.1× input, 5-minute writes 1.25× input (every
 * model here; Fable 5.1 / Opus 5.5 read cheaper — add explicit rates if the
 * app ever uses them). The app only writes 5-minute (`ephemeral`) caches.
 *
 * Unknown models return null so the dashboard shows them as "unpriced"
 * instead of silently counting $0. When a route switches model, add it here.
 */

export interface ModelRates {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

function rates(input: number, output: number): ModelRates {
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: input * 0.1,
    cacheWritePerMTok: input * 1.25,
  };
}

const HAIKU_4_5 = rates(1, 5);
const SONNET_5 = rates(2, 10);
const SONNET_4_6 = rates(3, 15);
const OPUS_4_8 = rates(5, 25);

export const MODEL_RATES: Record<string, ModelRates> = {
  "claude-haiku-4-5-20251001": HAIKU_4_5,
  "claude-haiku-4-5": HAIKU_4_5,
  "claude-sonnet-5": SONNET_5,
  "claude-sonnet-4-6": SONNET_4_6,
  "claude-opus-4-8": OPUS_4_8,
};

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Cost of one call in integer micro-USD, or null when the model is unpriced.
 * `inputTokens` is Anthropic's `input_tokens` — the UNCACHED input only; cache
 * reads/writes are reported separately and priced at their own rates.
 */
export function costMicroUsd(
  model: string | undefined,
  usage: TokenUsage,
): number | null {
  if (!model) return null;
  const r = MODEL_RATES[model];
  if (!r) return null;
  const micro =
    (usage.inputTokens ?? 0) * r.inputPerMTok +
    (usage.outputTokens ?? 0) * r.outputPerMTok +
    (usage.cacheReadTokens ?? 0) * r.cacheReadPerMTok +
    (usage.cacheWriteTokens ?? 0) * r.cacheWritePerMTok;
  return Math.round(micro);
}

/** "$0.0123" style formatting for micro-USD amounts (dashboard). */
export function formatMicroUsd(micro: number | null | undefined): string {
  if (micro === null || micro === undefined) return "—";
  const usd = micro / 1_000_000;
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

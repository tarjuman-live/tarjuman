import { v, type Infer } from "convex/values";

/**
 * Usage-event vocabulary shared by the Convex usage log (convex/usage.ts), the
 * admin dashboard, and the Next.js API routes that report usage
 * (src/lib/usage/*). Pure — safe to import from client, server, and Convex.
 */

export const usageKindValidator = v.union(
  v.literal("translate"),
  v.literal("summarize"),
  v.literal("ask"),
  v.literal("study_notes"),
  v.literal("translate_transcript"),
  v.literal("trial_translate"),
  // A short-lived STT credential was minted. Fires on prewarm AND on every
  // reconnect, so it is a credential count — never a recording count.
  v.literal("stt_token"),
  // An STT engine error reported by the client (e.g. Speechmatics
  // quota_exceeded, which only the browser ever sees).
  v.literal("stt_error"),
);

export type UsageKind = Infer<typeof usageKindValidator>;

/** Kinds that are Claude calls (have tokens + a dollar cost). */
export const AI_KINDS: readonly UsageKind[] = [
  "translate",
  "summarize",
  "ask",
  "study_notes",
  "translate_transcript",
  "trial_translate",
];

export function isAiKind(kind: UsageKind): boolean {
  return AI_KINDS.includes(kind);
}

/** Human labels for the dashboard. */
export const USAGE_KIND_LABEL: Record<UsageKind, string> = {
  translate: "Live translation",
  summarize: "Summaries",
  ask: "Ask the lecture",
  study_notes: "Study notes",
  translate_transcript: "Transcript translation",
  trial_translate: "Landing trial",
  stt_token: "STT credentials",
  stt_error: "STT errors",
};

/** What a Next.js route sends to `usage.ingest` for one call. */
export const usageEventInputValidator = v.object({
  userId: v.optional(v.id("users")),
  kind: usageKindValidator,
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  cacheReadTokens: v.optional(v.number()),
  cacheWriteTokens: v.optional(v.number()),
  costMicroUsd: v.optional(v.number()),
  ok: v.boolean(),
  partial: v.optional(v.boolean()),
  status: v.optional(v.number()),
  error: v.optional(v.string()),
  latencyMs: v.optional(v.number()),
});

export type UsageEventInput = Infer<typeof usageEventInputValidator>;

/** Max events accepted per ingest call, and max stored error-message length. */
export const MAX_EVENTS_PER_INGEST = 50;
export const MAX_ERROR_CHARS = 200;

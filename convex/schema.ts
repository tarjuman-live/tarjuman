import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Schema notes:
 * - `authTables` (from @convex-dev/auth) provides the `users` table plus the
 *   internal credential / session / verification tables Convex Auth needs.
 *   The `users` table comes with: name, email, image, phone, emailVerificationTime,
 *   etc. — all optional. We don't need to extend it.
 * - `sessions.userId` was optional during Phase B (anonymous mode). Now that
 *   auth is wired, we keep it optional in the schema (so any Phase B test
 *   rows still validate) but the mutations always set it from the
 *   authenticated user.
 */
export default defineSchema({
  ...authTables,

  sessions: defineTable({
    userId: v.optional(v.id("users")),
    title: v.optional(v.string()),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    status: v.union(
      v.literal("recording"),
      v.literal("paused"),
      v.literal("completed")
    ),
    segments: v.array(
      v.object({
        id: v.string(),
        sourceText: v.string(),
        translatedText: v.string(),
        timestamp: v.number(),
        // Verse/hadith continuation merge. When the LLM recognizes that
        // this segment, combined with prior context, completes a known
        // Quran verse or authentic hadith, the parent segment carries:
        //   - mergedFromIds: ids of consecutive earlier segments to absorb
        //   - combinedSourceText: the full source (e.g., Arabic verse)
        //   - combinedTranslatedText: the full translation with citation
        // Readers build a suppressed set from `mergedFromIds` to hide the
        // child segments and render only the parent's combined text.
        mergedFromIds: v.optional(v.array(v.string())),
        combinedSourceText: v.optional(v.string()),
        combinedTranslatedText: v.optional(v.string()),
      })
    ),
    duration: v.number(),
    summary: v.optional(v.string()),
    summaryLanguage: v.optional(v.string()),
    // When the AI summary was generated (ms). Drives the per-month summary
    // quota (see convex/billingLimits.ts). Optional: pre-existing summaries
    // predate this field and simply don't count toward the current month.
    summaryGeneratedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_date", ["userId", "createdAt"])
    .index("by_date", ["createdAt"]),

  // Per-user app preferences. One row per user (upserted). All fields optional
  // so the row can be created lazily and new prefs can be added without a
  // migration. Backed by Convex (not localStorage) so settings sync across
  // devices and the planned native apps.
  userPreferences: defineTable({
    userId: v.id("users"),
    defaultSourceLanguage: v.optional(v.string()),
    defaultTargetLanguage: v.optional(v.string()),
    ttsEnabled: v.optional(v.boolean()),
    mainSpeakerOnly: v.optional(v.boolean()),
  }).index("by_user", ["userId"]),

  // Stripe billing state — one row per paying user (kept separate from `users`
  // to avoid write contention between profile edits and webhook-driven billing
  // updates). The row is created when the user first hits Checkout (so we have
  // a place to stash `stripeCustomerId`), then the Stripe webhook patches
  // `plan`/`status`/period as the subscription lifecycle progresses.
  //
  // NOTE (test-mode experiment): `plan` is always DERIVED from `status`
  // (active/trialing → "pro", else "free") so re-delivered or out-of-order
  // webhooks are idempotent — see convex/subscriptions.ts:upsertFromStripe.
  subscriptions: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    subscriptionId: v.optional(v.string()),
    priceId: v.optional(v.string()),
    plan: v.union(v.literal("free"), v.literal("pro")),
    status: v.union(
      v.literal("active"),
      v.literal("trialing"),
      v.literal("past_due"),
      v.literal("canceled"),
      v.literal("incomplete")
    ),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_customer", ["stripeCustomerId"]),
});

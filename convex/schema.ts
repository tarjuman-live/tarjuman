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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_date", ["userId", "createdAt"])
    .index("by_date", ["createdAt"]),
});

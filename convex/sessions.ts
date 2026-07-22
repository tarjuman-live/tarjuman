import {
  mutation,
  query,
  internalMutation,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";
import { auth } from "./auth";

/**
 * Sessions CRUD with ownership checks.
 *
 * Every function calls `auth.getUserId(ctx)`:
 *  - Mutations: throw if unauthenticated (the user has no business writing).
 *  - Queries: return [] / null if unauthenticated (gentler — the page may
 *    render before the auth handshake completes).
 * Every read of an existing session validates that `session.userId === userId`
 * before returning it. Sessions from Phase B (no userId) are never visible
 * once auth is on.
 */

const segmentValidator = v.object({
  id: v.string(),
  sourceText: v.string(),
  translatedText: v.string(),
  timestamp: v.number(),
  // See schema.ts for the verse-merge field semantics.
  mergedFromIds: v.optional(v.array(v.string())),
  combinedSourceText: v.optional(v.string()),
  combinedTranslatedText: v.optional(v.string()),
});

/** Metadata-only session shape returned by list queries (no segments array). */
const sessionListItemValidator = v.object({
  _id: v.id("sessions"),
  _creationTime: v.number(),
  userId: v.optional(v.id("users")),
  title: v.optional(v.string()),
  sourceLanguage: v.string(),
  targetLanguage: v.string(),
  status: v.union(
    v.literal("recording"),
    v.literal("paused"),
    v.literal("completed")
  ),
  duration: v.number(),
  summary: v.optional(v.string()),
  summaryLanguage: v.optional(v.string()),
  summaryGeneratedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

async function requireUserId(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await auth.getUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  // Fail-closed on a deleted identity: a still-valid JWT whose user row is gone
  // must NOT be allowed to write orphan rows. (This is identity, not
  // off-language — closing is correct here.) One extra read on the write path.
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Account no longer exists");
  return userId;
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export const createSession = mutation({
  args: {
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    return await ctx.db.insert("sessions", {
      userId,
      sourceLanguage: args.sourceLanguage,
      targetLanguage: args.targetLanguage,
      title: args.title,
      status: "recording",
      segments: [],
      duration: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addSegments = mutation({
  args: {
    sessionId: v.id("sessions"),
    segments: v.array(segmentValidator),
  },
  handler: async (ctx, args) => {
    if (args.segments.length === 0) return;
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");

    const existing = new Set(session.segments.map((s) => s.id));
    const newOnes = args.segments.filter((s) => !existing.has(s.id));
    if (newOnes.length === 0) return;

    await ctx.db.patch(args.sessionId, {
      segments: [...session.segments, ...newOnes],
      updatedAt: Date.now(),
    });
  },
});

/**
 * Apply (or update) a verse/hadith merge directive to an already-flushed
 * segment. Fires when the translator detects mid-recording that a later
 * segment completes a Quran verse or hadith that started in earlier
 * segments — those earlier segments may already be persisted, so we
 * patch the saved array rather than re-appending.
 *
 * The parent segment's `combinedSourceText` + `combinedTranslatedText` +
 * `mergedFromIds` get written; children stay as-is (reader hides them via
 * the parent's mergedFromIds list).
 */
export const updateSegmentMerge = mutation({
  args: {
    sessionId: v.id("sessions"),
    parentSegmentId: v.string(),
    mergedFromIds: v.array(v.string()),
    combinedSourceText: v.string(),
    combinedTranslatedText: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");

    const next = session.segments.map((s) =>
      s.id === args.parentSegmentId
        ? {
            ...s,
            mergedFromIds: args.mergedFromIds,
            combinedSourceText: args.combinedSourceText,
            combinedTranslatedText: args.combinedTranslatedText,
          }
        : s
    );
    await ctx.db.patch(args.sessionId, {
      segments: next,
      updatedAt: Date.now(),
    });
  },
});

export const pauseSession = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");
    if (session.status === "completed") return; // terminal — see resumeSession
    await ctx.db.patch(args.sessionId, {
      status: "paused",
      updatedAt: Date.now(),
    });
  },
});

export const resumeSession = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");
    // "completed" is terminal — never resurrect a session the stale-session
    // sweep (or a replay) already closed. Without this guard a stray Resume on
    // a swept-but-still-open tab would silently re-open a completed session.
    if (session.status === "completed") return;
    await ctx.db.patch(args.sessionId, {
      status: "recording",
      updatedAt: Date.now(),
    });
  },
});

export const completeSession = mutation({
  args: {
    sessionId: v.id("sessions"),
    duration: v.number(),
    title: v.optional(v.string()),
    // The languages actually recorded. The session row may have been created
    // during prewarm with mount-time defaults, then the user switched the pair
    // before recording — persist the real values so history/detail label it
    // correctly (and derive the right RTL direction).
    sourceLanguage: v.optional(v.string()),
    targetLanguage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");
    await ctx.db.patch(args.sessionId, {
      status: "completed",
      duration: args.duration,
      title:
        args.title ??
        session.title ??
        deriveTitle(session.segments) ??
        undefined,
      ...(args.sourceLanguage ? { sourceLanguage: args.sourceLanguage } : {}),
      ...(args.targetLanguage ? { targetLanguage: args.targetLanguage } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const saveSummary = mutation({
  args: {
    sessionId: v.id("sessions"),
    summary: v.string(),
    summaryLanguage: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");
    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      summary: args.summary,
      summaryLanguage: args.summaryLanguage,
      // Stamp generation time so the monthly summary quota can count it.
      summaryGeneratedAt: now,
      updatedAt: now,
    });
  },
});

export const updateTitle = mutation({
  args: {
    sessionId: v.id("sessions"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");
    await ctx.db.patch(args.sessionId, {
      title: args.title,
      updatedAt: Date.now(),
    });
  },
});

export const deleteSession = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;
    if (session.userId !== userId) throw new Error("Not your session");
    await ctx.db.delete(args.sessionId);
  },
});

/**
 * Cron-driven cleanup for sessions abandoned mid-recording (tab killed before
 * Stop), so they don't linger at status="recording" in the user's history.
 *
 * Only "recording" rows are swept — NOT "paused": a genuine pause can last
 * hours (phone locked overnight) and its updatedAt isn't refreshed while
 * paused, so sweeping "paused" would force-complete a still-live session. An
 * actively-recording session bumps updatedAt every ~5s (addSegments), so a
 * 6h-stale "recording" row is genuinely abandoned. Empty rows (e.g. the
 * createSession-on-prewarm phantom from an idle /record visit) are DELETED
 * rather than completed, so they never surface as "Untitled" history cards.
 * The client mirror + replay in record/page.tsx is the data-recovery half.
 */
const STALE_SESSION_MS = 6 * 60 * 60 * 1000;

export const sweepStaleSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_SESSION_MS;
    // Bound each run: .collect() would load every stale row WITH its full
    // segments array, and several large abandoned recordings could blow the
    // per-transaction read budget so the sweep fails forever. .take(25) keeps
    // one run well under budget; the hourly cron drains any backlog over time.
    const stale = await ctx.db
      .query("sessions")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "recording").lt("updatedAt", cutoff)
      )
      .take(25);
    let completed = 0;
    let deleted = 0;
    for (const s of stale) {
      if (s.segments.length === 0) {
        await ctx.db.delete(s._id); // empty phantom — nothing to keep
        deleted++;
      } else {
        // Derive a real duration from the last segment's timestamp (seconds
        // from session start) — the client never called completeSession, so
        // duration is still 0 and the history card would show 00:00 for a
        // session with a full transcript. Preserve any pre-set duration.
        const last = s.segments[s.segments.length - 1];
        await ctx.db.patch(s._id, {
          status: "completed",
          duration: s.duration > 0 ? s.duration : Math.round(last?.timestamp ?? 0),
          title: s.title ?? deriveTitle(s.segments) ?? undefined,
          updatedAt: Date.now(),
        });
        completed++;
      }
    }
    return { completed, deleted };
  },
});

// ─── Queries ───────────────────────────────────────────────────────────────

export const getSession = query({
  // Accept a raw string, not v.id, so a malformed/foreign id from an old
  // bookmark or a mangled shared link doesn't fail Convex's argument validator
  // (which throws into the client error boundary as "Something went wrong" with
  // a dead "Try again"). normalizeId returns null for anything that isn't a
  // valid id for this table, routing it to the graceful "Session not found" UI.
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return null;
    const id = ctx.db.normalizeId("sessions", args.sessionId);
    if (!id) return null;
    const session = await ctx.db.get(id);
    if (!session) return null;
    if (session.userId !== userId) return null;
    return session;
  },
});

export const getUserSessions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];
    const all = await ctx.db
      .query("sessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    // Hide empty rows (e.g. the createSession-on-prewarm phantom from an idle
    // /record visit), and DROP the (potentially huge) segments array — the
    // history list renders metadata only, so shipping every transcript segment
    // to the client is pure read amplification.
    return all.filter((s) => s.segments.length > 0).map(toListItem);
  },
});

export const getRecentSessions = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(sessionListItemValidator),
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];
    const limit = args.limit ?? 3;
    // Paginate instead of .collect(): a power user with 200 saved khutbahs
    // would otherwise load every full transcript just to show 3 history cards
    // on /record. Stop as soon as we have enough non-empty rows.
    return await collectRecentListItems(ctx, userId, limit);
  },
});

// ─── Helpers ───────────────────────────────────────────────────────────────

async function collectRecentListItems(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number
): Promise<Omit<Doc<"sessions">, "segments">[]> {
  const results: Omit<Doc<"sessions">, "segments">[] = [];
  let cursor: string | null = null;
  const pageSize = Math.max(limit * 3, 10);

  while (results.length < limit) {
    const page = await ctx.db
      .query("sessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate({ numItems: pageSize, cursor });

    for (const session of page.page) {
      if (session.segments.length === 0) continue;
      results.push(toListItem(session));
      if (results.length >= limit) return results;
    }

    if (page.isDone) break;
    cursor = page.continueCursor;
  }

  return results;
}

/** Metadata-only session for list/card views — drops the heavy segments array. */
function toListItem(s: Doc<"sessions">): Omit<Doc<"sessions">, "segments"> {
  const copy: Record<string, unknown> = { ...s };
  delete copy.segments;
  return copy as Omit<Doc<"sessions">, "segments">;
}

function deriveTitle(
  segments: { sourceText: string; translatedText: string }[]
): string | null {
  const first = segments[0];
  if (!first) return null;
  const text = first.translatedText || first.sourceText;
  if (!text) return null;
  const firstSentence = text.split(/(?<=[.!?؟])\s/)[0] ?? text;
  return firstSentence.length > 60
    ? firstSentence.slice(0, 57).trim() + "…"
    : firstSentence.trim();
}

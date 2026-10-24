import {
  mutation,
  query,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";
import { auth } from "./auth";
import { usageMonthKey } from "./billingLimits";

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
    v.literal("completed"),
  ),
  duration: v.number(),
  summary: v.optional(v.string()),
  summaryLanguage: v.optional(v.string()),
  summaryGeneratedAt: v.optional(v.number()),
  segmentCount: v.optional(v.number()),
  firstSegmentText: v.optional(v.string()),
  platform: v.optional(v.union(v.literal("web"), v.literal("ios"))),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** A stored segment's shape as the client consumes it (segId → id). */
export type StoredSegment = {
  id: string;
  sourceText: string;
  translatedText: string;
  timestamp: number;
  mergedFromIds?: string[];
  combinedSourceText?: string;
  combinedTranslatedText?: string;
};

/** Convert a transcriptSegments row into the client segment shape. */
function rowToSegment(r: Doc<"transcriptSegments">): StoredSegment {
  return {
    id: r.segId,
    sourceText: r.sourceText,
    translatedText: r.translatedText,
    timestamp: r.timestamp,
    ...(r.mergedFromIds ? { mergedFromIds: r.mergedFromIds } : {}),
    ...(r.combinedSourceText
      ? { combinedSourceText: r.combinedSourceText }
      : {}),
    ...(r.combinedTranslatedText
      ? { combinedTranslatedText: r.combinedTranslatedText }
      : {}),
  };
}

/** How many segments a session has, without loading them (legacy fallback). */
export function segmentCountOf(s: Doc<"sessions">): number {
  return s.segmentCount ?? s.segments.length;
}

/** All segments for a session: from the table, or legacy inline as fallback. */
export async function loadSegments(
  ctx: QueryCtx,
  session: Doc<"sessions">,
): Promise<StoredSegment[]> {
  const rows = await ctx.db
    .query("transcriptSegments")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .collect();
  if (rows.length === 0) return session.segments; // legacy inline-only
  if (session.segments.length === 0) return rows.map(rowToSegment); // table-only
  // Split-brain: a session that straddled the deploy has BOTH inline (earlier)
  // and table (later) segments. Inline came first chronologically; append any
  // table rows not already represented inline, deduped by id.
  const inlineIds = new Set(session.segments.map((s) => s.id));
  const tableExtra = rows.map(rowToSegment).filter((s) => !inlineIds.has(s.id));
  return [...session.segments, ...tableExtra];
}

/**
 * Add a session's recording time to the owner's monthly `recordingUsage`
 * ledger — the meter behind the plan hour allowance (billingLimits.ts).
 *
 * Meters only the DELTA above `session.meteredSeconds`, so the several
 * completeSession calls one recording can produce (Stop, the unmount
 * exit-flush, a crashed-tab mirror replay) and the stale sweep never double
 * count, and a later call with a longer duration adds just the difference.
 * Time is booked to the month it is metered in. Deleting a session does not
 * touch the ledger — no refunds.
 */
export async function meterSession(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  durationSec: number,
): Promise<void> {
  const userId = session.userId;
  if (!userId) return; // pre-auth legacy row — no owner to bill
  const total = Number.isFinite(durationSec) ? Math.round(durationSec) : 0;
  const already = session.meteredSeconds ?? 0;
  const delta = total - already;
  if (delta <= 0) return;
  const month = usageMonthKey(Date.now());
  const row = await ctx.db
    .query("recordingUsage")
    .withIndex("by_userId_and_month", (q) =>
      q.eq("userId", userId).eq("month", month),
    )
    .unique();
  if (row) {
    await ctx.db.patch("recordingUsage", row._id, {
      seconds: row.seconds + delta,
    });
  } else {
    await ctx.db.insert("recordingUsage", { userId, month, seconds: delta });
  }
  await ctx.db.patch("sessions", session._id, { meteredSeconds: total });
}

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
    // Optional so older clients (shipped iOS builds) keep working unchanged.
    platform: v.optional(v.union(v.literal("web"), v.literal("ios"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    return await ctx.db.insert("sessions", {
      userId,
      sourceLanguage: args.sourceLanguage,
      targetLanguage: args.targetLanguage,
      title: args.title,
      ...(args.platform ? { platform: args.platform } : {}),
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

    // Insert each NEW segment as its own row — no growing array, no 1 MiB
    // document ceiling. Dedupe by (sessionId, segId) so a retried/replayed
    // batch (crash recovery, forced final flush) can't create duplicates.
    let inserted = 0;
    let firstText = session.firstSegmentText;
    for (const seg of args.segments) {
      const dup = await ctx.db
        .query("transcriptSegments")
        .withIndex("by_session_seg", (q) =>
          q.eq("sessionId", args.sessionId).eq("segId", seg.id),
        )
        .first();
      if (dup) continue;
      await ctx.db.insert("transcriptSegments", {
        sessionId: args.sessionId,
        segId: seg.id,
        sourceText: seg.sourceText,
        translatedText: seg.translatedText,
        timestamp: seg.timestamp,
        ...(seg.mergedFromIds ? { mergedFromIds: seg.mergedFromIds } : {}),
        ...(seg.combinedSourceText
          ? { combinedSourceText: seg.combinedSourceText }
          : {}),
        ...(seg.combinedTranslatedText
          ? { combinedTranslatedText: seg.combinedTranslatedText }
          : {}),
      });
      inserted++;
      if (!firstText) firstText = seg.translatedText || seg.sourceText;
    }
    if (inserted === 0) return;

    await ctx.db.patch(args.sessionId, {
      // Base off segmentCount for table-backed sessions; fall back to the
      // legacy inline length so a session that predates this field counts up
      // correctly from its existing inline segments.
      segmentCount: segmentCountOf(session) + inserted,
      ...(firstText && !session.firstSegmentText
        ? { firstSegmentText: firstText }
        : {}),
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

    // Table-backed session: patch the single parent row.
    const row = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_session_seg", (q) =>
        q.eq("sessionId", args.sessionId).eq("segId", args.parentSegmentId),
      )
      .first();
    if (row) {
      await ctx.db.patch(row._id, {
        mergedFromIds: args.mergedFromIds,
        combinedSourceText: args.combinedSourceText,
        combinedTranslatedText: args.combinedTranslatedText,
      });
      await ctx.db.patch(args.sessionId, { updatedAt: Date.now() });
      return;
    }

    // Legacy inline session — patch the array in place.
    const next = session.segments.map((s) =>
      s.id === args.parentSegmentId
        ? {
            ...s,
            mergedFromIds: args.mergedFromIds,
            combinedSourceText: args.combinedSourceText,
            combinedTranslatedText: args.combinedTranslatedText,
          }
        : s,
    );
    await ctx.db.patch(args.sessionId, {
      segments: next,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Fill in a translation that finished AFTER its segment was saved. Stop
 * persists still-translating segments source-only (a cut-off partial must
 * never be written), and a segment whose translation failed is saved
 * source-only so it doesn't hold back the rest; this patches the real
 * translation in when it lands. Only ever fills a BLANK translation — it can't
 * overwrite one that was already saved.
 */
export const patchSegmentTranslation = mutation({
  args: {
    sessionId: v.id("sessions"),
    segmentId: v.string(),
    translatedText: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const text = args.translatedText.trim();
    if (!text) return null;
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null; // deleted meanwhile — nothing to patch
    if (session.userId !== userId) throw new Error("Not your session");

    const row = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_session_seg", (q) =>
        q.eq("sessionId", args.sessionId).eq("segId", args.segmentId),
      )
      .first();
    if (!row || row.translatedText) return null;
    await ctx.db.patch(row._id, { translatedText: text });
    // The history title is derived from the first segment's text, which was
    // its SOURCE while the translation was blank. Follow the translation —
    // but never over a title the user set themselves.
    if (session.firstSegmentText === row.sourceText) {
      const derivedFromSource =
        session.title !== undefined &&
        session.title === truncateTitle(row.sourceText);
      await ctx.db.patch(args.sessionId, {
        firstSegmentText: text,
        ...(derivedFromSource
          ? { title: truncateTitle(text) ?? text.slice(0, 60) }
          : {}),
      });
    }
    return null;
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
    await meterSession(ctx, session, args.duration);
    await ctx.db.patch(args.sessionId, {
      status: "completed",
      duration: args.duration,
      // Title from the stored first-segment text (table-backed sessions have an
      // empty inline array), falling back to the legacy inline derivation.
      title:
        args.title ??
        session.title ??
        truncateTitle(session.firstSegmentText) ??
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
    // Cascade-delete the session's transcript rows so they don't orphan.
    const rows = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
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
        q.eq("status", "recording").lt("updatedAt", cutoff),
      )
      .take(25);
    let completed = 0;
    let deleted = 0;
    for (const s of stale) {
      if (segmentCountOf(s) === 0) {
        await ctx.db.delete(s._id); // empty phantom — nothing to keep
        deleted++;
      } else {
        // Derive a real duration from the last segment's timestamp (seconds
        // from session start) — the client never called completeSession, so
        // duration is still 0 and the history card would show 00:00 for a
        // session with a full transcript. Preserve any pre-set duration.
        let lastTimestamp = s.segments[s.segments.length - 1]?.timestamp ?? 0;
        if (s.duration <= 0) {
          const lastRow = await ctx.db
            .query("transcriptSegments")
            .withIndex("by_session", (q) => q.eq("sessionId", s._id))
            .order("desc")
            .first();
          if (lastRow) lastTimestamp = lastRow.timestamp;
        }
        const duration =
          s.duration > 0 ? s.duration : Math.round(lastTimestamp);
        await meterSession(ctx, s, duration);
        await ctx.db.patch(s._id, {
          status: "completed",
          duration,
          title:
            s.title ??
            truncateTitle(s.firstSegmentText) ??
            deriveTitle(s.segments) ??
            undefined,
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
    // Attach segments from the table (or legacy inline) so the client shape is
    // unchanged — it still reads `session.segments`.
    const segments = await loadSegments(ctx, session);
    return { ...session, segments };
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
    // /record visit). segmentCount tells a real session from a phantom without
    // loading the segments (which now live in a separate table); legacy rows
    // fall back to the inline length. toListItem drops the inline array.
    return all.filter((s) => segmentCountOf(s) > 0).map(toListItem);
  },
});

export const getRecentSessions = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(sessionListItemValidator),
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return [];
    // Clamp to a non-negative integer. The scan loop pushes a row before
    // testing `results.length >= limit`, so an unclamped 0 or negative would
    // return ONE session where the caller asked for none.
    const limit = Math.max(0, Math.floor(args.limit ?? 3));
    if (limit === 0) return [];
    // Stream instead of .collect(): a power user with 200 saved khutbahs would
    // otherwise load every session row just to show 3 history cards on /record.
    // Stop as soon as we have enough non-empty rows.
    return await collectRecentListItems(ctx, userId, limit);
  },
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Upper bound on rows examined while hunting for `limit` non-empty sessions.
 *
 * A user whose history is mostly empty phantom rows (createSession fires on
 * /record prewarm, so an idle visit leaves one behind) would otherwise walk
 * their entire history to fill three cards. 200 is far more than enough in
 * practice while keeping the read bounded as the table grows.
 */
const RECENT_SCAN_LIMIT = 200;

async function collectRecentListItems(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number,
): Promise<Omit<Doc<"sessions">, "segments">[]> {
  const results: Omit<Doc<"sessions">, "segments">[] = [];
  let scanned = 0;

  // ASYNC ITERATION, NOT .paginate(). This previously called .paginate() inside
  // a while loop to page past empty sessions — but Convex permits exactly ONE
  // paginated query per function execution, so the second call threw
  // "ran multiple paginated queries" and the /record recent list died. The bug
  // only surfaced once a user had more than one page of history whose first
  // page held fewer than `limit` non-empty rows, which is why it survived
  // early use.
  //
  // `for await` streams lazily in index order and stops the moment we break, so
  // it reads no more than it needs — the property the pagination loop was
  // reaching for — with no single-paginated-query restriction and no .collect()
  // of the full history.
  for await (const session of ctx.db
    .query("sessions")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .order("desc")) {
    scanned++;
    if (segmentCountOf(session) > 0) {
      results.push(toListItem(session));
      if (results.length >= limit) break;
    }
    if (scanned >= RECENT_SCAN_LIMIT) break;
  }

  return results;
}

/** Metadata-only session for list/card views — drops the heavy segments array. */
export function toListItem(s: Doc<"sessions">): Omit<Doc<"sessions">, "segments"> {
  const copy: Record<string, unknown> = { ...s };
  delete copy.segments;
  return copy as Omit<Doc<"sessions">, "segments">;
}

/** First sentence of `text`, truncated to a 60-char title. Null if empty. */
function truncateTitle(text: string | undefined | null): string | null {
  if (!text) return null;
  const firstSentence = text.split(/(?<=[.!?؟])\s/)[0] ?? text;
  return firstSentence.length > 60
    ? firstSentence.slice(0, 57).trim() + "…"
    : firstSentence.trim();
}

function deriveTitle(
  segments: { sourceText: string; translatedText: string }[],
): string | null {
  const first = segments[0];
  if (!first) return null;
  return truncateTitle(first.translatedText || first.sourceText);
}

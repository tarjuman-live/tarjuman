import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { isAdminId, requireAdmin } from "./adminAuth";
import { getEffectivePlan, isGrantActive } from "./entitlements";
import { isTestEmail } from "./admin";
import { loadSegments, segmentCountOf } from "./sessions";
import { deleteUserIdentity } from "./userData";
import { DASHBOARD_SCHEMA_VERSION, sessionSeconds } from "./adminMetrics";
import { monthKey, REPORT_TZ_OFFSET_MS } from "./reporting";
import { BILLING_ENABLED } from "./billingLimits";

/**
 * The /admin API. EVERY function here starts with `requireAdmin(ctx)` — the
 * server-side gate (ADMIN_USER_IDS allowlist, see adminAuth.ts). The web
 * page's notFound() for non-admins is cosmetic; this is the real lock.
 *
 * Reads that touch other users' data never return transcript text except via
 * `openSessionForAdmin`, which is a MUTATION precisely so the access is written
 * to adminAuditLog in the same transaction — the "operator access is logged"
 * promise in the privacy policy can't be skipped by a UI that forgets to log.
 */

/** Byte budget for paginated session lists (legacy docs carry inline text). */
const SESSION_PAGE_BYTES = 4 * 1024 * 1024;
/** Users scanned by the substring search before it stops (documented cap). */
const SEARCH_SCAN_CAP = 5000;
const SEARCH_MAX_RESULTS = 50;

// ─── Small shared readers ───────────────────────────────────────────────────

type UserBrief = {
  id: Id<"users">;
  email: string | null;
  name: string | null;
  image: string | null;
};

async function userBrief(
  ctx: QueryCtx,
  userId: Id<"users"> | undefined | null,
  cache?: Map<string, UserBrief | null>,
): Promise<UserBrief | null> {
  if (!userId) return null;
  if (cache?.has(userId)) return cache.get(userId) ?? null;
  const u = await ctx.db.get("users", userId);
  const brief = u
    ? {
        id: u._id,
        email: u.email ?? null,
        name: u.name ?? null,
        image: u.image ?? null,
      }
    : null;
  cache?.set(userId, brief);
  return brief;
}

async function providersOf(ctx: QueryCtx, userId: Id<"users">) {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .take(10);
  return accounts.map((a) => a.provider);
}

/** Compact, transcript-free session row for lists. */
function sessionRow(s: Doc<"sessions">) {
  const segmentCount = segmentCountOf(s);
  return {
    id: s._id,
    userId: s.userId ?? null,
    title: s.title ?? null,
    status: s.status,
    sourceLanguage: s.sourceLanguage,
    targetLanguage: s.targetLanguage,
    seconds: sessionSeconds({
      durationSec: s.duration,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }),
    segmentCount,
    hasSummary: Boolean(s.summary),
    platform: s.platform ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

async function userListRow(ctx: QueryCtx, user: Doc<"users">) {
  const [providers, effective, stats] = await Promise.all([
    providersOf(ctx, user._id),
    getEffectivePlan(ctx, user._id),
    ctx.db
      .query("adminUserStats")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique(),
  ]);
  return {
    id: user._id,
    email: user.email ?? null,
    name: user.name ?? null,
    image: user.image ?? null,
    createdAt: user._creationTime,
    verified: user.emailVerificationTime !== undefined,
    providers,
    plan: effective.plan,
    planSource: effective.source,
    isAdmin: isAdminId(user._id),
    isTest: isTestEmail(user.email),
    stats: stats
      ? {
          sessions: stats.sessions,
          recordingSeconds: stats.recordingSeconds,
          summaries: stats.summaries,
          lastRecordedAt: stats.lastRecordedAt ?? null,
          platforms: stats.platforms,
        }
      : null,
  };
}

async function audit(
  ctx: MutationCtx,
  actorId: Id<"users">,
  action: Doc<"adminAuditLog">["action"],
  extra: {
    targetUserId?: Id<"users">;
    targetSessionId?: Id<"sessions">;
    details?: string;
  } = {},
) {
  await ctx.db.insert("adminAuditLog", { actorId, action, ...extra });
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export const getSnapshot = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const row = await ctx.db
      .query("adminSnapshots")
      .withIndex("by_key", (q) => q.eq("key", "dashboard"))
      .unique();
    const lease = await ctx.db
      .query("adminState")
      .withIndex("by_key", (q) => q.eq("key", "refresh"))
      .unique();
    const alerts = await ctx.db
      .query("adminState")
      .withIndex("by_key", (q) => q.eq("key", "alerts"))
      .unique();
    return {
      currentSchemaVersion: DASHBOARD_SCHEMA_VERSION,
      snapshot: row
        ? {
            computedAt: row.computedAt,
            durationMs: row.durationMs,
            schemaVersion: row.schemaVersion,
            data: row.data as unknown,
          }
        : null,
      refreshStartedAt: lease?.refreshStartedAt ?? null,
      refreshFinishedAt: lease?.refreshFinishedAt ?? null,
      alerts: alerts?.activeAlerts ?? [],
    };
  },
});

/**
 * Sessions saved within the window (client passes `since`, rounded, so the
 * subscription key is stable). Covers recording AND paused, because updatedAt
 * only moves when a segment saves — silence/pauses would otherwise drop a live
 * lecture off the list. Empty rows are /record tabs that have prewarmed the
 * mic but not transcribed anything yet; they're returned separately.
 */
export const liveNow = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    await requireAdmin(ctx);
    const cache = new Map<string, UserBrief | null>();
    const rows = [];
    for (const status of ["recording", "paused"] as const) {
      const found = await ctx.db
        .query("sessions")
        .withIndex("by_status_updated", (q) =>
          q.eq("status", status).gte("updatedAt", since),
        )
        .order("desc")
        .take(50);
      for (const s of found) {
        rows.push({
          ...sessionRow(s),
          owner: await userBrief(ctx, s.userId, cache),
        });
      }
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      live: rows.filter((r) => r.segmentCount > 0),
      warming: rows.filter((r) => r.segmentCount === 0),
    };
  },
});

export const recentSignups = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(10);
    return await Promise.all(
      users.map(async (u) => ({
        id: u._id,
        email: u.email ?? null,
        name: u.name ?? null,
        image: u.image ?? null,
        createdAt: u._creationTime,
        providers: await providersOf(ctx, u._id),
        isTest: isTestEmail(u.email),
      })),
    );
  },
});

export const recentSessions = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const cache = new Map<string, UserBrief | null>();
    const out = [];
    let scanned = 0;
    for await (const s of ctx.db.query("sessions").order("desc")) {
      if (++scanned > 300) break;
      if (segmentCountOf(s) === 0) continue;
      out.push({ ...sessionRow(s), owner: await userBrief(ctx, s.userId, cache) });
      if (out.length >= 15) break;
    }
    return out;
  },
});

export const recentAudit = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("adminAuditLog").order("desc").take(30);
    const cache = new Map<string, UserBrief | null>();
    return await Promise.all(
      rows.map(async (r) => ({
        id: r._id,
        at: r._creationTime,
        action: r.action,
        details: r.details ?? null,
        actor: await userBrief(ctx, r.actorId, cache),
        targetUserId: r.targetUserId ?? null,
        target: await userBrief(ctx, r.targetUserId, cache),
        targetSessionId: r.targetSessionId ?? null,
      })),
    );
  },
});

// ─── Users ──────────────────────────────────────────────────────────────────

export const listUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: v.union(
      v.literal("newest"),
      v.literal("most_active"),
      v.literal("recent"),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { paginationOpts, sort, search }) => {
    await requireAdmin(ctx);

    const needle = search?.trim().toLowerCase();
    if (needle) {
      // Bounded substring scan — at this scale cheaper and friendlier than a
      // search index (Convex text search only matches word PREFIXES, so
      // "mitted" would never find "committed1@…"). Cap documented above.
      const matches: Doc<"users">[] = [];
      let scanned = 0;
      for await (const u of ctx.db.query("users").order("desc")) {
        if (++scanned > SEARCH_SCAN_CAP) break;
        const hay = `${u.email ?? ""} ${u.name ?? ""} ${u._id}`.toLowerCase();
        if (hay.includes(needle)) matches.push(u);
        if (matches.length >= SEARCH_MAX_RESULTS) break;
      }
      return {
        page: await Promise.all(matches.map((u) => userListRow(ctx, u))),
        isDone: true,
        continueCursor: "",
      };
    }

    if (sort === "newest") {
      const res = await ctx.db
        .query("users")
        .order("desc")
        .paginate(paginationOpts);
      return {
        ...res,
        page: await Promise.all(res.page.map((u) => userListRow(ctx, u))),
      };
    }

    // Activity sorts read the per-user rollup written at dashboard refresh.
    const res =
      sort === "most_active"
        ? await ctx.db
            .query("adminUserStats")
            .withIndex("by_recording_seconds")
            .order("desc")
            .paginate(paginationOpts)
        : await ctx.db
            .query("adminUserStats")
            .withIndex("by_last_recorded_at")
            .order("desc")
            .paginate(paginationOpts);
    const page = [];
    for (const st of res.page) {
      const u = await ctx.db.get("users", st.userId);
      if (u) page.push(await userListRow(ctx, u));
    }
    return { ...res, page };
  },
});

export const getUserDetail = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const userId = ctx.db.normalizeId("users", args.userId);
    if (!userId) return null;
    const user = await ctx.db.get("users", userId);
    if (!user) return null;

    const now = Date.now();
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .take(10);
    const authSessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .take(200);
    const effective = await getEffectivePlan(ctx, userId);
    const grants = await ctx.db
      .query("planGrants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const stats = await ctx.db
      .query("adminUserStats")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const thisMonth = monthKey(now);
    // Mid-month of the previous reporting-zone month (day 15 is safe from
    // any timezone edge).
    const local = new Date(now + REPORT_TZ_OFFSET_MS);
    const lastMonth = monthKey(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 15),
    );
    const monthRows = await ctx.db
      .query("usageUserMonthly")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(24);
    const recentUsage = await ctx.db
      .query("usageEvents")
      .withIndex("by_user_and_kind", (q) => q.eq("userId", userId))
      .order("desc")
      .take(15);
    const auditRows = await ctx.db
      .query("adminAuditLog")
      .withIndex("by_target_user", (q) => q.eq("targetUserId", userId))
      .order("desc")
      .take(20);
    const cache = new Map<string, UserBrief | null>();

    const sub = effective.sub;
    return {
      user: {
        id: user._id,
        email: user.email ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
        createdAt: user._creationTime,
        verified: user.emailVerificationTime !== undefined,
        isAdmin: isAdminId(user._id),
        isTest: isTestEmail(user.email),
      },
      providers: accounts.map((a) => ({
        provider: a.provider,
        emailVerified: Boolean(a.emailVerified),
      })),
      devices: {
        live: authSessions.filter((s) => s.expirationTime > now).length,
        lastSignInAt: authSessions.reduce<number | null>(
          (max, s) => (max === null || s._creationTime > max ? s._creationTime : max),
          null,
        ),
      },
      plan: {
        plan: effective.plan,
        source: effective.source,
        compExpiresAt: effective.grant?.expiresAt ?? null,
      },
      billingEnabled: BILLING_ENABLED,
      subscription: sub
        ? {
            status: sub.status,
            plan: sub.plan,
            priceId: sub.priceId ?? null,
            stripeCustomerId: sub.stripeCustomerId,
            subscriptionId: sub.subscriptionId ?? null,
            currentPeriodEnd: sub.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
          }
        : null,
      grants: await Promise.all(
        grants.map(async (g) => ({
          id: g._id,
          grantedAt: g.grantedAt,
          grantedBy: await userBrief(ctx, g.grantedBy, cache),
          expiresAt: g.expiresAt ?? null,
          expiredAt: g.expiredAt ?? null,
          revokedAt: g.revokedAt ?? null,
          note: g.note ?? null,
          active: isGrantActive(g, now),
        })),
      ),
      prefs: prefs
        ? {
            defaultSourceLanguage: prefs.defaultSourceLanguage ?? null,
            defaultTargetLanguage: prefs.defaultTargetLanguage ?? null,
            mainSpeakerOnly: prefs.mainSpeakerOnly ?? null,
            ttsEnabled: prefs.ttsEnabled ?? null,
          }
        : null,
      stats: stats
        ? {
            sessions: stats.sessions,
            recordingSeconds: stats.recordingSeconds,
            summaries: stats.summaries,
            lastRecordedAt: stats.lastRecordedAt ?? null,
            platforms: stats.platforms,
            updatedAt: stats.updatedAt,
          }
        : null,
      ai: {
        thisMonth: monthRows.find((r) => r.month === thisMonth) ?? null,
        lastMonth: monthRows.find((r) => r.month === lastMonth) ?? null,
        allTimeMicroUsd: monthRows.reduce((sum, r) => sum + r.costMicroUsd, 0),
      },
      recentUsage: recentUsage.map((e) => ({
        id: e._id,
        at: e._creationTime,
        kind: e.kind,
        model: e.model ?? null,
        ok: e.ok,
        costMicroUsd: e.costMicroUsd ?? null,
        error: e.error ?? null,
      })),
      audit: await Promise.all(
        auditRows.map(async (r) => ({
          id: r._id,
          at: r._creationTime,
          action: r.action,
          details: r.details ?? null,
          actor: await userBrief(ctx, r.actorId, cache),
        })),
      ),
    };
  },
});

export const listUserSessions = query({
  args: { userId: v.id("users"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { userId, paginationOpts }) => {
    await requireAdmin(ctx);
    const res = await ctx.db
      .query("sessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate({ ...paginationOpts, maximumBytesRead: SESSION_PAGE_BYTES });
    return { ...res, page: res.page.map(sessionRow) };
  },
});

export const listSessions = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(
      v.union(
        v.literal("recording"),
        v.literal("paused"),
        v.literal("completed"),
      ),
    ),
  },
  handler: async (ctx, { paginationOpts, status }) => {
    await requireAdmin(ctx);
    const opts = { ...paginationOpts, maximumBytesRead: SESSION_PAGE_BYTES };
    const res = status
      ? await ctx.db
          .query("sessions")
          .withIndex("by_status_updated", (q) => q.eq("status", status))
          .order("desc")
          .paginate(opts)
      : await ctx.db.query("sessions").order("desc").paginate(opts);
    const cache = new Map<string, UserBrief | null>();
    const page = [];
    for (const s of res.page) {
      page.push({ ...sessionRow(s), owner: await userBrief(ctx, s.userId, cache) });
    }
    return { ...res, page };
  },
});

// ─── System ─────────────────────────────────────────────────────────────────

export const getSystemInfo = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const lastEvent = await ctx.db.query("usageEvents").order("desc").first();
    const recentErrors = await ctx.db
      .query("usageEvents")
      .withIndex("by_ok", (q) => q.eq("ok", false))
      .order("desc")
      .take(25);
    const alertState = await ctx.db
      .query("adminState")
      .withIndex("by_key", (q) => q.eq("key", "alerts"))
      .unique();
    const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
    const cache = new Map<string, UserBrief | null>();
    return {
      // Presence flags only — never values.
      env: {
        adminAlertEmail: Boolean(process.env.ADMIN_ALERT_EMAIL),
        usageIngestSecret: Boolean(process.env.USAGE_INGEST_SECRET),
        resend: Boolean(process.env.RESEND_API_KEY),
        stripeMode: stripeKey.startsWith("sk_live")
          ? ("live" as const)
          : stripeKey.startsWith("sk_test")
            ? ("test" as const)
            : ("unset" as const),
        // Must be OFF in production — the simulator sign-in bypass.
        devAuthBypass: Boolean(
          process.env.DEV_AUTH_BYPASS_SECRET && process.env.DEV_AUTH_BYPASS_EMAIL,
        ),
        adminCount: (process.env.ADMIN_USER_IDS ?? "")
          .split(",")
          .filter((s) => s.trim()).length,
      },
      deploymentUrl: process.env.CONVEX_CLOUD_URL ?? null,
      billingEnabled: BILLING_ENABLED,
      lastUsageEventAt: lastEvent?._creationTime ?? null,
      recentErrors: await Promise.all(
        recentErrors.map(async (e) => ({
          id: e._id,
          at: e._creationTime,
          kind: e.kind,
          model: e.model ?? null,
          provider: e.provider ?? null,
          status: e.status ?? null,
          error: e.error ?? null,
          user: await userBrief(ctx, e.userId, cache),
        })),
      ),
      alerts: alertState?.activeAlerts ?? [],
      lastAlertSentAt: alertState?.lastAlertSentAt ?? {},
    };
  },
});

// ─── Mutations (each one writes the audit log) ──────────────────────────────

/**
 * Open a user's session — metadata, owner, transcript, summary — and record
 * the access in adminAuditLog IN THE SAME TRANSACTION. A mutation (not a
 * query) so logging can't be skipped. Returns null for a bad/missing id.
 */
export const openSessionForAdmin = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const sessionId = ctx.db.normalizeId("sessions", args.sessionId);
    if (!sessionId) return null;
    const session = await ctx.db.get("sessions", sessionId);
    if (!session) return null;
    await audit(ctx, admin._id, "view_session", {
      targetSessionId: sessionId,
      ...(session.userId ? { targetUserId: session.userId } : {}),
    });
    return {
      session: {
        ...sessionRow(session),
        summary: session.summary ?? null,
        summaryLanguage: session.summaryLanguage ?? null,
        summaryGeneratedAt: session.summaryGeneratedAt ?? null,
      },
      owner: await userBrief(ctx, session.userId),
      segments: await loadSegments(ctx, session),
    };
  },
});

export const grantPro = mutation({
  args: {
    userId: v.id("users"),
    expiresAt: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  returns: v.id("planGrants"),
  handler: async (ctx, { userId, expiresAt, note }) => {
    const admin = await requireAdmin(ctx);
    const target = await ctx.db.get("users", userId);
    if (!target) throw new ConvexError("User not found");
    const now = Date.now();
    if (expiresAt !== undefined && expiresAt <= now + 60_000) {
      throw new ConvexError("Expiry must be in the future");
    }
    const cleanNote = note?.trim().slice(0, 500) || undefined;

    // One active grant at a time: supersede any current one.
    for (const g of await ctx.db
      .query("planGrants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50)) {
      if (isGrantActive(g, now)) {
        await ctx.db.patch("planGrants", g._id, {
          revokedAt: now,
          revokedBy: admin._id,
        });
      }
    }

    const grantId = await ctx.db.insert("planGrants", {
      userId,
      plan: "pro",
      grantedBy: admin._id,
      grantedAt: now,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(cleanNote ? { note: cleanNote } : {}),
    });
    if (expiresAt !== undefined) {
      await ctx.scheduler.runAt(expiresAt, internal.entitlements.expireGrant, {
        grantId,
      });
    }
    await audit(ctx, admin._id, "grant_pro", {
      targetUserId: userId,
      details:
        (expiresAt !== undefined
          ? `until ${new Date(expiresAt).toISOString().slice(0, 10)}`
          : "no expiry") + (cleanNote ? ` — ${cleanNote}` : ""),
    });
    return grantId;
  },
});

export const revokePro = mutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const admin = await requireAdmin(ctx);
    const now = Date.now();
    let revoked = 0;
    for (const g of await ctx.db
      .query("planGrants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50)) {
      if (isGrantActive(g, now)) {
        await ctx.db.patch("planGrants", g._id, {
          revokedAt: now,
          revokedBy: admin._id,
        });
        revoked++;
      }
    }
    if (revoked === 0) throw new ConvexError("No active complimentary Pro");
    await audit(ctx, admin._id, "revoke_pro", { targetUserId: userId });
    return null;
  },
});

/**
 * Permanently delete a user (same cascade as self-serve "Delete account").
 * Refuses: yourself, another admin, anyone with a live Stripe subscription
 * (deleting the row would NOT stop Stripe billing them), and any confirmation
 * that doesn't exactly match their email.
 */
export const deleteUser = mutation({
  args: { userId: v.id("users"), confirmEmail: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, confirmEmail }) => {
    const admin = await requireAdmin(ctx);
    if (userId === admin._id) {
      throw new ConvexError("You can't delete your own account from here.");
    }
    if (isAdminId(userId)) {
      throw new ConvexError("Remove this user from ADMIN_USER_IDS first.");
    }
    const target = await ctx.db.get("users", userId);
    if (!target) throw new ConvexError("User not found");
    const expected = (target.email ?? target._id).trim().toLowerCase();
    if (confirmEmail.trim().toLowerCase() !== expected) {
      throw new ConvexError("Confirmation doesn't match the user's email.");
    }
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (
      sub?.subscriptionId &&
      (sub.status === "active" || sub.status === "trialing")
    ) {
      throw new ConvexError(
        "This user has a live Stripe subscription — cancel it in Stripe first.",
      );
    }
    await audit(ctx, admin._id, "delete_user", { targetUserId: userId });
    await deleteUserIdentity(ctx, userId);
    return null;
  },
});

/** Start one of the background cleanups (counts come from the snapshot). */
export const startCleanup = mutation({
  args: {
    kind: v.union(
      v.literal("test_users"),
      v.literal("test_sessions"),
      v.literal("orphaned_auth"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { kind }) => {
    const admin = await requireAdmin(ctx);
    if (kind === "test_users") {
      await audit(ctx, admin._id, "cleanup_test_users");
      await ctx.scheduler.runAfter(0, internal.admin.sweepTestUsers, {
        cursor: null,
        deleted: 0,
      });
    } else if (kind === "test_sessions") {
      await audit(ctx, admin._id, "cleanup_test_sessions");
      await ctx.scheduler.runAfter(0, internal.admin.sweepTestSessions, {
        cursor: null,
        deleted: 0,
      });
    } else {
      await audit(ctx, admin._id, "cleanup_orphaned_auth");
      await ctx.scheduler.runAfter(0, internal.admin.sweepOrphanedAuth, {
        table: "authAccounts",
        cursor: null,
        deleted: 0,
      });
    }
    return null;
  },
});

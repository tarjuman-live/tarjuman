/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SECRET = "x".repeat(40);

type T = ReturnType<typeof convexTest>;

async function makeUser(
  t: T,
  email: string,
  opts: { verified?: boolean } = {},
): Promise<Id<"users">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      email,
      name: email.split("@")[0],
      ...(opts.verified ? { emailVerificationTime: Date.now() } : {}),
    }),
  );
}

/** Convex Auth puts `userId|sessionId` in the JWT subject. */
function as(t: T, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|session-${userId}` });
}

async function makeSession(
  t: T,
  userId: Id<"users">,
  segments: number,
): Promise<Id<"sessions">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const sessionId = await ctx.db.insert("sessions", {
      userId,
      sourceLanguage: "ar",
      targetLanguage: "en",
      status: "completed",
      segments: [],
      segmentCount: segments,
      duration: 60,
      createdAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < segments; i++) {
      await ctx.db.insert("transcriptSegments", {
        sessionId,
        segId: `seg-${i}`,
        sourceText: "نص",
        translatedText: "text",
        timestamp: i,
      });
    }
    return sessionId;
  });
}

let t: T;
let adminId: Id<"users">;
let userId: Id<"users">;

beforeEach(async () => {
  t = convexTest(schema, modules);
  adminId = await makeUser(t, "owner@gmail.com", { verified: true });
  userId = await makeUser(t, "someone@example.org");
  vi.stubEnv("ADMIN_USER_IDS", adminId);
  vi.stubEnv("USAGE_INGEST_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("admin gate", () => {
  it("flags only allow-listed ids as admin in users.me", async () => {
    expect((await as(t, adminId).query(api.users.me, {}))?.isAdmin).toBe(true);
    expect((await as(t, userId).query(api.users.me, {}))?.isAdmin).toBe(false);
  });

  it("rejects signed-out callers and non-admins on every admin function", async () => {
    await expect(t.query(api.adminPanel.getSnapshot, {})).rejects.toThrow(/Not authorized/);
    const u = as(t, userId);
    await expect(u.query(api.adminPanel.getSnapshot, {})).rejects.toThrow(/Not authorized/);
    await expect(u.query(api.adminPanel.getSystemInfo, {})).rejects.toThrow(/Not authorized/);
    await expect(
      u.query(api.adminPanel.listUsers, {
        paginationOpts: { numItems: 10, cursor: null },
        sort: "newest",
      }),
    ).rejects.toThrow(/Not authorized/);
    await expect(u.mutation(api.adminPanel.grantPro, { userId })).rejects.toThrow(
      /Not authorized/,
    );
    await expect(
      u.mutation(api.adminPanel.deleteUser, { userId: adminId, confirmEmail: "owner@gmail.com" }),
    ).rejects.toThrow(/Not authorized/);
    await expect(u.action(api.adminStats.refreshNow, {})).rejects.toThrow(/Not authorized/);
  });

  it("rejects a look-alike account that carries the owner's VERIFIED email", async () => {
    // The password-reset flow can stamp emailVerificationTime on a second row
    // with the owner's address — which is exactly why the gate is by id.
    const lookalike = await makeUser(t, "owner@gmail.com", { verified: true });
    await expect(
      as(t, lookalike).query(api.adminPanel.getSnapshot, {}),
    ).rejects.toThrow(/Not authorized/);
    expect((await as(t, lookalike).query(api.users.me, {}))?.isAdmin).toBe(false);
  });

  it("lets the admin in", async () => {
    const res = await as(t, adminId).query(api.adminPanel.getSnapshot, {});
    expect(res.snapshot).toBeNull();
  });

  it("fails closed when ADMIN_USER_IDS is unset", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    await expect(
      as(t, adminId).query(api.adminPanel.getSnapshot, {}),
    ).rejects.toThrow(/Not authorized/);
  });
});

describe("complimentary Pro", () => {
  it("grants and revokes Pro through the effective plan", async () => {
    const admin = as(t, adminId);
    const user = as(t, userId);
    expect((await user.query(api.subscriptions.getMyUsageThisMonth, {}))?.plan).toBe("free");

    await admin.mutation(api.adminPanel.grantPro, { userId, note: "sheikh" });
    expect((await user.query(api.subscriptions.getMyUsageThisMonth, {}))?.plan).toBe("pro");
    const sub = await user.query(api.subscriptions.getMySubscription, {});
    expect(sub).toMatchObject({ plan: "pro", comped: true, compExpiresAt: null });

    await admin.mutation(api.adminPanel.revokePro, { userId });
    expect((await user.query(api.subscriptions.getMyUsageThisMonth, {}))?.plan).toBe("free");
    await expect(admin.mutation(api.adminPanel.revokePro, { userId })).rejects.toThrow(
      /No active/,
    );

    const audit = await t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(audit.map((a) => a.action)).toEqual(["grant_pro", "revoke_pro"]);
  });

  it("expires a timed grant via the scheduled job", async () => {
    vi.useFakeTimers();
    const admin = as(t, adminId);
    const user = as(t, userId);
    await admin.mutation(api.adminPanel.grantPro, {
      userId,
      expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000,
    });
    expect((await user.query(api.subscriptions.getMyUsageThisMonth, {}))?.plan).toBe("pro");

    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await user.query(api.subscriptions.getMyUsageThisMonth, {}))?.plan).toBe("free");
    const grants = await t.run((ctx) => ctx.db.query("planGrants").collect());
    expect(grants[0].expiredAt).toBeDefined();
  });

  it("rejects an expiry in the past", async () => {
    await expect(
      as(t, adminId).mutation(api.adminPanel.grantPro, { userId, expiresAt: Date.now() - 1 }),
    ).rejects.toThrow(/future/);
  });
});

describe("deletion cascade", () => {
  it("admin deleteUser purges sessions AND transcript rows across batches", async () => {
    vi.useFakeTimers();
    await makeSession(t, userId, 1200); // > one 1000-row batch
    await makeSession(t, userId, 5);
    await t.run((ctx) =>
      ctx.db.insert("userPreferences", { userId, ttsEnabled: true }),
    );

    const admin = as(t, adminId);
    await expect(
      admin.mutation(api.adminPanel.deleteUser, { userId, confirmEmail: "wrong@x.com" }),
    ).rejects.toThrow(/doesn't match/);

    await admin.mutation(api.adminPanel.deleteUser, {
      userId,
      confirmEmail: "  SOMEONE@example.org ",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const left = await t.run(async (ctx) => ({
      user: await ctx.db.get(userId),
      sessions: (await ctx.db.query("sessions").collect()).length,
      segments: (await ctx.db.query("transcriptSegments").collect()).length,
      prefs: (await ctx.db.query("userPreferences").collect()).length,
    }));
    expect(left).toEqual({ user: null, sessions: 0, segments: 0, prefs: 0 });
  });

  it("self-serve deleteAccount also purges transcript rows", async () => {
    vi.useFakeTimers();
    await makeSession(t, userId, 30);
    await as(t, userId).mutation(api.users.deleteAccount, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const segments = await t.run((ctx) => ctx.db.query("transcriptSegments").collect());
    expect(segments).toHaveLength(0);
  });

  it("refuses to delete yourself or a user with a live Stripe subscription", async () => {
    const admin = as(t, adminId);
    await expect(
      admin.mutation(api.adminPanel.deleteUser, {
        userId: adminId,
        confirmEmail: "owner@gmail.com",
      }),
    ).rejects.toThrow(/own account/);

    await t.run((ctx) =>
      ctx.db.insert("subscriptions", {
        userId,
        stripeCustomerId: "cus_1",
        subscriptionId: "sub_1",
        plan: "pro",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      admin.mutation(api.adminPanel.deleteUser, {
        userId,
        confirmEmail: "someone@example.org",
      }),
    ).rejects.toThrow(/Stripe/);
  });

  it("the purge job refuses to touch a user that still exists", async () => {
    await makeSession(t, userId, 3);
    await t.mutation(internal.userData.purgeUserData, { userId });
    const segments = await t.run((ctx) => ctx.db.query("transcriptSegments").collect());
    expect(segments).toHaveLength(3);
  });
});

describe("usage ingest", () => {
  const event = {
    kind: "translate" as const,
    model: "claude-haiku-4-5-20251001",
    inputTokens: 100,
    outputTokens: 50,
    costMicroUsd: 350,
    ok: true,
  };

  it("rejects a wrong secret", async () => {
    await expect(
      t.mutation(api.usage.ingest, { secret: "nope", events: [event] }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("records raw events and folds them into the daily + monthly rollups", async () => {
    await t.mutation(api.usage.ingest, {
      secret: SECRET,
      events: [
        { ...event, userId },
        { ...event, userId, ok: false, status: 400, error: "Your credit balance is too low" },
      ],
    });
    const state = await t.run(async (ctx) => ({
      raw: await ctx.db.query("usageEvents").collect(),
      daily: await ctx.db.query("usageDaily").collect(),
      monthly: await ctx.db.query("usageUserMonthly").collect(),
    }));
    expect(state.raw).toHaveLength(2);
    expect(state.daily).toHaveLength(1);
    expect(state.daily[0]).toMatchObject({ calls: 2, errors: 1, costMicroUsd: 700, inputTokens: 200 });
    expect(state.monthly[0]).toMatchObject({ userId, calls: 2, costMicroUsd: 700 });
  });

  it("caps client-reported STT errors per user per hour", async () => {
    const u = as(t, userId);
    for (let i = 0; i < 25; i++) {
      await u.mutation(api.usage.reportClientEvent, {
        provider: "speechmatics",
        code: "quota_exceeded",
      });
    }
    const rows = await t.run((ctx) => ctx.db.query("usageEvents").collect());
    expect(rows).toHaveLength(20);
    expect(rows[0]).toMatchObject({ kind: "stt_error", ok: false, userId });
  });
});

describe("admin transcript access is audited", () => {
  it("openSessionForAdmin returns table-backed segments and writes an audit row", async () => {
    const sessionId = await makeSession(t, userId, 4);
    const res = await as(t, adminId).mutation(api.adminPanel.openSessionForAdmin, {
      sessionId,
    });
    expect(res?.segments).toHaveLength(4);
    expect(res?.owner?.email).toBe("someone@example.org");
    const audit = await t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "view_session", targetSessionId: sessionId });
  });
});

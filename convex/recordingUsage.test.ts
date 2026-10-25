/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { usageMonthKey } from "./billingLimits";

/**
 * The recordingUsage ledger behind the monthly hour allowance
 * (billingLimits.ts). It must count each recorded second exactly once and
 * never refund on delete — otherwise "record, copy, delete, repeat" beats the
 * meter.
 */

const modules = import.meta.glob("./**/*.ts");

// Typed against the schema (a bare ReturnType<typeof convexTest> erases it,
// so ctx.db.withIndex on recordingUsage wouldn't typecheck).
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

/** Convex Auth puts `userId|sessionId` in the JWT subject. */
function as(t: T, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|session-${userId}` });
}

async function ledgerSeconds(t: T, userId: Id<"users">): Promise<number> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("recordingUsage")
      .withIndex("by_userId_and_month", (q) => q.eq("userId", userId))
      .collect();
    return rows.reduce((sum, r) => sum + r.seconds, 0);
  });
}

async function startSession(t: T, userId: Id<"users">): Promise<Id<"sessions">> {
  return await as(t, userId).mutation(api.sessions.createSession, {
    sourceLanguage: "ar",
    targetLanguage: "en",
  });
}

let t: T;
let userId: Id<"users">;

beforeEach(async () => {
  t = makeT();
  userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "student@example.org", name: "student" }),
  );
});

describe("recording-time ledger", () => {
  it("completeSession books the duration to this month", async () => {
    const id = await startSession(t, userId);
    await as(t, userId).mutation(api.sessions.completeSession, { sessionId: id, duration: 1800 });
    expect(await ledgerSeconds(t, userId)).toBe(1800);
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("recordingUsage")
        .withIndex("by_userId_and_month", (q) =>
          q.eq("userId", userId).eq("month", usageMonthKey(Date.now())),
        )
        .unique(),
    );
    expect(row?.seconds).toBe(1800);
  });

  it("a repeated completeSession (Stop + exit-flush + replay) never double counts", async () => {
    const id = await startSession(t, userId);
    await as(t, userId).mutation(api.sessions.completeSession, { sessionId: id, duration: 600 });
    await as(t, userId).mutation(api.sessions.completeSession, { sessionId: id, duration: 600 });
    expect(await ledgerSeconds(t, userId)).toBe(600);
    // A later call with a longer duration adds only the difference…
    await as(t, userId).mutation(api.sessions.completeSession, { sessionId: id, duration: 900 });
    expect(await ledgerSeconds(t, userId)).toBe(900);
    // …and a stale, shorter one adds nothing.
    await as(t, userId).mutation(api.sessions.completeSession, { sessionId: id, duration: 300 });
    expect(await ledgerSeconds(t, userId)).toBe(900);
  });

  it("sessions accumulate in one row per user-month", async () => {
    for (const d of [1200, 1500]) {
      const id = await startSession(t, userId);
      await as(t, userId).mutation(api.sessions.completeSession, { sessionId: id, duration: d });
    }
    expect(await ledgerSeconds(t, userId)).toBe(2700);
    const rows = await t.run(async (ctx) => ctx.db.query("recordingUsage").collect());
    expect(rows).toHaveLength(1);
  });

  it("deleting a session does not refund its hours", async () => {
    const id = await startSession(t, userId);
    await as(t, userId).mutation(api.sessions.completeSession, { sessionId: id, duration: 3000 });
    await as(t, userId).mutation(api.sessions.deleteSession, { sessionId: id });
    expect(await ledgerSeconds(t, userId)).toBe(3000);
  });

  it("the stale-session sweep meters an abandoned recording", async () => {
    const id = await t.run(async (ctx) => {
      const now = Date.now() - 7 * 60 * 60 * 1000;
      const sessionId = await ctx.db.insert("sessions", {
        userId,
        sourceLanguage: "ar",
        targetLanguage: "en",
        status: "recording",
        segments: [],
        segmentCount: 1,
        duration: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("transcriptSegments", {
        sessionId,
        segId: "seg-0",
        sourceText: "نص",
        translatedText: "text",
        timestamp: 1234,
      });
      return sessionId;
    });
    await t.mutation(internal.sessions.sweepStaleSessions, {});
    expect(await ledgerSeconds(t, userId)).toBe(1234);
    const s = await t.run(async (ctx) => ctx.db.get(id));
    expect(s?.status).toBe("completed");
    expect(s?.meteredSeconds).toBe(1234);
  });

  it("the usage query reports everyone unlimited while billing is off", async () => {
    const id = await startSession(t, userId);
    await as(t, userId).mutation(api.sessions.completeSession, { sessionId: id, duration: 5 * 3600 });
    const usage = await as(t, userId).query(api.subscriptions.getMyUsageThisMonth, {});
    expect(usage?.canStartSession).toBe(true);
    expect(usage?.recordingSecondsLimit).toBeNull();
  });

  it("account deletion removes the user's ledger rows", async () => {
    const id = await startSession(t, userId);
    await as(t, userId).mutation(api.sessions.completeSession, { sessionId: id, duration: 60 });
    await as(t, userId).mutation(api.users.deleteAccount, {});
    const rows = await t.run(async (ctx) => ctx.db.query("recordingUsage").collect());
    expect(rows).toHaveLength(0);
  });
});

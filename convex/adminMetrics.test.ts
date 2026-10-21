import { describe, expect, it } from "vitest";
import {
  computeAi,
  computeDashboard,
  computeHealth,
  computeUserStats,
  sessionSeconds,
  type DashboardInput,
  type SessionRow,
  type UsageDayRow,
} from "./adminMetrics";
import { dayKey, lastDayKeys, startOfDay, weekdayHour } from "./reporting";
import { isAdminId, parseAdminIds } from "./adminAuth";

const H = 60 * 60 * 1000;
const D = 24 * H;
// Wed 2026-10-21 12:00 UTC = 15:00 Makkah time.
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

function session(p: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    userId: "u1",
    createdAt: NOW - H,
    updatedAt: NOW - H + 60_000,
    status: "completed",
    durationSec: 600,
    segmentCount: 10,
    legacyInline: false,
    sourceLanguage: "ar",
    targetLanguage: "en",
    hasSummary: false,
    summaryGeneratedAt: null,
    platform: "web",
    isTestTitle: false,
    ...p,
  };
}

function baseInput(over: Partial<DashboardInput> = {}): DashboardInput {
  return {
    now: NOW,
    users: [
      { id: "u1", createdAt: NOW - 2 * D, email: "a@x.com", isTest: false },
      { id: "u2", createdAt: NOW - 20 * D, email: "b@x.com", isTest: false },
      { id: "team", createdAt: NOW - 100 * D, email: "me@x.com", isTest: false },
      { id: "t1", createdAt: NOW - D, email: "lens-1@example.com", isTest: true },
    ],
    accounts: [
      { userId: "u1", provider: "google" },
      { userId: "u2", provider: "password" },
      { userId: "team", provider: "google" },
      { userId: "team", provider: "password" },
      { userId: "ghost", provider: "google" }, // orphaned auth row
    ],
    sessions: [
      session({ id: "s1", userId: "u1", hasSummary: true, summaryGeneratedAt: NOW - 30 * 60_000 }),
      session({ id: "s2", userId: "u2", createdAt: NOW - 10 * D, updatedAt: NOW - 10 * D, durationSec: 3 * 3600, sourceLanguage: "ur", platform: "ios" }),
      session({ id: "s3", userId: "team", durationSec: 120 }),
      session({ id: "phantom", userId: "u1", segmentCount: 0, durationSec: 0, status: "recording" }),
      session({ id: "orphan", userId: "deleted-user" }),
      session({ id: "ownerless", userId: null }),
      session({ id: "testsess", userId: "t1" }),
      session({ id: "stuck", userId: "u2", status: "recording", createdAt: NOW - 9 * H, updatedAt: NOW - 8 * H, durationSec: 0 }),
    ],
    subs: [
      { userId: "u2", status: "active", plan: "pro", priceId: "price_annual", cancelAtPeriodEnd: true },
    ],
    grants: [{ userId: "u1", active: true }],
    prefs: [{ userId: "u1", mainSpeakerOnly: true, ttsEnabled: false }],
    authSessions: [
      { userId: "u1", createdAt: NOW - D, expirationTime: NOW + D },
      { userId: "u2", createdAt: NOW - 40 * D, expirationTime: NOW - 10 * D },
    ],
    usageDays: [],
    teamIds: ["team"],
    annualPriceId: "price_annual",
    proMonthlyUsd: 10,
    proAnnualPerMonthUsd: 7,
    ...over,
  };
}

describe("reporting calendar (Makkah time, UTC+3)", () => {
  it("buckets late-evening UTC into the next local day", () => {
    // 2026-10-21 22:30 UTC = 2026-10-22 01:30 in Makkah.
    expect(dayKey(Date.UTC(2026, 9, 21, 22, 30))).toBe("2026-10-22");
    expect(dayKey(Date.UTC(2026, 9, 21, 20, 59))).toBe("2026-10-21");
  });

  it("finds local midnight and weekday/hour", () => {
    expect(startOfDay(NOW)).toBe(Date.UTC(2026, 9, 20, 21, 0, 0));
    expect(weekdayHour(NOW)).toEqual({ weekday: 3, hour: 15 }); // Wed 15:00
  });

  it("lists N day keys oldest-first ending today", () => {
    const keys = lastDayKeys(NOW, 3);
    expect(keys).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
  });
});

describe("sessionSeconds", () => {
  it("uses the client duration when present", () => {
    expect(sessionSeconds({ durationSec: 90, createdAt: 0, updatedAt: 999_999 })).toBe(90);
  });
  it("estimates in-progress sessions from timestamps, capped at 6h", () => {
    expect(sessionSeconds({ durationSec: 0, createdAt: 0, updatedAt: 120_000 })).toBe(120);
    expect(sessionSeconds({ durationSec: 0, createdAt: 0, updatedAt: 10 * H })).toBe(6 * 3600);
  });
});

describe("computeDashboard", () => {
  const dash = computeDashboard(baseInput());

  it("excludes test accounts everywhere, and the team only from `external`", () => {
    expect(dash.everyone.kpis.users.total).toBe(3); // u1, u2, team (not t1)
    expect(dash.external.kpis.users.total).toBe(2);
    expect(dash.everyone.funnel.signedUp).toBe(3);
  });

  it("counts only real sessions (owned by a real user, ≥1 segment)", () => {
    // s1, s2, s3, stuck → 4 (phantom, orphan, ownerless, test excluded)
    expect(dash.everyone.kpis.sessions.total).toBe(4);
    expect(dash.external.kpis.sessions.total).toBe(3); // minus team's s3
  });

  it("windows activity and computes deltas against the prior period", () => {
    const k = dash.everyone.kpis;
    expect(k.sessions.d7).toBe(3); // s1, s3, stuck (s2 was 10 days ago)
    expect(k.sessions.prev7).toBe(1); // s2
    expect(k.activeUsers.d7).toBe(3); // u1, team, u2(stuck)
    expect(k.activeUsers.d30).toBe(3);
    expect(k.users.d7).toBe(1); // u1 signed up 2 days ago
    expect(k.users.d30).toBe(2); // + u2
    expect(k.summaries.today).toBe(1);
  });

  it("builds a 90-day series with signups on the right day", () => {
    expect(dash.days).toHaveLength(90);
    const idx = dash.days.indexOf(dayKey(NOW - 2 * D));
    expect(dash.everyone.series.signups[idx]).toBe(1);
    // Cumulative ends at the total.
    expect(dash.everyone.series.cumulativeUsers.at(-1)).toBe(3);
  });

  it("produces language, platform, provider and length breakdowns", () => {
    const b = dash.everyone.breakdowns;
    expect(b.languagePairs[0]).toMatchObject({ label: "ar→en", sessions: 3 });
    expect(b.sourceLanguages.map((x) => x.label)).toContain("ur");
    expect(b.platforms).toEqual({ web: 3, ios: 1, unknown: 0 });
    expect(b.providers).toEqual({ google: 1, password: 1, both: 1, none: 0 });
    const histTotal = b.lengthHistogram.reduce((s, x) => s + x.count, 0);
    expect(histTotal).toBe(4);
    expect(b.lengthHistogram.find((x) => x.label === "2 h +")?.count).toBe(1);
    expect(b.heatmap.flat().reduce((s, x) => s + x, 0)).toBe(4);
  });

  it("computes funnel and revenue (annual price → $7/mo; comp not double-counted)", () => {
    const f = dash.everyone.funnel;
    expect(f.recorded1).toBe(3);
    expect(f.summarized).toBe(1);
    expect(f.pro).toBe(2); // u2 paid + u1 comped
    const r = dash.everyone.revenue;
    expect(r.paidPro).toBe(1);
    expect(r.annualSubs).toBe(1);
    expect(r.mrrUsd).toBe(7);
    expect(r.comped).toBe(1);
    expect(r.canceling).toBe(1);
  });

  it("counts live signed-in devices (unexpired auth sessions only)", () => {
    expect(dash.everyone.kpis.liveDevices).toBe(1);
  });
});

describe("computeHealth", () => {
  it("reports the rows the product metrics excluded", () => {
    const h = computeHealth(baseInput());
    expect(h.phantomSessions).toBe(1);
    expect(h.stuckRecordings).toBe(1);
    expect(h.orphanSessions).toBe(1);
    expect(h.ownerlessSessions).toBe(1);
    expect(h.testUsers).toBe(1);
    expect(h.testSessions).toBe(1);
    expect(h.orphanAuthAccounts).toBe(1);
    expect(h.orphanAuthSessions).toBe(0);
  });
});

describe("computeUserStats", () => {
  it("rolls up real sessions per user", () => {
    const stats = computeUserStats(baseInput());
    expect(stats.get("u1")).toMatchObject({ sessions: 1, summaries: 1, platforms: ["web"] });
    expect(stats.get("u2")?.sessions).toBe(2);
    expect(stats.has("deleted-user")).toBe(false);
  });
});

describe("computeAi", () => {
  const days = lastDayKeys(NOW, 90);
  const row = (p: Partial<UsageDayRow>): UsageDayRow => ({
    day: days[89],
    kind: "translate",
    model: "claude-haiku-4-5-20251001",
    calls: 10,
    errors: 1,
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costMicroUsd: 3500,
    unpricedCalls: 0,
    ...p,
  });

  it("sums windows, splits by feature and model, keeps STT separate", () => {
    const ai = computeAi(
      [
        row({}),
        row({ kind: "summarize", model: "claude-sonnet-5", calls: 2, errors: 0, costMicroUsd: 20_000 }),
        row({ day: days[80], calls: 5, costMicroUsd: 1000 }),
        row({ day: days[40], calls: 5, costMicroUsd: 1000 }),
        row({ kind: "stt_token", model: "", calls: 7, errors: 0, costMicroUsd: 0 }),
      ],
      days,
    );
    expect(ai.today.calls).toBe(12);
    expect(ai.today.costMicroUsd).toBe(23_500);
    expect(ai.d30.calls).toBe(17);
    expect(ai.d90.calls).toBe(22);
    expect(ai.byKind30[0].kind).toBe("summarize"); // highest cost first
    expect(ai.byModel30.map((m) => m.model)).toEqual([
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ]);
    expect(ai.sttTokens30).toBe(7);
    expect(ai.costByDay[89].byKind.summarize).toBe(20_000);
    expect(ai.callsByDay[89]).toBe(12);
  });
});

describe("admin allowlist", () => {
  it("parses ids, trimming blanks", () => {
    expect([...parseAdminIds(" a , ,b ")]).toEqual(["a", "b"]);
  });
  it("fails closed when unset and never matches a non-listed id", () => {
    expect(isAdminId("a", undefined)).toBe(false);
    expect(isAdminId("a", "")).toBe(false);
    expect(isAdminId("c", "a,b")).toBe(false);
    expect(isAdminId(null, "a")).toBe(false);
    expect(isAdminId("b", "a, b")).toBe(true);
  });
});

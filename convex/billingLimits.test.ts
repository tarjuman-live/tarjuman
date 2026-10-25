import { describe, expect, it } from "vitest";
import {
  PLAN_LIMITS,
  PLAN_META,
  buildUsage,
  formatRecordingTime,
  nextMonthStartMs,
  recordingLimitMessage,
  usageMonthKey,
} from "./billingLimits";

const HOUR = 3600;

describe("plan config", () => {
  it("prices and monthly recording hours match the tiers", () => {
    expect(PLAN_META.pro.priceMonthly).toBe(5);
    expect(PLAN_META.pro.priceLabel).toBe("$5 / month");
    expect(PLAN_META.scholar.priceMonthly).toBe(10);
    expect(PLAN_META.scholar.priceLabel).toBe("$10 / month");
    expect(PLAN_LIMITS.free.recordingHoursPerMonth).toBe(1);
    expect(PLAN_LIMITS.pro.recordingHoursPerMonth).toBe(3);
    expect(PLAN_LIMITS.scholar.recordingHoursPerMonth).toBe(4);
  });

  it("pricing copy is derived from the limits, with no leftover unlimited-length claims", () => {
    expect(PLAN_META.free.highlights).toContain("1 hour of recording a month");
    expect(PLAN_META.pro.highlights).toContain("3 hours of recording a month");
    expect(PLAN_META.scholar.highlights).toContain("4 hours of recording a month");
    const all = Object.values(PLAN_META).flatMap((m) => [m.tagline, ...m.highlights]);
    for (const line of all) {
      expect(line).not.toMatch(/unlimited recording|unlimited sessions|sessions per month|up to 2 hours/i);
    }
  });

  it("Free no longer caps sessions; hours are the one meter", () => {
    expect(PLAN_LIMITS.free.sessionsPerMonth).toBe(Infinity);
    expect(PLAN_LIMITS.free.summariesPerMonth).toBe(4);
  });
});

describe("formatRecordingTime", () => {
  it("formats whole minutes, flooring partials", () => {
    expect(formatRecordingTime(0)).toBe("0m");
    expect(formatRecordingTime(59)).toBe("0m");
    expect(formatRecordingTime(45 * 60)).toBe("45m");
    expect(formatRecordingTime(HOUR)).toBe("1h");
    expect(formatRecordingTime(2 * HOUR + 15 * 60 + 30)).toBe("2h 15m");
    expect(formatRecordingTime(-10)).toBe("0m");
  });
});

describe("month helpers", () => {
  it("keys and resets on UTC calendar months", () => {
    const oct31Late = Date.UTC(2026, 9, 31, 23, 59);
    expect(usageMonthKey(oct31Late)).toBe("2026-10");
    expect(nextMonthStartMs(oct31Late)).toBe(Date.UTC(2026, 10, 1));
    expect(usageMonthKey(Date.UTC(2026, 11, 15))).toBe("2026-12");
    expect(nextMonthStartMs(Date.UTC(2026, 11, 15))).toBe(Date.UTC(2027, 0, 1));
  });
});

describe("buildUsage", () => {
  const base = { sessionsUsed: 0, summariesUsed: 0, recordingSecondsUsed: 0 };

  it("billing off → everyone unlimited, no meters", () => {
    const u = buildUsage({ ...base, plan: "free", billingEnabled: false, recordingSecondsUsed: 99 * HOUR });
    expect(u.canStartSession).toBe(true);
    expect(u.canSummarize).toBe(true);
    expect(u.recordingSecondsLimit).toBeNull();
    expect(u.recordingSecondsRemaining).toBeNull();
    expect(u.summariesLimit).toBeNull();
    expect(u.sessionsLimit).toBeNull();
  });

  it("free under the hour can record, and shows what's left", () => {
    const u = buildUsage({ ...base, plan: "free", billingEnabled: true, recordingSecondsUsed: 40 * 60 });
    expect(u.canStartSession).toBe(true);
    expect(u.recordingSecondsLimit).toBe(HOUR);
    expect(u.recordingSecondsRemaining).toBe(20 * 60);
    expect(u.summariesLimit).toBe(4);
    expect(u.sessionsLimit).toBeNull();
  });

  it("free at or over the hour is blocked, remaining clamps to 0", () => {
    expect(buildUsage({ ...base, plan: "free", billingEnabled: true, recordingSecondsUsed: HOUR }).canStartSession).toBe(false);
    const over = buildUsage({ ...base, plan: "free", billingEnabled: true, recordingSecondsUsed: HOUR + 500 });
    expect(over.canStartSession).toBe(false);
    expect(over.recordingSecondsRemaining).toBe(0);
  });

  it("pro is metered at 3h with unlimited summaries", () => {
    const u = buildUsage({ ...base, plan: "pro", billingEnabled: true, recordingSecondsUsed: 2 * HOUR, summariesUsed: 50 });
    expect(u.recordingSecondsLimit).toBe(3 * HOUR);
    expect(u.recordingSecondsRemaining).toBe(HOUR);
    expect(u.canStartSession).toBe(true);
    expect(u.summariesLimit).toBeNull();
    expect(u.canSummarize).toBe(true);
    expect(buildUsage({ ...base, plan: "pro", billingEnabled: true, recordingSecondsUsed: 3 * HOUR }).canStartSession).toBe(false);
  });

  it("free summary cap still applies", () => {
    expect(buildUsage({ ...base, plan: "free", billingEnabled: true, summariesUsed: 4 }).canSummarize).toBe(false);
  });
});

describe("recordingLimitMessage", () => {
  it("points Free at Pro and gives Pro the reset date", () => {
    const now = Date.UTC(2026, 9, 21);
    expect(recordingLimitMessage("free", now)).toBe(
      "You've used your 1 hour of recording this month. Upgrade to Tarjuman Pro for 3 hours a month.",
    );
    expect(recordingLimitMessage("pro", now)).toBe(
      "You've used your 3 hours of recording this month. It resets on Nov 1.",
    );
  });
});

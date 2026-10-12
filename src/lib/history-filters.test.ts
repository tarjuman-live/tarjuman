import { describe, expect, it } from "vitest";
import {
  NO_FILTERS,
  applyHistoryFilters,
  dateFloor,
  filtersActive,
  languagePairs,
  pairKey,
  type FilterableSession,
} from "./history-filters";

const NOW = new Date(2026, 9, 12, 15, 0, 0).getTime(); // Oct 12 2026, 15:00 local
const DAY = 24 * 60 * 60 * 1000;

const s = (o: Partial<FilterableSession> & { id: string }): FilterableSession & { id: string } => ({
  sourceLanguage: "ar",
  targetLanguage: "en",
  duration: 600,
  createdAt: NOW - DAY * 2,
  ...o,
});

const sessions = [
  s({ id: "today", createdAt: NOW - 60 * 60 * 1000, duration: 20 }),
  s({ id: "yesterday-late", createdAt: new Date(2026, 9, 11, 23, 30).getTime(), duration: 2400, summary: "x" }),
  s({ id: "fr-week", targetLanguage: "fr", createdAt: NOW - DAY * 5, duration: 300 }),
  s({ id: "month", createdAt: NOW - DAY * 20, duration: 1800, summary: "  " }),
  s({ id: "old", targetLanguage: "fr", createdAt: NOW - DAY * 60, duration: 3600, summary: "notes" }),
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("history filters", () => {
  it("no filters → everything, and filtersActive is false", () => {
    expect(filtersActive(NO_FILTERS)).toBe(false);
    expect(ids(applyHistoryFilters(sessions, NO_FILTERS, NOW))).toEqual(ids(sessions));
  });

  it("today is the local calendar day, not the last 24h", () => {
    expect(dateFloor("today", NOW)).toBe(new Date(2026, 9, 12).getTime());
    expect(ids(applyHistoryFilters(sessions, { ...NO_FILTERS, date: "today" }, NOW))).toEqual(["today"]);
  });

  it("week / month are rolling windows", () => {
    expect(ids(applyHistoryFilters(sessions, { ...NO_FILTERS, date: "week" }, NOW))).toEqual([
      "today",
      "yesterday-late",
      "fr-week",
    ]);
    expect(ids(applyHistoryFilters(sessions, { ...NO_FILTERS, date: "month" }, NOW))).toEqual([
      "today",
      "yesterday-late",
      "fr-week",
      "month",
    ]);
  });

  it("length buckets: <5 min, 5–30 min inclusive, >30 min", () => {
    const by = (length: "short" | "medium" | "long") =>
      ids(applyHistoryFilters(sessions, { ...NO_FILTERS, length }, NOW));
    expect(by("short")).toEqual(["today"]);
    expect(by("medium")).toEqual(["fr-week", "month"]);
    expect(by("long")).toEqual(["yesterday-late", "old"]);
  });

  it("summarized ignores blank summaries", () => {
    expect(ids(applyHistoryFilters(sessions, { ...NO_FILTERS, summarized: true }, NOW))).toEqual([
      "yesterday-late",
      "old",
    ]);
  });

  it("filters combine with AND", () => {
    const f = { ...NO_FILTERS, pair: pairKey({ sourceLanguage: "ar", targetLanguage: "fr" }), date: "week" as const };
    expect(ids(applyHistoryFilters(sessions, f, NOW))).toEqual(["fr-week"]);
  });

  it("languagePairs lists used pairs, most-used then most-recent first", () => {
    expect(languagePairs(sessions)).toEqual([
      { key: "ar>en", source: "ar", target: "en", count: 3 },
      { key: "ar>fr", source: "ar", target: "fr", count: 2 },
    ]);
  });
});

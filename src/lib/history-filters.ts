/**
 * History filters — framework-free, so the native app (and the web history
 * page, if it adopts them) apply exactly the same rules.
 *
 * Every filter narrows; "any"/null/false means "don't filter on this". They
 * combine with AND, and with the free-text search applied by the caller.
 */

export type DateRange = "any" | "today" | "week" | "month";
export type LengthRange = "any" | "short" | "medium" | "long";

export interface HistoryFilters {
  date: DateRange;
  /** A "source>target" pair key (see pairKey), or null for all languages. */
  pair: string | null;
  length: LengthRange;
  /** Only sessions that already have an AI summary. */
  summarized: boolean;
}

export const NO_FILTERS: HistoryFilters = {
  date: "any",
  pair: null,
  length: "any",
  summarized: false,
};

/** Length buckets, in seconds: short < 5 min ≤ medium ≤ 30 min < long. */
export const SHORT_MAX_SEC = 5 * 60;
export const LONG_MIN_SEC = 30 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FilterableSession {
  sourceLanguage: string;
  targetLanguage: string;
  duration: number;
  summary?: string;
  createdAt: number;
}

export const pairKey = (s: { sourceLanguage: string; targetLanguage: string }) =>
  `${s.sourceLanguage}>${s.targetLanguage}`;

export function filtersActive(f: HistoryFilters): boolean {
  return f.date !== "any" || f.pair !== null || f.length !== "any" || f.summarized;
}

/** Earliest createdAt (ms) a date range admits; null for "any". */
export function dateFloor(range: DateRange, now: number): number | null {
  switch (range) {
    case "any":
      return null;
    case "today": {
      // Local calendar day, not "the last 24 hours".
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case "week":
      return now - 7 * DAY_MS;
    case "month":
      return now - 30 * DAY_MS;
  }
}

function inLength(range: LengthRange, sec: number): boolean {
  switch (range) {
    case "any":
      return true;
    case "short":
      return sec < SHORT_MAX_SEC;
    case "medium":
      return sec >= SHORT_MAX_SEC && sec <= LONG_MIN_SEC;
    case "long":
      return sec > LONG_MIN_SEC;
  }
}

export function applyHistoryFilters<T extends FilterableSession>(
  sessions: readonly T[],
  f: HistoryFilters,
  now: number = Date.now(),
): T[] {
  if (!filtersActive(f)) return sessions.slice();
  const floor = dateFloor(f.date, now);
  return sessions.filter(
    (s) =>
      (floor === null || s.createdAt >= floor) &&
      (f.pair === null || pairKey(s) === f.pair) &&
      inLength(f.length, s.duration) &&
      (!f.summarized || !!s.summary?.trim()),
  );
}

/**
 * The language pairs the user has actually recorded, most-used first (ties:
 * most recent first), so the Language filter only offers real choices.
 */
export function languagePairs(
  sessions: readonly FilterableSession[],
): { key: string; source: string; target: string; count: number }[] {
  const byKey = new Map<string, { key: string; source: string; target: string; count: number; last: number }>();
  for (const s of sessions) {
    const key = pairKey(s);
    const e = byKey.get(key);
    if (e) {
      e.count++;
      e.last = Math.max(e.last, s.createdAt);
    } else {
      byKey.set(key, { key, source: s.sourceLanguage, target: s.targetLanguage, count: 1, last: s.createdAt });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .map(({ key, source, target, count }) => ({ key, source, target, count }));
}

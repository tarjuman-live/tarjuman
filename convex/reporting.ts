/**
 * Reporting calendar for the admin dashboard — the ONE place that decides
 * which "day" a timestamp belongs to.
 *
 * Pure constants + pure helpers (no Convex imports) so the Convex functions,
 * the pure metrics module, and the web UI all bucket identically.
 *
 * Days are bucketed in Makkah time (Asia/Riyadh, UTC+3, no DST) because that is
 * the product's primary market: a Friday khutbah at 12:30 local lands on Friday,
 * not split across a UTC midnight. Riyadh has no daylight saving, so a fixed
 * offset is exact. To report in another zone, change the two constants below.
 */

export const REPORT_TZ_LABEL = "Makkah time (UTC+3)";
export const REPORT_TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" for the reporting-zone calendar day containing `ts`. */
export function dayKey(ts: number): string {
  return new Date(ts + REPORT_TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM" for the reporting-zone calendar month containing `ts`. */
export function monthKey(ts: number): string {
  return new Date(ts + REPORT_TZ_OFFSET_MS).toISOString().slice(0, 7);
}

/** Epoch ms of reporting-zone midnight at the start of the day containing `ts`. */
export function startOfDay(ts: number): number {
  const shifted = ts + REPORT_TZ_OFFSET_MS;
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - REPORT_TZ_OFFSET_MS;
}

/** Reporting-zone weekday (0 = Sunday … 6 = Saturday) and hour (0–23). */
export function weekdayHour(ts: number): { weekday: number; hour: number } {
  const d = new Date(ts + REPORT_TZ_OFFSET_MS);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
}

/** The last `n` day keys ending with the day containing `now`, oldest first. */
export function lastDayKeys(now: number, n: number): string[] {
  const today = startOfDay(now);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(dayKey(today - i * DAY_MS));
  return keys;
}

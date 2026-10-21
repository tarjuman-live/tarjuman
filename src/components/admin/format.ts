import { getLangName } from "@/lib/utils";

/**
 * Number / time formatting for the admin dashboard. Pure. English-only (the
 * admin area is an operator tool, not localized).
 */

/** 1,284 · 12.9K · 4.2M */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 10_000) return Math.round(n).toLocaleString("en-US");
  if (abs < 1_000_000) return `${(n / 1000).toFixed(abs < 100_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Seconds → "12.4 h" / "35 min" / "40 s" — for totals. */
export function hours(seconds: number): string {
  if (seconds >= 3600) {
    const h = seconds / 3600;
    return `${h >= 100 ? Math.round(h).toLocaleString("en-US") : h.toFixed(1)} h`;
  }
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds)} s`;
}

/** Seconds → "1h 05m" / "12m" / "45s" — for a single session. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function percent(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

/** "just now" · "3m ago" · "2h ago" · "5d ago" · "Oct 3" */
export function timeAgo(ts: number | null | undefined, now: number): string {
  if (!ts) return "—";
  const diff = Math.max(0, now - ts);
  if (diff < 45_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return shortDate(ts);
}

export function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function fullDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "2026-10-21" (reporting-zone day key) → "Oct 21" */
export function dayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Signed change vs. a previous period; null when there's no baseline. */
export function change(
  cur: number,
  prev: number,
): { ratio: number | null; dir: "up" | "down" | "flat" } {
  if (cur === prev) return { ratio: prev === 0 ? null : 0, dir: "flat" };
  const dir = cur > prev ? "up" : "down";
  return { ratio: prev === 0 ? null : (cur - prev) / prev, dir };
}

export function langName(code: string): string {
  return getLangName(code) || code;
}

/** "ar→en" → "Arabic → English" */
export function pairName(pair: string): string {
  const [a, b] = pair.split("→");
  return b ? `${langName(a)} → ${langName(b)}` : langName(pair);
}

/**
 * Human message from a failed Convex call. Admin mutations throw
 * `ConvexError("…")`, whose message survives to the client in `.data` (plain
 * `Error` messages are redacted in production).
 */
export function errorMessage(e: unknown, fallback = "Something went wrong."): string {
  if (e && typeof e === "object" && "data" in e) {
    const data = (e as { data: unknown }).data;
    if (typeof data === "string" && data) return data;
  }
  if (e instanceof Error && e.message) {
    // Strip Convex's "[CONVEX M(...)] [Request ID: …] Server Error" wrapper.
    const m = e.message.match(/Uncaught (?:ConvexError|Error): ([^\n]+)/);
    return m ? m[1] : e.message;
  }
  return fallback;
}

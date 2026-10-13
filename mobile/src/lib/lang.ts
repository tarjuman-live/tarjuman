import { LANGUAGES } from "@shared/constants";
import { RTL_LANGS } from "@shared/script";

export const langName = (code: string) =>
  LANGUAGES.find((l) => l.code === code)?.name ?? code;

export const isRtl = (code: string) =>
  RTL_LANGS.has(code) || LANGUAGES.some((l) => l.code === code && l.rtl);

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/**
 * Direction of free text (a session title), from its FIRST strong letter —
 * Hebrew / Arabic-script blocks are RTL. "حول سحب." must render as
 * ".حول سحب" (the period ends the sentence on the LEFT), which only happens
 * with writingDirection "rtl"; textAlign stays the caller's choice so a list
 * keeps one clean edge.
 */
export function textDirection(text: string): "rtl" | "ltr" {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x0590 && c <= 0x08ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) return "rtl";
    if (/\p{L}/u.test(ch)) return "ltr";
  }
  return "ltr";
}

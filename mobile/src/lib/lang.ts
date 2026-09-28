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

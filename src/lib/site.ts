/**
 * Single source of truth for site-wide identity + SEO copy. Reused by the root
 * metadata, sitemap, robots, the dynamic OG image, and JSON-LD structured data
 * so the brand name, URL, and description never drift between them.
 */

// Env-first so Vercel's NEXT_PUBLIC_APP_URL wins, but fall back to the real
// production domain (NOT localhost) so robots/sitemap/canonicals stay correct
// even if the env var is ever missing in a build.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://tarjuman.live"
).replace(/\/$/, "");

export const SITE_NAME = "Tarjuman";

/** ترجمان — "interpreter / translator" in Arabic. */
export const SITE_NAME_AR = "ترجمان";

export const SITE_TAGLINE = "Live Khutbah Transcription & Translation";

/** Used as the <title> default and og:title. ~52 chars — fits the SERP. */
export const SITE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

export const SITE_DESCRIPTION =
  "Tarjuman transcribes and translates khutbahs, lectures, and classes in real time — Arabic to English as it's spoken, with Islamic terminology preserved and an instant AI summary when you're done.";

/** Short variant for the manifest / social cards. */
export const SITE_DESCRIPTION_SHORT =
  "Real-time transcription and translation for khutbahs, lectures, and classes — with Islamic terminology preserved and instant AI summaries.";

// Niche-first keywords. Intentionally NOT chasing generic "transcription app";
// these long-tail terms match real intent and are winnable.
export const KEYWORDS = [
  "khutbah translation",
  "khutbah transcription",
  "translate khutbah to English",
  "live Arabic translation",
  "Arabic lecture transcription",
  "real-time Arabic to English",
  "Islamic lecture translator",
  "masjid lecture transcription",
  "live sermon translation",
  "khutbah notes app",
  "Quran lecture translation",
  "real-time speech translation",
];

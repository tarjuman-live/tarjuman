/**
 * Runtime endpoints. EXPO_PUBLIC_* values are inlined at bundle time from
 * mobile/.env.local (see .env.example).
 *
 * The app reuses the web app's backend wholesale: the same Convex deployment
 * and the same Next.js /api routes (Speechmatics JWT, translate, summarize),
 * so every auth / rate-limit / plan gate applies to native users unchanged.
 */
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("EXPO_PUBLIC_CONVEX_URL is not set — copy .env.example to .env.local");
}

export const CONVEX_URL = convexUrl;

/** Origin of the Next.js app whose /api routes the native client calls. */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? "https://tarjuman.live"
).replace(/\/$/, "");

export const apiUrl = (path: string) => `${API_URL}${path}`;

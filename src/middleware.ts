import { NextResponse, type NextRequest } from "next/server";

/**
 * Canonical-host redirect — fixes the Google sign-up → /login loop.
 *
 * Convex Auth rebuilds the OAuth redirect from SITE_URL (https://tarjuman.live).
 * If a sign-in STARTS on a non-canonical host (e.g. www.tarjuman.live or an
 * alias domain), the PKCE verifier is written to THAT origin's localStorage,
 * but the callback lands on the bare apex with no verifier → the token exchange
 * silently fails, isAuthenticated never flips, and the (app) guard bounces the
 * user back to /login. Forcing every request onto the single canonical apex
 * BEFORE any page renders keeps the verifier on one origin.
 *
 * Localhost and Vercel preview deploys are left alone — dev and previews must
 * not bounce to production.
 */
const CANONICAL = "tarjuman.live";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const bare = host.split(":")[0];

  const skip =
    bare === CANONICAL ||
    bare === "localhost" ||
    bare === "127.0.0.1" ||
    bare.endsWith(".vercel.app"); // preview deployments

  if (skip) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.host = CANONICAL;
  url.protocol = "https";
  url.port = "";
  return NextResponse.redirect(url, 308);
}

export const config = {
  // Run on pages + API + auth routes; skip Next internals + the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

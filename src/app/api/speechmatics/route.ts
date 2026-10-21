import { NextRequest, NextResponse } from "next/server";
import { recordUsageAfter } from "@/lib/usage/ingest";
import {
  requireAuthFromHeader,
  checkRateLimit,
  getUsageFromHeader,
} from "@/lib/api-auth";

/**
 * Mints a short-lived Speechmatics JWT so the browser can open the realtime
 * WebSocket directly without ever seeing SPEECHMATICS_API_KEY.
 *
 * THIS IS THE PRIMARY PRODUCTION STT CREDENTIAL ROUTE (see STT_PROVIDER in
 * lib/constants). Same trust model as the prod path in /api/deepgram: the
 * long-lived key stays on the server, the client gets a credential that expires
 * shortly after.
 *
 * Unlike /api/deepgram there is no loopback-proxy variant. That proxy exists
 * because some networks block the browser's TLS handshake to Deepgram; if the
 * same turns out to be true for Speechmatics on masjid wifi, the fix is to add
 * an equivalent proxy in server.js rather than to fall back silently.
 *
 * Docs: POST https://mp.speechmatics.com/v1/api_keys?type=rt  { ttl }
 *       → { key_value }
 */

const MP_URL = "https://mp.speechmatics.com/v1/api_keys?type=rt";

// Long enough to cover a full recording, short enough that a leaked token is
// near-worthless. Vendor range is 60–86400s.
//
// A session longer than this is NOT a problem: connect() re-fetches a fresh JWT
// on every attempt, including every backoff reconnect, so a 6-hour dars keeps
// minting new credentials rather than riding one expiring token.
const TTL_SECONDS = 3600;

// Global endpoint auto-routes to the nearest region. Override for data
// residency (eu.rt / us.rt) if that ever matters.
const RT_URL = "wss://global.rt.speechmatics.com/v2";

export async function POST(req: NextRequest) {
  const apiKey = process.env.SPEECHMATICS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "SPEECHMATICS_API_KEY is not configured. Add it to .env.local and restart the dev server.",
      },
      { status: 500 },
    );
  }

  const auth = await requireAuthFromHeader(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Sign in to transcribe." },
      { status: 401 },
    );
  }

  // "transcribe" — the same bucket /api/deepgram uses. There is no "deepgram"
  // key in LIMITS; because it is typed Record<string, …>, a wrong name is not a
  // type error, it's a TypeError at runtime that surfaces as an opaque HTML 500.
  const limit = checkRateLimit(auth.userId, "transcribe");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sessions started. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  // Plan cost gate — mirrors /api/deepgram exactly. Minting a credential is
  // what actually spends STT budget, so this must live on EVERY engine's
  // credential route: when Speechmatics became the primary engine, a gate that
  // existed only on the Deepgram route would silently stop gating anything.
  // Fail open if usage can't be read — the reactive UI is the primary gate.
  const usage = await getUsageFromHeader(req);
  if (usage && !usage.canStartSession) {
    return NextResponse.json(
      {
        error: `You've used all ${usage.sessionsLimit} free sessions this month. Upgrade to Tarjuman Pro for unlimited recording.`,
        code: "limit_reached",
      },
      { status: 402 },
    );
  }

  try {
    const res = await fetch(MP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        "[speechmatics] temp key request failed:",
        res.status,
        detail.slice(0, 300),
      );
      recordUsageAfter({
        userId: auth.userId,
        kind: "stt_token",
        provider: "speechmatics",
        ok: false,
        status: res.status,
        error: detail.slice(0, 200),
      });
      return NextResponse.json(
        {
          error:
            res.status === 401
              ? "Speechmatics rejected the API key (401). Check SPEECHMATICS_API_KEY."
              : `Speechmatics key request failed (${res.status}).`,
        },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { key_value?: string };
    if (!data.key_value) {
      return NextResponse.json(
        { error: "Speechmatics returned no key_value." },
        { status: 502 },
      );
    }

    // Credential mint (prewarm + every reconnect) — NOT a recording count.
    recordUsageAfter({
      userId: auth.userId,
      kind: "stt_token",
      provider: "speechmatics",
      ok: true,
    });
    return NextResponse.json({ jwt: data.key_value, url: RT_URL });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[speechmatics] could not issue session credentials:", msg);
    recordUsageAfter({
      userId: auth.userId,
      kind: "stt_token",
      provider: "speechmatics",
      ok: false,
      error: msg,
    });
    return NextResponse.json(
      { error: "Could not reach Speechmatics to start a session." },
      { status: 502 },
    );
  }
}

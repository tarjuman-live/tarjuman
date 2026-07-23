import { NextResponse } from "next/server";
import { isValidLangCode } from "@/lib/utils";
import {
  requireAuthFromHeader,
  checkRateLimit,
  getUsageFromHeader,
} from "@/lib/api-auth";

/**
 * Issues credentials for a browser → Deepgram realtime transcription session.
 *
 * Two modes, chosen by environment:
 *
 *   Dev (npm run dev): returns a single-use session token + a loopback WS URL
 *   pointing at our /api/deepgram-ws proxy (defined in server.js). The proxy
 *   authenticates with Deepgram server-side using the long-lived API key.
 *   This sidesteps networks where the browser can't reach wss://api.deepgram.com
 *   directly (firewall / ISP DPI / browser extension breaking the TLS handshake).
 *
 *   Prod (Vercel): server.js doesn't run on Vercel, so we mint a short-lived
 *   Deepgram temporary key via the Projects API and return the direct Deepgram
 *   WS URL. The browser opens the connection itself, passing the temp key as
 *   the `token` WebSocket subprotocol.
 */

interface SessionEntry {
  deepgramUrl: string;
  expiresAt: number;
}

declare global {
  var __deepgramSessionTokens: Map<string, SessionEntry> | undefined;
  // Set to true by server.js when the /api/deepgram-ws loopback proxy is live
  // in this process. Absent on Vercel (server.js never runs there) and under a
  // bare `next dev`/`next start` with no custom server.
  var __deepgramProxyReady: boolean | undefined;
}

function getSessions(): Map<string, SessionEntry> {
  if (!globalThis.__deepgramSessionTokens) {
    globalThis.__deepgramSessionTokens = new Map();
  }
  return globalThis.__deepgramSessionTokens;
}

// Token must be valid long enough for the user to start the recorder, but
// short enough that a leaked one is uninteresting. Browser opens the WS
// within ~100ms of receiving the token in practice.
const TOKEN_TTL_MS = 60_000;

function makeToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// The Deepgram project ID is stable for a given API key. Discover it once
// per serverless instance and reuse — saves a HTTP round-trip per session
// after the first one. DEEPGRAM_PROJECT_ID env var skips discovery entirely.
let cachedProjectId: string | null = null;

async function getDeepgramProjectId(apiKey: string): Promise<string> {
  if (process.env.DEEPGRAM_PROJECT_ID) return process.env.DEEPGRAM_PROJECT_ID;
  if (cachedProjectId) return cachedProjectId;
  const res = await fetch("https://api.deepgram.com/v1/projects", {
    headers: { Authorization: `Token ${apiKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    // Log the provider body server-side (Vercel logs) but don't echo it to the
    // client — it can carry account/project hints with no value to the caller.
    console.error(
      `[deepgram] /v1/projects ${res.status}: ${await res.text().catch(() => "")}`
    );
    throw new Error(`Deepgram /v1/projects returned ${res.status}`);
  }
  const body = (await res.json()) as { projects?: { project_id: string }[] };
  const projectId = body.projects?.[0]?.project_id;
  if (!projectId) throw new Error("Deepgram /v1/projects returned no projects");
  cachedProjectId = projectId;
  return projectId;
}

async function mintDeepgramTempKey(apiKey: string): Promise<string> {
  const projectId = await getDeepgramProjectId(apiKey);
  const res = await fetch(
    `https://api.deepgram.com/v1/projects/${projectId}/keys`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        comment: "livetranscribe-session",
        scopes: ["usage:write"],
        time_to_live_in_seconds: 60,
      }),
    }
  );
  if (!res.ok) {
    console.error(
      `[deepgram] key mint ${res.status}: ${await res.text().catch(() => "")}`
    );
    throw new Error(`Deepgram key mint returned ${res.status}`);
  }
  const body = (await res.json()) as { key?: string };
  if (!body.key) throw new Error("Deepgram key mint response had no `key` field");
  return body.key;
}

export async function GET(req: Request) {
  if (!process.env.DEEPGRAM_API_KEY) {
    return NextResponse.json(
      { error: "DEEPGRAM_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  // Gate like every other paid-upstream route: in production this mints a real
  // Deepgram usage:write key, so without auth an attacker who finds the URL
  // could mint keys in a loop and drain the Deepgram budget. Require a
  // signed-in user + per-user rate limit (same pattern as /api/translate).
  const auth = await requireAuthFromHeader(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Sign in to transcribe." },
      { status: 401 }
    );
  }
  const limit = checkRateLimit(auth.userId, "transcribe");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Rate limit hit. Try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  // Plan cost gate: a free user who's used their monthly session quota can't
  // mint a transcription token (this is what actually spends Deepgram budget).
  // Fail open if usage can't be read — the reactive UI is the primary gate.
  const usage = await getUsageFromHeader(req);
  if (usage && !usage.canStartSession) {
    return NextResponse.json(
      {
        error: `You've used all ${usage.sessionsLimit} free sessions this month. Upgrade to Tarjuman Pro for unlimited recording.`,
        code: "limit_reached",
      },
      { status: 402 }
    );
  }

  const reqUrl = new URL(req.url);
  const languageParam = reqUrl.searchParams.get("language") ?? "en";
  const language =
    isValidLangCode(languageParam) ||
    /^[a-z]{2}(-[A-Z]{2})?$/i.test(languageParam)
      ? languageParam
      : "en";
  // nova-3 is required for Arabic. nova-2 returns HTTP 400 "Bad Request" on
  // any /listen WS connection with `language=ar`. nova-3 is a strict superset
  // — it supports every language nova-2 did, with comparable or better
  // accuracy, and adds Arabic plus a `language=multi` mode for sessions where
  // the source language drifts mid-utterance.
  // Allowlist the model param. The client never sends one (nova-3 is required
  // for Arabic and is the default), so this only matters as a guard: an
  // authenticated caller could otherwise steer the minted session onto a
  // pricier model (e.g. whisper-large) or a bogus value that forces a 1006.
  const ALLOWED_MODELS = new Set(["nova-3", "nova-2", "nova-2-general"]);
  const modelParam = reqUrl.searchParams.get("model");
  const model =
    modelParam && ALLOWED_MODELS.has(modelParam) ? modelParam : "nova-3";

  // Sample rate: the client sends the AudioContext's REAL rate (16000 when the
  // browser honored our request, else the native 44100/48000). Deepgram must be
  // told the true rate the raw Linear16 frames were captured at, or it decodes
  // them at the wrong speed and returns empty/garbled transcripts (the classic
  // "Recording but nothing appears" on iPhones that ignore the 16kHz hint).
  // Validate to a sane band and fall back to 16000 for legacy/malformed callers.
  const rateParam = reqUrl.searchParams.get("sample_rate");
  const parsedRate = rateParam ? parseInt(rateParam, 10) : NaN;
  const sampleRate =
    Number.isFinite(parsedRate) && parsedRate >= 8000 && parsedRate <= 96000
      ? String(parsedRate)
      : "16000";

  // Transcribe with the DEDICATED monolingual model for the requested language.
  //
  // CRITICAL: Deepgram's `language=multi` (nova-3 multilingual) covers ONLY
  // en/es/fr/de/hi/it/ja/nl/ru/pt — it does NOT include Arabic. Arabic ships as
  // a dedicated streaming model (language=ar + dialect variants ar-SA, ar-EG, …).
  // A prior change routed RTL sources through `multi` on the mistaken belief it
  // had gained Arabic in Jan 2026; in reality `multi` returns EMPTY transcripts
  // for Arabic speech (it simply can't transcribe it), which read on-screen as a
  // permanent "Listening…" with nothing landing. Verified against Deepgram docs
  // 2026-06: Arabic realtime requires language=ar.
  //
  // Tradeoff: under a forced source language Deepgram transliterates off-language
  // speech into the source script, so the script-ratio gate can't catch English
  // bleed (req #1 off-language gating falls back to the confidence floor + the
  // server-side LLM noise filter). A robust fix is a dedicated language detector,
  // NOT failing-closed — but a working Arabic transcript comes first.
  const dgLanguage = language;

  // The browser sends raw Linear16 PCM (16kHz mono, Int16 little-endian)
  // straight from an AudioWorklet. With WebM/Opus we had to omit
  // `encoding=` because the container framing was self-describing; with
  // raw PCM we MUST declare it or Deepgram won't know how to decode the
  // frames.
  const dgParams = new URLSearchParams({
    language: dgLanguage,
    model,
    encoding: "linear16",
    sample_rate: sampleRate,
    channels: "1",
    punctuate: "true",
    smart_format: "true",
    interim_results: "true",
    // 500ms tolerates natural sub-sentence pauses in Arabic khutbah / lecture
    // delivery (e.g. between "السلام عليكم" and "ورحمة الله"). The earlier
    // value of 200ms was tuned for direct-mic captures and fragmented natural
    // speech at every pause >200ms, dropping words at segment boundaries.
    endpointing: "500",
    // Tag each word with a speaker id so the client can either label them or
    // filter to a single dominant speaker. Critical for non-khutbah lectures
    // and panel discussions; a no-op when only one person is speaking.
    diarize: "true",
    // NOTE: detect_language=true was tried here as a way to filter
    // off-language audio (e.g., English bleed in an Arabic session), but
    // Deepgram rejects the WS handshake when this is combined with a fixed
    // `language=ar` on nova-3 — the param is deprecated in favor of
    // `language=multi`. The browser sees the rejection as close code 1006.
    // `language=multi` itself is NOT an option for the primary use case:
    // nova-3 multilingual covers en/es/fr/de/hi/it/ja/nl/ru/pt only —
    // Arabic is monolingual-only (verified against Deepgram docs, 2026-06).
    // Off-language filtering is therefore layered downstream:
    //   1. FINAL_CONFIDENCE_THRESHOLD (0.45) + speaker-lock + interim
    //      confidence floor in use-deepgram.ts
    //   2. script-ratio + LLM transliteration/noise verdict in /api/translate
  });
  const deepgramUrl = `wss://api.deepgram.com/v1/listen?${dgParams.toString()}`;

  // Route through the loopback proxy ONLY when server.js is actually running in
  // this process (it sets __deepgramProxyReady). Otherwise — Vercel, or any
  // host started without the custom server (`next start`, `next dev`) — mint a
  // short-lived Deepgram temp key and let the browser open the WS directly.
  // Keying on the real proxy presence (not NODE_ENV) means a self-hosted
  // `node server.js` in production correctly uses its own proxy instead of
  // silently bypassing it.
  const proxyAvailable = globalThis.__deepgramProxyReady === true;

  if (!proxyAvailable) {
    try {
      const tempKey = await mintDeepgramTempKey(process.env.DEEPGRAM_API_KEY);
      return NextResponse.json({ key: tempKey, url: deepgramUrl });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[deepgram] could not issue session credentials:", msg);
      return NextResponse.json(
        { error: "Could not start a transcription session. Please try again." },
        { status: 502 }
      );
    }
  }

  // Dev: route the browser through our loopback proxy. server.js validates
  // the session token on upgrade and opens the upstream Deepgram WS itself.
  const proto = req.headers.get("x-forwarded-proto") === "https" ? "wss" : "ws";
  const host = req.headers.get("host") ?? "localhost:3000";
  const token = makeToken();
  const proxyUrl = `${proto}://${host}/api/deepgram-ws?token=${encodeURIComponent(token)}`;

  const sessions = getSessions();
  sessions.set(token, {
    deepgramUrl,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  // Opportunistic GC: drop expired entries so the Map doesn't grow unbounded
  // on a long-running dev server. Cheap because there's never many entries.
  for (const [k, v] of sessions) {
    if (v.expiresAt < Date.now()) sessions.delete(k);
  }

  return NextResponse.json({ key: token, url: proxyUrl });
}

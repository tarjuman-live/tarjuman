import { NextResponse } from "next/server";
import { isValidLangCode } from "@/lib/utils";

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
    throw new Error(
      `Deepgram /v1/projects returned ${res.status}: ${await res.text().catch(() => "")}`
    );
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
    throw new Error(
      `Deepgram key mint returned ${res.status}: ${await res.text().catch(() => "")}`
    );
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
  const model = reqUrl.searchParams.get("model") ?? "nova-3";

  // The browser sends raw Linear16 PCM (16kHz mono, Int16 little-endian)
  // straight from an AudioWorklet. With WebM/Opus we had to omit
  // `encoding=` because the container framing was self-describing; with
  // raw PCM we MUST declare it or Deepgram won't know how to decode the
  // frames.
  const dgParams = new URLSearchParams({
    language,
    model,
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    punctuate: "true",
    smart_format: "true",
    interim_results: "true",
    // 200ms is the fastest comfortable value: direct-mic and arm's-length
    // PA capture rarely have intra-sentence pauses > 200ms. If verification
    // on real khutbah audio shows mid-sentence fragmentation, bump to 250.
    endpointing: "200",
    // Tag each word with a speaker id so the client can either label them or
    // filter to a single dominant speaker. Critical for non-khutbah lectures
    // and panel discussions; a no-op when only one person is speaking.
    diarize: "true",
  });
  const deepgramUrl = `wss://api.deepgram.com/v1/listen?${dgParams.toString()}`;

  // Prod: the loopback proxy doesn't exist on Vercel. Mint a temp Deepgram
  // key and let the browser open the WS to Deepgram directly.
  const isProduction =
    process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

  if (isProduction) {
    try {
      const tempKey = await mintDeepgramTempKey(process.env.DEEPGRAM_API_KEY);
      return NextResponse.json({ key: tempKey, url: deepgramUrl });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `Failed to mint Deepgram temp key: ${msg}` },
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

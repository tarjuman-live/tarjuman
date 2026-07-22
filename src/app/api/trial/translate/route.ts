import { NextRequest, NextResponse } from "next/server";
import { ISLAMIC_TERMINOLOGY_RULES } from "@/lib/islamic-terminology";
import { LANGUAGES } from "@/lib/constants";

/**
 * Anonymous translation for the landing-page "Try it live" trial — the only
 * unauthenticated path to Claude in the app. The real /api/translate requires a
 * signed-in user; this exists so a visitor can test the product without an
 * account, and is locked down to keep that safe:
 *
 *   • hard input cap (short spoken segments only),
 *   • small max_tokens (a segment translation is tiny),
 *   • per-IP token-bucket rate limit + a per-instance global circuit breaker.
 *
 * The limiter is best-effort: serverless instances are ephemeral, so the bucket
 * resets on cold start and isn't shared across instances. It's a cost fuse for
 * the trial, not a security boundary — the tight input/output caps are what
 * actually bound per-call cost. (A durable shared limiter is the same deferred
 * item the billing path needs.)
 */

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TEXT = 280;

const LANG_NAME = new Map<string, string>(
  LANGUAGES.map((l) => [l.code, l.name])
);

// ── Per-IP token bucket ──────────────────────────────────────────────────
interface Bucket {
  tokens: number;
  last: number;
}
const buckets = new Map<string, Bucket>();
const BURST = 40; // allow a quick burst (a trial produces several segments fast)
const REFILL_PER_SEC = 40 / 600; // ≈ 40 translations per 10 minutes, sustained

function allowIp(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: BURST, last: now };
  b.tokens = Math.min(BURST, b.tokens + ((now - b.last) / 1000) * REFILL_PER_SEC);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  // Opportunistic cleanup so the map can't grow unbounded across many IPs.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now - v.last > 3600_000) buckets.delete(k);
    }
  }
  return true;
}

// ── Per-instance global circuit breaker ──────────────────────────────────
let windowStart = Date.now();
let windowCount = 0;
const GLOBAL_MAX = 6000; // per hour per instance
function allowGlobal(): boolean {
  const now = Date.now();
  if (now - windowStart > 3600_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= GLOBAL_MAX) return false;
  windowCount += 1;
  return true;
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Translation is temporarily unavailable." },
      { status: 500 }
    );
  }

  if (!allowGlobal()) {
    return NextResponse.json(
      {
        error:
          "The live demo is busy right now. Try again shortly, or sign up free for the full app.",
      },
      { status: 503 }
    );
  }

  if (!allowIp(clientIp(req))) {
    return NextResponse.json(
      { error: "Trial limit reached — sign up free to keep going." },
      { status: 429 }
    );
  }

  let body: { text?: string; source?: string; target?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const target = typeof body.target === "string" ? body.target : "";
  const source = typeof body.source === "string" ? body.source : undefined;

  if (!text) return NextResponse.json({ error: "Missing text." }, { status: 400 });
  if (text.length > MAX_TEXT)
    return NextResponse.json({ error: "Segment too long for the trial." }, { status: 413 });
  if (!LANG_NAME.has(target))
    return NextResponse.json({ error: "Unsupported target language." }, { status: 400 });
  if (source && source === target)
    return NextResponse.json({ translatedText: text });

  const targetName = LANG_NAME.get(target)!;
  const sourceName = source ? LANG_NAME.get(source) ?? "the source language" : "the source language";

  const system = `You translate short spoken-transcript segments from ${sourceName} into ${targetName}. Output ONLY the translation — no preamble, no quotation marks, no notes. If the input is filler or untranslatable noise, output an empty string.\n\n${ISLAMIC_TERMINOLOGY_RULES}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: text }],
      }),
      cache: "no-store",
      // Without a timeout a stalled Anthropic connection hangs for the whole
      // serverless function budget while the 60s trial clock runs out and the
      // segment sits on "…translating". Abort at 15s → the catch below returns
      // the generic 502 the client already handles.
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.error("trial translate upstream error", resp.status);
      return NextResponse.json({ error: "Translation hiccup — try again." }, { status: 502 });
    }
    const data = await resp.json();
    const translatedText =
      typeof data?.content?.[0]?.text === "string" ? data.content[0].text.trim() : "";
    return NextResponse.json({ translatedText });
  } catch (e) {
    console.error("trial translate error", e);
    return NextResponse.json({ error: "Translation hiccup — try again." }, { status: 502 });
  }
}

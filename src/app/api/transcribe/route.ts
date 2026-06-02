import { NextRequest, NextResponse } from "next/server";
import { requireAuthFromHeader, checkRateLimit } from "@/lib/api-auth";

/**
 * OpenAI Whisper transcription proxy.
 *
 * Used by the translator hook to get a SECOND Arabic transcription of each
 * finalized Deepgram segment. Claude then receives both transcriptions and
 * reconciles them before translating.
 *
 * The client posts a WAV blob (16kHz mono PCM, sliced from the rolling
 * audio buffer). We forward to `whisper-1` with language hint = source.
 *
 * Returns 503 when OPENAI_API_KEY is unset so the client gracefully proceeds
 * with Deepgram alone.
 */

const WHISPER_TIMEOUT_MS = 15_000;

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server" },
      { status: 503 }
    );
  }

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
      {
        error: `Transcribe rate limit hit. Try again in ${limit.retryAfterSec}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      }
    );
  }

  const inboundForm = await req.formData().catch(() => null);
  if (!inboundForm) {
    return NextResponse.json(
      { error: "Expected multipart/form-data with `file` and optional `language`" },
      { status: 400 }
    );
  }

  const file = inboundForm.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing or invalid `file`" },
      { status: 400 }
    );
  }
  if (file.size === 0 || file.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "`file` is empty or exceeds the 25MB Whisper limit" },
      { status: 400 }
    );
  }

  // Optional language hint — Whisper's accuracy on Arabic improves a lot
  // when we tell it the language up front.
  const language = inboundForm.get("language");
  const langCode =
    typeof language === "string" && /^[a-z]{2}$/.test(language)
      ? language
      : null;

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, "audio.wav");
  upstreamForm.append("model", "whisper-1");
  upstreamForm.append("response_format", "json");
  if (langCode) upstreamForm.append("language", langCode);
  // Translation-mode is NOT used: we want Arabic text back to feed into
  // Claude alongside Deepgram's Arabic; translation happens downstream.

  let upstream: Response;
  try {
    upstream = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstreamForm,
        cache: "no-store",
        signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timed out|abort/i.test(msg)) {
      return NextResponse.json(
        { error: "Whisper timed out." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: `Whisper failed: ${msg}` },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      {
        error: `Whisper upstream returned ${upstream.status}: ${detail.slice(0, 200)}`,
      },
      { status: 502 }
    );
  }

  const data = (await upstream.json().catch(() => ({}))) as { text?: string };
  return NextResponse.json({ text: (data.text ?? "").trim() });
}

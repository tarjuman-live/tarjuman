import { NextRequest, NextResponse } from "next/server";
import { requireAuthFromHeader, checkRateLimit } from "@/lib/api-auth";

/**
 * OpenAI Whisper transcription proxy.
 *
 * Used by the translator hook to get a SECOND transcription of each
 * finalized Deepgram segment. Claude then receives both transcriptions and
 * reconciles them before translating.
 *
 * The client posts a WAV blob (16kHz mono PCM, sliced from the rolling
 * audio buffer). We forward to `whisper-1` WITHOUT a language hint so
 * Whisper auto-detects — that detection is the app's only trustworthy
 * language-ID signal. Deepgram runs with a forced `language=` (nova-3 has
 * no detect_language / multi mode for Arabic), so when someone speaks
 * English in an Arabic session Deepgram hallucinates Arabic-script
 * transliterations; Whisper, unhinted, correctly reports `en` and the
 * client drops the segment (see use-translator.ts).
 *
 * Response: { text, language } where `language` is an ISO 639-1 code when
 * recognized (verbose_json returns full names like "english").
 *
 * Returns 503 when OPENAI_API_KEY is unset so the client gracefully proceeds
 * with Deepgram alone.
 */

const WHISPER_TIMEOUT_MS = 15_000;

// Whisper's verbose_json `language` field is a lowercase full English name.
// Map the ones relevant to the app's language list (src/lib/languages.ts)
// plus common bleed languages to ISO 639-1 so the client can compare
// against the session's source code. Unknown names pass through raw —
// they'll simply never equal a 2-letter code, which fails safe (no drop).
const WHISPER_LANGUAGE_TO_ISO: Record<string, string> = {
  arabic: "ar",
  english: "en",
  french: "fr",
  spanish: "es",
  urdu: "ur",
  turkish: "tr",
  malay: "ms",
  indonesian: "id",
  bengali: "bn",
  german: "de",
  portuguese: "pt",
  russian: "ru",
  chinese: "zh",
  japanese: "ja",
  korean: "ko",
  hindi: "hi",
  swahili: "sw",
  somali: "so",
  dutch: "nl",
  italian: "it",
  persian: "fa",
  farsi: "fa",
  pashto: "ps",
  hebrew: "he",
};

function toIsoLanguage(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const lower = raw.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(lower)) return lower; // already a code
  return WHISPER_LANGUAGE_TO_ISO[lower] ?? lower;
}

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

  // Optional language hint. The live-translation client deliberately does
  // NOT send this anymore: a hint forces Whisper's decoder to that language
  // (it would transliterate English speech into Arabic, same failure mode
  // as Deepgram's forced `language=`), which destroys the language-ID
  // signal the client relies on for off-language filtering. The param is
  // still honored for any caller that wants a pinned-language transcription.
  const language = inboundForm.get("language");
  const langCode =
    typeof language === "string" && /^[a-z]{2}$/.test(language)
      ? language
      : null;

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, "audio.wav");
  upstreamForm.append("model", "whisper-1");
  // verbose_json carries the detected `language` (json does not).
  upstreamForm.append("response_format", "verbose_json");
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

  const data = (await upstream.json().catch(() => ({}))) as {
    text?: string;
    language?: string;
  };
  return NextResponse.json({
    text: (data.text ?? "").trim(),
    // Detected language as ISO 639-1 (best effort). When the caller pinned
    // a language hint this just echoes the hint — not a detection.
    language: langCode ?? toIsoLanguage(data.language),
  });
}

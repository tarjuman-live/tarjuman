import { NextRequest, NextResponse } from "next/server";
import { ISLAMIC_TERMINOLOGY_RULES } from "@/lib/islamic-terminology";
import {
  requireAuthFromHeader,
  checkRateLimit,
  getUsageFromHeader,
} from "@/lib/api-auth";
import { streamAnthropicText, LANGUAGE_NAMES } from "@/lib/anthropic-stream";
import { BILLING_ENABLED } from "../../../../convex/billingLimits";

const SYSTEM = `You are an expert translator of Islamic content (khutbahs, lectures, classes) for a Sunni Muslim audience, following Ahl as-Sunnah wal-Jama'ah and the Salaf as-Salih. Translate faithfully and naturally into readable prose, preserving Islamic terminology exactly (Allah, the ﷺ honorific, Sabr, etc. — never genericize) and keeping Quran/hadith references intact. Output ONLY the translation — no preamble, notes, or commentary.

${ISLAMIC_TERMINOLOGY_RULES}`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  const auth = await requireAuthFromHeader(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Sign in to translate a transcript." },
      { status: 401 }
    );
  }

  const limit = checkRateLimit(auth.userId, "translatetranscript");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Rate limit hit. Try again in ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const usage = await getUsageFromHeader(req);
  if (BILLING_ENABLED && usage && usage.plan !== "pro") {
    return NextResponse.json(
      { error: "Full-transcript translation is a Tarjuman Pro feature.", code: "pro_only" },
      { status: 402 }
    );
  }

  let body: { transcript?: string; targetLanguage?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { transcript, targetLanguage } = body;
  if (!transcript || typeof transcript !== "string") {
    return NextResponse.json({ error: "Missing `transcript`" }, { status: 400 });
  }
  if (!targetLanguage || !LANGUAGE_NAMES[targetLanguage]) {
    return NextResponse.json({ error: "Missing/unknown `targetLanguage`" }, { status: 400 });
  }
  if (transcript.length > 400_000) {
    return NextResponse.json({ error: "Transcript too long." }, { status: 413 });
  }
  const lang = LANGUAGE_NAMES[targetLanguage];

  const userMessage = `Translate the following lecture transcript into ${lang}. Output only the translation, as flowing readable text (paragraphs are fine). Do not add any notes, headings, or explanations.

TRANSCRIPT:
${transcript}`;

  return streamAnthropicText({
    apiKey,
    system: SYSTEM,
    userMessage,
    model: "claude-sonnet-5",
    maxTokens: 8000,
    timeoutMs: 120_000,
    logTag: "translate-transcript",
  });
}

import { NextRequest, NextResponse } from "next/server";
import { ISLAMIC_TERMINOLOGY_RULES } from "@/lib/islamic-terminology";
import {
  requireAuthFromHeader,
  checkRateLimit,
  getUsageFromHeader,
} from "@/lib/api-auth";
import { streamAnthropicText, LANGUAGE_NAMES } from "@/lib/anthropic-stream";
import { BILLING_ENABLED } from "../../../../convex/billingLimits";

const SYSTEM = `You answer questions about an Islamic lecture / khutbah for a Sunni Muslim audience, following the methodology of Ahl as-Sunnah wal-Jama'ah and the Salaf as-Salih.

RULES:
- Answer ONLY from the provided transcript. If the answer is not in the transcript, say so plainly (e.g. "The lecture doesn't cover that") — do NOT invent or draw on outside knowledge to fill gaps.
- Preserve Islamic terminology exactly (Allah, ﷺ, Sabr, etc. — never genericize).
- Cite a Quran verse or hadith ONLY if it is clearly supported; never fabricate a citation.
- Be concise and directly responsive. It's fine to quote a short relevant line from the transcript.

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
      { error: "Sign in to ask about a lecture." },
      { status: 401 }
    );
  }

  const limit = checkRateLimit(auth.userId, "ask");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many questions — try again in ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const usage = await getUsageFromHeader(req);
  if (BILLING_ENABLED && usage && usage.plan !== "pro") {
    return NextResponse.json(
      { error: "Ask-the-lecture is a Tarjuman Pro feature.", code: "pro_only" },
      { status: 402 }
    );
  }

  let body: { transcript?: string; question?: string; targetLanguage?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { transcript, question, targetLanguage = "en" } = body;
  if (!transcript || typeof transcript !== "string") {
    return NextResponse.json({ error: "Missing `transcript`" }, { status: 400 });
  }
  if (!question || typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "Missing `question`" }, { status: 400 });
  }
  if (transcript.length > 400_000) {
    return NextResponse.json({ error: "Transcript too long." }, { status: 413 });
  }
  const lang = LANGUAGE_NAMES[targetLanguage] ?? "English";

  const userMessage = `TRANSCRIPT OF THE LECTURE:
${transcript}

Answer the following question about the lecture, in ${lang}, using ONLY what the transcript supports:

${question.trim()}`;

  return streamAnthropicText({
    apiKey,
    system: SYSTEM,
    userMessage,
    model: "claude-sonnet-5",
    maxTokens: 1200,
    logTag: "ask",
  });
}

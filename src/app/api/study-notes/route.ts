import { NextRequest, NextResponse } from "next/server";
import { ISLAMIC_TERMINOLOGY_RULES } from "@/lib/islamic-terminology";
import {
  requireAuthFromHeader,
  checkRateLimit,
  getUsageFromHeader,
} from "@/lib/api-auth";
import { streamAnthropicText, LANGUAGE_NAMES } from "@/lib/anthropic-stream";
import { BILLING_ENABLED } from "../../../../convex/billingLimits";

const SYSTEM = `You are an expert study-notes generator for Sunni Muslim audiences on Islamic content (khutbahs, lectures, classes, Quranic study). Interpret all content within Ahl as-Sunnah wal-Jama'ah following the methodology of the Salaf as-Salih. Preserve Islamic terminology exactly — do NOT genericize (never "Allah"→"God", never "Sabr"→"patience"). Cite Quran/hadith ONLY when certain of the exact source; never fabricate references.

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
      { error: "Sign in to use AI study tools." },
      { status: 401 }
    );
  }

  const limit = checkRateLimit(auth.userId, "studynotes");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Rate limit hit. Try again in ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  // Pro gate — active only once billing is live. While billing is off,
  // getUsageFromHeader reports everyone unlimited, so this is a no-op.
  const usage = await getUsageFromHeader(req);
  if (BILLING_ENABLED && usage && usage.plan !== "pro") {
    return NextResponse.json(
      { error: "AI study notes are a Tarjuman Pro feature.", code: "pro_only" },
      { status: 402 }
    );
  }

  let body: { transcript?: string; targetLanguage?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { transcript, targetLanguage = "en" } = body;
  if (!transcript || typeof transcript !== "string") {
    return NextResponse.json({ error: "Missing `transcript`" }, { status: 400 });
  }
  if (transcript.length > 400_000) {
    return NextResponse.json({ error: "Transcript too long." }, { status: 413 });
  }
  const lang = LANGUAGE_NAMES[targetLanguage] ?? "English";

  const userMessage = `From the live-transcribed lecture below (it may contain transcription errors — use context to interpret unclear words), produce structured STUDY NOTES in ${lang} as markdown with these H2 (\`##\`) sections:

## Key Points
The main points, as a bulleted list, preserving Islamic vocabulary.

## Islamic Terms
A glossary: each Islamic term the speaker used, with a short, accurate definition. Omit this section entirely if none were used.

## Quran & Hadith References
Every Quranic verse or hadith referenced, each with a SPECIFIC citation (e.g. \`(Quran 2:255)\`, \`(Sahih al-Bukhari 3367)\` — sunnah.com numbering). Include ONLY references you are certain of; omit the section entirely if none are verifiable.

## Takeaways
Practical action items / lessons to apply. Omit if none.

Do NOT add a top-level title. Start directly with the first \`##\` heading.

TRANSCRIPT:
${transcript}`;

  return streamAnthropicText({
    apiKey,
    system: SYSTEM,
    userMessage,
    model: "claude-sonnet-5",
    maxTokens: 2000,
    logTag: "study-notes",
  });
}

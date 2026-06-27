import { NextRequest, NextResponse } from "next/server";
import { requireAuthFromHeader, checkRateLimit } from "@/lib/api-auth";
import { verifyAndEnrich } from "@/lib/sunnah";
import { verifyAndEnrichQuran } from "@/lib/quran";

/**
 * Post-stream citation verification for the summary view.
 *
 * The summary streams from /api/summarize as a typewriter; we can't easily
 * inject sunnah.com / quran.com verification mid-stream. After the stream
 * completes, the client POSTs the final text here and gets back the enriched
 * version: verified hadith and Quranic citations replaced with their
 * canonical bodies + clickable markdown links to sunnah.com / quran.com.
 * Hallucinated citations get stripped.
 *
 * Both enrichments run unconditionally on free public sources — quran.com and
 * the open hadith CDN (fawazahmed0 dataset) — so NO API keys are required.
 */

interface VerifyRequest {
  text: string;
  targetLanguage?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthFromHeader(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Sign in to verify citations." },
      { status: 401 }
    );
  }

  // Reuse the translate token bucket — verification is a similar burst
  // pattern (per-segment, low average rate).
  const limit = checkRateLimit(auth.userId, "translate");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Rate limit hit. Try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  let body: VerifyRequest;
  try {
    body = (await req.json()) as VerifyRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { text, targetLanguage } = body;
  if (typeof text !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid `text`" },
      { status: 400 }
    );
  }
  if (text.length === 0) {
    return NextResponse.json({ text, skipped: true });
  }

  // Hadith pass (open hadith CDN) then Quran pass (quran.com — public API).
  // Order doesn't matter since the two citation regexes don't overlap, but we
  // run hadith first for consistency with the translate route.
  const hadithEnriched = await verifyAndEnrich(text);
  const quranEnriched = await verifyAndEnrichQuran(
    hadithEnriched.text,
    targetLanguage ?? "en"
  );

  const citations = [
    ...hadithEnriched.citations.map((c) => ({
      source: "sunnah" as const,
      label: `${c.collectionDisplay} ${c.number}`,
      url: c.url,
      verified: c.verified,
    })),
    ...quranEnriched.citations.map((c) => ({
      source: "quran" as const,
      label: `Quran ${c.surahDisplay}:${c.ayahNumber}`,
      url: c.url,
      verified: c.verified,
    })),
  ];

  return NextResponse.json({
    text: quranEnriched.text,
    // Only "skipped" if BOTH paths were no-ops. Quran path is never skipped
    // since it doesn't require a key.
    skipped: hadithEnriched.skipped && quranEnriched.citations.length === 0,
    citations,
  });
}

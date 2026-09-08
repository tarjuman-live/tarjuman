/**
 * Haiku 4.5 vs Sonnet 5 on the translation path — quality, latency, and what
 * the citation verifier can and cannot rescue.
 *
 * WHY: /api/translate escalates to Sonnet whenever a segment (or anything in
 * its rolling 6-segment context) looks like Quran/hadith. Sonnet measures ~5x
 * slower per segment, and on real khutbah transcripts the escalation latches on
 * and rarely releases — so most of a session runs on the slow path. That is only
 * worth paying if Sonnet is actually better at the thing it was escalated for:
 * recognizing the verse, citing it correctly, and emitting a clean merge.
 *
 * THE VERIFIER ARM (the "verifier-first" question):
 * src/lib/{sunnah,quran}.ts verify citations against the open hadith dataset and
 * quran.com. If the verifier is strong enough, the argument goes, we can always
 * translate with Haiku and let the verifier guarantee citation integrity.
 *
 * But the verifier's contract is narrower than that argument assumes:
 *   ✓ it STRIPS a citation whose number does not exist  (fabrication filter)
 *   ✓ it UPGRADES a correct citation to canonical text + link
 *   ✗ it CANNOT ADD a citation the model never emitted
 *   ✗ it CANNOT PRODUCE a merge
 *   ✗ it CANNOT DETECT MISATTRIBUTION — (Quran Al-Baqarah:155) cited for verse
 *     156 resolves `found`, and on an English target the canonical body of 155
 *     is then appended, presenting the WRONG verse with full authority.
 *
 * So this harness scores each model BEFORE and AFTER the verifier, and counts
 * misattribution separately from fabrication. Those are the numbers the routing
 * decision actually rests on.
 *
 * It imports SYSTEM_PROMPT / buildUserMessage / parseMergeDirective from
 * src/lib/translate-prompt.ts — the SAME module the route uses — so the
 * comparison cannot drift from production.
 *
 * Run:  bunx tsx bench/translate-model-compare.ts [--runs N] [--no-verify]
 *
 * NOTE: this calls the real Anthropic API and costs money (a few cents per run).
 * It deliberately does NOT hit /api/translate, so it needs no auth and measures
 * the model rather than the Next.js route + Convex round-trip. The verifier arm
 * additionally hits quran.com and the hadith CDN (both free, no key).
 */

import fs from "node:fs";
import {
  SYSTEM_PROMPT,
  MODEL_HAIKU,
  MODEL_SONNET,
  buildUserMessage,
  parseMergeDirective,
  routeModel,
  type TranslateContextEntry,
} from "../src/lib/translate-prompt";
import { verifyAndEnrich } from "../src/lib/sunnah";
import { verifyAndEnrichQuran } from "../src/lib/quran";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error("ANTHROPIC_API_KEY missing from .env.local");
  process.exit(1);
}

const RUNS = Number(
  process.argv.includes("--runs")
    ? process.argv[process.argv.indexOf("--runs") + 1]
    : 1,
);
const VERIFY = !process.argv.includes("--no-verify");

interface Case {
  name: string;
  /** Prior segments, as the live pipeline would have accumulated them. */
  context: TranslateContextEntry[];
  /** The segment being translated now. */
  text: string;
  /**
   * Citation the model should produce, if any. Verified by hand against
   * quran.com / sunnah.com — these are the ground truth for scoring.
   */
  expectCitation: RegExp | null;
  /** Should a <<<MERGE>>> fire, collapsing the context into one card? */
  expectMerge: boolean;
  /**
   * True for cases that exist ONLY to measure the escalation latch: ordinary
   * khutbah prose that production sends to Sonnet purely because something
   * earlier in the rolling context carried a citation. If Haiku matches Sonnet
   * here, the latch is pure latency with no quality return.
   */
  latched?: boolean;
}

const CASES: Case[] = [
  {
    name: "Quran Al-An'am:136 (split across 2 breaths)",
    context: [
      { id: "s1", sourceText: "قال الله في القرآن الكريم" },
      {
        id: "s2",
        sourceText: "وجعلوا لله مما ذرأ من الحرث والأنعام نصيبا",
      },
    ],
    text: "فقالوا هذا لله بزعمهم وهذا لشركائنا",
    expectCitation: /Al-?An'?am\s*[:\s]\s*136|6\s*:\s*136/i,
    expectMerge: true,
  },
  {
    name: "Quran Al-Baqarah:156 (istirja')",
    context: [
      {
        id: "s1",
        sourceText: "الذين إذا أصابتهم مصيبة قالوا",
      },
    ],
    text: "إنا لله وإنا إليه راجعون",
    expectCitation: /Al-?Baqarah\s*[:\s]\s*156|2\s*:\s*156/i,
    expectMerge: true,
  },
  {
    name: "Hadith — actions by intentions (Bukhari 1)",
    context: [{ id: "s1", sourceText: "قال رسول الله صلى الله عليه وسلم" }],
    text: "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى",
    expectCitation: /Bukhari\s*1\b|Sahih al-Bukhari/i,
    expectMerge: true,
  },
  {
    name: "Hadith — none of you truly believes (Bukhari 13 / Muslim 45)",
    context: [{ id: "s1", sourceText: "قال النبي صلى الله عليه وسلم" }],
    text: "لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه",
    expectCitation: /Bukhari\s*13\b|Muslim\s*45\b/i,
    expectMerge: true,
  },
  {
    name: "Quran Al-Asr (short surah, 3 breaths)",
    context: [
      { id: "s1", sourceText: "قال الله تعالى" },
      { id: "s2", sourceText: "والعصر إن الإنسان لفي خسر" },
    ],
    text: "إلا الذين آمنوا وعملوا الصالحات وتواصوا بالحق وتواصوا بالصبر",
    expectCitation: /Al-?'?Asr\s*[:\s]\s*3|103\s*:\s*3/i,
    expectMerge: true,
  },
  {
    name: "Narrative khutbah prose (control — no citation)",
    context: [{ id: "s1", sourceText: "أيها المسلمون اتقوا الله حق تقاته" }],
    text: "فإن التقوى خير زاد ليوم المعاد وهي وصية الله للأولين والآخرين",
    expectCitation: null,
    expectMerge: false,
  },
  {
    name: "Du'a — must NOT fabricate a citation",
    context: [{ id: "s1", sourceText: "اللهم إنا نسألك" }],
    text: "الهدى والتقى والعفاف والغنى",
    expectCitation: null,
    expectMerge: false,
  },

  // ─── LATCH CASES ────────────────────────────────────────────────────────
  // Ordinary prose whose CONTEXT carries a citation. routeModel sends every
  // one of these to Sonnet. Nothing about them needs Sonnet.
  {
    name: "LATCH: prose after a cited verse (context has citation)",
    context: [
      {
        id: "s1",
        sourceText: "قال الله تعالى إنا لله وإنا إليه راجعون",
        translatedText:
          "Allah said: Truly, to Allah we belong and truly, to Him we shall return. (Quran Al-Baqarah:156)",
      },
      { id: "s2", sourceText: "وهذه الآية عظيمة في بابها" },
    ],
    text: "فينبغي للمسلم أن يصبر عند المصيبة وأن يحتسب الأجر عند الله سبحانه وتعالى",
    expectCitation: null,
    expectMerge: false,
    latched: true,
  },
  {
    name: "LATCH: prose after a cited hadith (context has citation)",
    context: [
      {
        id: "s1",
        sourceText: "قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات",
        translatedText:
          "The Messenger of Allah ﷺ said: Actions are but by intentions. (Sahih al-Bukhari 1)",
      },
    ],
    text: "وهذا الحديث أصل عظيم من أصول الدين يدور عليه العمل كله",
    expectCitation: null,
    expectMerge: false,
    latched: true,
  },
  {
    name: "LATCH: marker word only, no actual quote",
    context: [{ id: "s1", sourceText: "وقد ذكر أهل العلم في هذه المسألة" }],
    // "في سورة" trips QURAN_MARKERS_AR on the CURRENT text, but the speaker is
    // only referring to a surah, not quoting it.
    text: "أن هذا المعنى مذكور في سورة البقرة وفي غيرها من السور الكريمة",
    expectCitation: null,
    expectMerge: false,
    latched: true,
  },
];

interface Result {
  translation: string;
  merged: boolean;
  combined?: string;
  latencyMs: number;
  error?: string;
}

async function callModel(model: string, c: Case): Promise<Result> {
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      // Mirror production: ONE cap for both models. This deliberately differs
      // from the first version of this harness, which gave Haiku 500 (matching
      // the old route) — that made some of Haiku's merge misses truncation
      // artifacts rather than recognition failures, since a <<<MERGE>>> trailer
      // carries the full Arabic source plus its full translation.
      max_tokens: 1500,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: buildUserMessage({
            text: c.text,
            sourceName: "Arabic",
            targetName: "English",
            context: c.context,
          }),
        },
      ],
    }),
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    return {
      translation: "",
      merged: false,
      latencyMs,
      error: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`,
    };
  }
  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const raw = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  const ids = new Set(c.context.map((x) => x.id));
  const parsed = parseMergeDirective(raw, ids);
  return {
    translation: parsed.translation,
    merged: Boolean(parsed.merge),
    combined: parsed.merge?.combinedTranslatedText,
    latencyMs,
  };
}

/**
 * Run the production citation verifier over a model result — exactly the two
 * calls /api/translate makes in its metadata trailer, in the same order.
 */
async function runVerifier(
  r: Result,
): Promise<{ result: Result; verifierMs: number }> {
  const t0 = Date.now();
  const enrich = async (s: string) => {
    const h = await verifyAndEnrich(s);
    const q = await verifyAndEnrichQuran(h.text, "en");
    return q.text;
  };
  const translation = await enrich(r.translation);
  const combined = r.combined ? await enrich(r.combined) : undefined;
  return {
    result: { ...r, translation, combined },
    verifierMs: Date.now() - t0,
  };
}

/** Terminology check: the whole reason this app uses an LLM. */
function terminologyOk(text: string): boolean {
  if (/\bGod\b/.test(text)) return false; // "Allah" must never be flattened
  return true;
}

// Matches both the bare citation the model emits — (Quran Al-Baqarah:156) — and
// the markdown-linked form the verifier rewrites it to: [(Sahih al-Bukhari 1)](url).
const ANY_CITATION_RE = /\[?\(\s*(?:Quran|Sahih|Sunan|Jami|Muwatta|Musnad)/i;

interface Score {
  merge: boolean;
  citation: boolean;
  /** A citation appeared where NO citation was expected. */
  fabricated: boolean;
  /**
   * A citation appeared where one WAS expected, but it is not the right one.
   * This is the failure mode the verifier cannot see: the number exists, so it
   * is enriched with canonical text and presented as authentic — while being
   * the wrong verse/hadith. Strictly worse than emitting nothing.
   */
  misattributed: boolean;
  terminology: boolean;
}

function score(c: Case, r: Result): Score {
  const searchable = `${r.translation}\n${r.combined ?? ""}`;
  const citationFound = ANY_CITATION_RE.test(searchable);
  const citationCorrect = c.expectCitation
    ? c.expectCitation.test(searchable)
    : !citationFound; // for non-citation cases, ANY citation is a fabrication
  return {
    merge: r.merged === c.expectMerge,
    citation: citationCorrect,
    fabricated: !c.expectCitation && citationFound,
    misattributed:
      Boolean(c.expectCitation) && citationFound && !citationCorrect,
    terminology: terminologyOk(searchable),
  };
}

const passed = (s: Score) =>
  s.merge && s.citation && s.terminology && !s.fabricated && !s.misattributed;

const pad = (s: string, n: number) => s.padEnd(n);
const mark = (ok: boolean) => (ok ? "✅" : "❌");
const label = (m: string) => (m === MODEL_SONNET ? "sonnet-5" : "haiku-4.5");

interface Totals {
  lat: number[];
  verifierLat: number[];
  rawPass: number;
  verPass: number;
  fabricatedRaw: number;
  fabricatedVer: number;
  misattributedVer: number;
  mergeMiss: number;
  n: number;
  latchLat: number[];
  latchPass: number;
  latchN: number;
}

const blank = (): Totals => ({
  lat: [],
  verifierLat: [],
  rawPass: 0,
  verPass: 0,
  fabricatedRaw: 0,
  fabricatedVer: 0,
  misattributedVer: 0,
  mergeMiss: 0,
  n: 0,
  latchLat: [],
  latchPass: 0,
  latchN: 0,
});

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

(async () => {
  console.log(
    `SYSTEM_PROMPT: ${SYSTEM_PROMPT.length} chars · runs per case: ${RUNS} · ` +
      `verifier arm: ${VERIFY ? "ON" : "off"}\n`,
  );

  const totals: Record<string, Totals> = {
    [MODEL_HAIKU]: blank(),
    [MODEL_SONNET]: blank(),
  };

  for (const c of CASES) {
    // routeModel is constant now (verifier-first: always Haiku). Printing it
    // anyway is the point — the day someone re-introduces escalation, this line
    // starts saying SONNET again and the harness immediately shows what that
    // costs on the very cases that motivated the change.
    const wouldRoute = routeModel(c.text, c.context);
    console.log(`\n━━━ ${c.name}${c.latched ? "   [latch case]" : ""}`);
    console.log(
      `    production routes to: ${wouldRoute === MODEL_SONNET ? "SONNET ⏳" : "haiku"}`,
    );

    for (const model of [MODEL_HAIKU, MODEL_SONNET]) {
      for (let run = 0; run < RUNS; run++) {
        const raw = await callModel(model, c);
        if (raw.error) {
          console.log(`    ${pad(label(model), 12)} ERROR ${raw.error}`);
          continue;
        }
        const rawScore = score(c, raw);

        let ver = raw;
        let verifierMs = 0;
        if (VERIFY) {
          const v = await runVerifier(raw);
          ver = v.result;
          verifierMs = v.verifierMs;
        }
        const verScore = score(c, ver);

        const t = totals[model];
        t.lat.push(raw.latencyMs);
        if (VERIFY) t.verifierLat.push(verifierMs);
        t.n++;
        if (passed(rawScore)) t.rawPass++;
        if (passed(verScore)) t.verPass++;
        if (rawScore.fabricated) t.fabricatedRaw++;
        if (verScore.fabricated) t.fabricatedVer++;
        if (verScore.misattributed) t.misattributedVer++;
        if (!rawScore.merge) t.mergeMiss++;
        if (c.latched) {
          t.latchN++;
          t.latchLat.push(raw.latencyMs);
          if (passed(verScore)) t.latchPass++;
        }

        console.log(
          `    ${pad(label(model), 12)} ${String(raw.latencyMs).padStart(6)}ms` +
            (VERIFY ? ` +${String(verifierMs).padStart(5)}ms verify` : "") +
            `  merge ${mark(rawScore.merge)}  citation ${mark(verScore.citation)}` +
            `  terms ${mark(verScore.terminology)}` +
            (verScore.fabricated ? "  ⚠️ FABRICATED" : "") +
            (verScore.misattributed ? "  🚨 MISATTRIBUTED" : ""),
        );
        const shown = (ver.combined ?? ver.translation)
          .replace(/\s+/g, " ")
          .trim();
        console.log(`                 ${shown.slice(0, 150)}`);
      }
    }
  }

  console.log(`\n${"═".repeat(78)}\nSUMMARY`);
  for (const model of [MODEL_HAIKU, MODEL_SONNET]) {
    const t = totals[model];
    if (!t.n) continue;
    console.log(
      `\n  ${label(model)}\n` +
        `    correct (raw model)      ${t.rawPass}/${t.n}\n` +
        `    correct (after verifier) ${t.verPass}/${t.n}\n` +
        `    merge misses             ${t.mergeMiss}\n` +
        `    fabricated  raw→verified ${t.fabricatedRaw} → ${t.fabricatedVer}   (verifier strips these)\n` +
        `    MISATTRIBUTED (verified) ${t.misattributedVer}   (verifier CANNOT catch these)\n` +
        `    median latency           ${median(t.lat)}ms` +
        (VERIFY ? ` + ${median(t.verifierLat)}ms verifier` : ""),
    );
    if (t.latchN) {
      console.log(
        `    latch cases              ${t.latchPass}/${t.latchN} correct · median ${median(t.latchLat)}ms`,
      );
    }
  }

  const h = totals[MODEL_HAIKU];
  const s = totals[MODEL_SONNET];
  if (h.n && s.n) {
    console.log(`\n${"─".repeat(78)}\nVERIFIER-FIRST READOUT`);
    console.log(
      `  Latch cases are ordinary prose the OLD router escalated to Sonnet\n` +
        `  purely because something earlier in the context carried a citation.\n` +
        `    haiku  ${h.latchPass}/${h.latchN} correct · median ${median(h.latchLat)}ms\n` +
        `    sonnet ${s.latchPass}/${s.latchN} correct · median ${median(s.latchLat)}ms\n` +
        `    → latency the latch cost, per segment: ${median(s.latchLat) - median(h.latchLat)}ms`,
    );
    console.log(
      `\n  The verifier is a fabrication filter, not a correctness oracle.\n` +
        `  Misattributions survive it with canonical text attached:\n` +
        `    haiku ${h.misattributedVer}   sonnet ${s.misattributedVer}\n` +
        `  Re-introducing escalation is only defensible if Sonnet's\n` +
        `  misattribution count is <= Haiku's AND it wins enough merges to pay\n` +
        `  for ${median(s.lat) - median(h.lat)}ms of extra latency per segment.`,
    );
  }

  console.log(
    `\n  A case counts as correct only if merge behavior, citation accuracy, and\n` +
      `  terminology ALL hold, with no fabricated and no misattributed citation.`,
  );
})();

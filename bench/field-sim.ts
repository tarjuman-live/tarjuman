/**
 * Field-test BENCH SIMULATION (not the real acoustic test).
 *
 * Exercises the two live-API legs of the Tarjuman pipeline against degraded
 * Arabic audio + curated inputs:
 *   1. STT  — streams 16k mono PCM to the REAL Deepgram nova-3 (exact prod params).
 *   2. MT   — runs the result through the REAL Claude translation prompt
 *             (Haiku/Sonnet routing + the production system prompt).
 *
 * What this does NOT cover (be honest): real acoustic capture through air,
 * the browser Web Audio pipeline (highpass/lowpass/compressor/gain), the
 * client speaker-lock/diarize logic in use-deepgram.ts, and the sunnah.com/
 * quran.com citation enrichment. A green run here means the plumbing works
 * and Arabic isn't catastrophically broken — it does NOT replace the masjid.
 *
 * Run: npx tsx bench/field-sim.ts
 */
import WebSocket from "ws";
import { readFileSync, existsSync } from "node:fs";
import {
  ISLAMIC_TERMINOLOGY_RULES,
  ISLAMIC_FEW_SHOT_EXAMPLES,
} from "../src/lib/islamic-terminology";

// ── env ──────────────────────────────────────────────────────────────────
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}
const ENV = loadEnv();
const DG_KEY = ENV.DEEPGRAM_API_KEY;
const ANTHROPIC_KEY = ENV.ANTHROPIC_API_KEY;
if (!DG_KEY || !ANTHROPIC_KEY) {
  console.error("Missing DEEPGRAM_API_KEY or ANTHROPIC_API_KEY in .env.local");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Deepgram (exact prod params from src/app/api/deepgram/route.ts) ────────
const DG_PARAMS = new URLSearchParams({
  language: "ar",
  model: "nova-3",
  encoding: "linear16",
  sample_rate: "16000",
  channels: "1",
  punctuate: "true",
  smart_format: "true",
  interim_results: "true",
  endpointing: "500",
  diarize: "true",
});
const DG_URL = `wss://api.deepgram.com/v1/listen?${DG_PARAMS.toString()}`;

interface SttResult {
  transcript: string;
  finalSegments: { text: string; confidence: number }[];
  closeCode: number;
  error?: string;
}

function streamToDeepgram(pcmPath: string): Promise<SttResult> {
  return new Promise((resolve) => {
    const pcm = readFileSync(pcmPath);
    const finals: { text: string; confidence: number }[] = [];
    let settled = false;
    const ws = new WebSocket(DG_URL, {
      headers: { Authorization: `Token ${DG_KEY}` },
    });

    const done = (extra: Partial<SttResult> = {}) => {
      if (settled) return;
      settled = true;
      resolve({
        transcript: finals.map((f) => f.text).join(" ").replace(/\s+/g, " ").trim(),
        finalSegments: finals,
        closeCode: 0,
        ...extra,
      });
    };

    ws.on("open", async () => {
      // ~250ms audio per chunk (16000 * 2 bytes * 0.25), paced ~3x realtime.
      const CHUNK = 8000;
      for (let i = 0; i < pcm.length; i += CHUNK) {
        if (ws.readyState !== WebSocket.OPEN) break;
        ws.send(pcm.subarray(i, i + CHUNK));
        await sleep(35);
      }
      // Flush: tell Deepgram no more audio is coming so it emits trailing finals.
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "CloseStream" }));
      }
    });

    ws.on("message", (raw) => {
      let msg: {
        type?: string;
        is_final?: boolean;
        channel?: { alternatives?: { transcript?: string; confidence?: number }[] };
      };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "Results" && msg.is_final) {
        const alt = msg.channel?.alternatives?.[0];
        const t = (alt?.transcript ?? "").trim();
        if (t) finals.push({ text: t, confidence: alt?.confidence ?? 0 });
      }
    });

    ws.on("close", (code) => done({ closeCode: code }));
    ws.on("error", (e) => done({ error: String(e), closeCode: -1 }));
    // Hard timeout so a stuck socket can't hang the bench.
    setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      done({ error: "timeout" });
    }, 120_000);
  });
}

// ── Translation (faithful to src/app/api/translate/route.ts) ───────────────
const MODEL_HAIKU = "claude-haiku-4-5-20251001";
const MODEL_SONNET = "claude-sonnet-4-6";

// Quran/hadith routing markers (copied from the route — escalate to Sonnet).
const ISLAMIC_MARKERS: RegExp[] = [
  /قال\s+النبي/,
  /قال\s+رسول\s+الله/,
  /قال\s+صلى\s+الله\s+عليه\s+وسلم/,
  /عن\s+(?:أبي|ابن|أنس|عائشة|عمر|علي|عثمان|أبو|سعد|جابر|بريدة)/,
  /روى\s+(?:البخاري|مسلم|أبو|الترمذي|النسائي|ابن|الإمام|أحمد|مالك|الحاكم|البيهقي)/,
  /حدثنا/,
  /أخبرنا/,
  /قال\s+الله\s+(?:تعالى|عز\s+وجل|سبحانه)/,
  /في\s+سورة/,
  /(?:سورة|الآية|آية)\s+/,
];
const routeModel = (text: string) =>
  ISLAMIC_MARKERS.some((re) => re.test(text)) ? MODEL_SONNET : MODEL_HAIKU;

// Static preamble copied verbatim from route.ts SYSTEM_PROMPT, then the shared
// rules + few-shot examples appended exactly as the route assembles them.
const SYSTEM_PREAMBLE = `You are a translation engine for a live transcription app used by Sunni Muslim audiences for Islamic sermons (khutbahs), lectures, classes, Quranic study, and religious talks. Interpret all Islamic content within the framework of Ahl as-Sunnah wal-Jama'ah following the methodology of the Salaf as-Salih (the righteous predecessors). Translate the user's text from the source language to the target language and output ONLY the translation — no preamble, no commentary, no quotation marks, no language labels.

## General rules
- Output ONLY the translation. Never address the user. Never include notes, warnings, parentheticals about input quality, requests for clarification, or any text that is not itself a translation of the input.
- Match the register of the source. Formal Arabic (MSA / classical) → formal English. Conversational → conversational.
- Input may be a fragment or mid-sentence — this is a live transcription app, so the speaker hasn't finished. Translate fragments as fragments. If a word is cut off mid-syllable, translate what's there and end with "..." rather than commenting on the cut.
- If the input is already in the target language, output it unchanged.
- If the input is empty, gibberish, or genuinely untranslatable, output an empty string (do not invent translations of noise, do not explain why).
- OFF-LANGUAGE AUDIO: the STT engine is FORCED to the source language, so speech in any other language arrives as a phonetic transliteration into the source script — it looks like source-language words but reads as incoherent nonsense (e.g. English "okay so basically" arriving as "اوكي سو بيسكلي"). If the text is clearly such a transliteration of non-source speech rather than real source-language content, output an empty string. Do NOT attempt a best-effort translation of transliterated noise.
- The Islamic-terminology rules below apply REGARDLESS of source language.

`;
const SYSTEM_PROMPT = `${SYSTEM_PREAMBLE}\n${ISLAMIC_TERMINOLOGY_RULES}\n\n${ISLAMIC_FEW_SHOT_EXAMPLES}`;

function shouldFilterAsNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return t.split(/\s+/).filter(Boolean).length < 3; // <3 words = noise (route rule)
}

async function translate(text: string): Promise<{ out: string; model: string; filtered?: boolean }> {
  if (shouldFilterAsNoise(text)) return { out: "", model: "(filtered <3 words)", filtered: true };
  const model = routeModel(text);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: model === MODEL_SONNET ? 1500 : 500,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Translate from Arabic to English:\n\n${text}` }],
    }),
  });
  if (!res.ok) {
    return { out: `[HTTP ${res.status} ${(await res.text()).slice(0, 120)}]`, model };
  }
  const data = (await res.json()) as { content?: { text?: string }[] };
  return { out: (data.content?.[0]?.text ?? "").trim(), model };
}

// ── curated terminology probe (clean + deliberately ASR-garbled) ───────────
const PROBE: { label: string; ar: string; expect: string }[] = [
  {
    label: "Khutbah opening (clean MSA)",
    ar: "الحمد لله نحمده ونستعينه ونستغفره ونعوذ بالله من شرور أنفسنا",
    expect: "Allah preserved (not 'God'); formal register",
  },
  {
    label: "Quranic verse w/ surah ref",
    ar: "قال الله تعالى في سورة البقرة إنا لله وإنا إليه راجعون",
    expect: "Routes to Sonnet; verse rendered + (Quran Al-Baqarah:156)",
  },
  {
    label: "Hadith — actions by intentions",
    ar: "قال النبي محمد إنما الأعمال بالنيات",
    expect: "Prophet Muhammad ﷺ; (Sahih al-Bukhari 1)",
  },
  {
    label: "Fiqh terms preserved",
    ar: "الصلاة فرض على كل مسلم والصدقة سنة مؤكدة",
    expect: "Salah/fard/Sadaqah/Sunnah Muakkadah kept, not flattened",
  },
  {
    label: "ASR-garbled (missing diacritics + run-on)",
    ar: "الحمد لله الذي خلق السموات والارض وجعل الظلمات والنور",
    expect: "Still usable English; Allah preserved",
  },
  {
    label: "Off-language transliteration (should → empty)",
    ar: "اوكي سو ذيس از ذا بوينت اوف ذا توك تو داي",
    expect: "Empty string (model judges transliterated English noise)",
  },
  {
    label: "Du'a, NOT a verse (no fake citation)",
    ar: "اللهم اجعلنا من عبادك الصالحين واغفر لنا ذنوبنا",
    expect: "No invented (Quran X:Y); terminology preserved",
  },
];

// ── main ───────────────────────────────────────────────────────────────────
const CONDITIONS = [
  { key: "C0-control", file: "bench/audio/c0-control.pcm", desc: "16k mono, near-clean (control)" },
  { key: "C1-2m", file: "bench/audio/c1-2m.pcm", desc: "vol 0.5 + light reverb + brown noise (~2 m)" },
  { key: "C2-4m", file: "bench/audio/c2-4m.pcm", desc: "vol 0.3 + heavy reverb + more noise (~4 m)" },
];

async function main() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" TARJUMAN FIELD-SIM (bench) — real Deepgram nova-3 + real Claude MT");
  console.log("══════════════════════════════════════════════════════════════\n");

  // ── Leg 1: STT on degraded audio ──
  for (const c of CONDITIONS) {
    console.log(`\n─── ${c.key}: ${c.desc} ───`);
    if (!existsSync(c.file)) {
      console.log(`  ⚠ ${c.file} missing — skipping (degradation step didn't produce it)`);
      continue;
    }
    const t0 = Date.now();
    const r = await streamToDeepgram(c.file);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.error) {
      console.log(`  ✗ STT error: ${r.error} (close ${r.closeCode})`);
      continue;
    }
    const avgConf =
      r.finalSegments.length > 0
        ? (r.finalSegments.reduce((a, s) => a + s.confidence, 0) / r.finalSegments.length).toFixed(2)
        : "n/a";
    console.log(`  finals: ${r.finalSegments.length} · avg confidence: ${avgConf} · ${dt}s`);
    console.log(`  AR: ${r.transcript || "(empty — no transcript)"}`);
    if (r.transcript) {
      const tr = await translate(r.transcript);
      console.log(`  EN [${tr.model.split("-")[1]}]: ${tr.out || "(empty)"}`);
    }
  }

  // ── Leg 2: translation terminology probe ──
  console.log("\n\n═══ TRANSLATION TERMINOLOGY PROBE (clean inputs, real Claude) ═══");
  for (const p of PROBE) {
    const tr = await translate(p.ar);
    console.log(`\n• ${p.label}  [${tr.model.includes("sonnet") ? "Sonnet" : tr.model.includes("haiku") ? "Haiku" : tr.model}]`);
    console.log(`  AR:     ${p.ar}`);
    console.log(`  EN:     ${tr.filtered ? "(filtered: <3 words)" : tr.out || "(empty string)"}`);
    console.log(`  expect: ${p.expect}`);
  }
  console.log("\n══════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("BENCH FAILED:", e);
  process.exit(1);
});

# Tarjuman Bench-Sim Results (NOT the real field test)

**Run:** 2026-06-22 · `npx tsx bench/field-sim.ts` · live Deepgram nova-3 + live Claude.

> ⚠️ **This is a bench simulation, not the field test.** It exercises the two
> live-API legs (STT + translation) against **digitally** degraded audio. It does
> **NOT** reproduce real acoustic capture through air, real masjid reverb (marble
> walls, PA comb-filtering, crowd murmur, AC hum), or a phone-mic transfer
> function. Per `field-test-protocol.md` §2 and §11, only the physical test
> validates the product. Treat these numbers as **optimistic** — a plumbing +
> quality de-risk, not a pass.

## Method
- **Source:** ~100s of a YouTube Arabic khutbah (clear MSA orator). Note: already a
  relatively clean recording — my degradation is layered on top, so the starting
  point is easier than air capture.
- **3 conditions**, each = a room channel (distance attenuation + `aecho` reverb +
  brown noise) **then the app's own Web Audio pipeline** (highpass 120 → lowpass
  7000 → compressor → gain 1.6, matching `src/lib/audio-processor.ts`) → 16k mono
  PCM → Deepgram. So the bytes Deepgram saw match production.
- **STT params:** exact production set (`language=ar, model=nova-3, encoding=linear16,
  sample_rate=16000, endpointing=500, diarize=true, smart_format, punctuate`).
- **Translation:** the real route's model routing (Haiku / Sonnet-for-Quran-hadith)
  + the production system prompt (shared Islamic-terminology rules + few-shot).
  Bypassed: auth, rate-limit, and sunnah.com/quran.com citation enrichment.

## STT leg — Deepgram nova-3 on degraded Arabic

| Condition | Degradation | Finals | Avg conf | Transcript coherence |
|---|---|---|---|---|
| C0 control | near-clean | 15 | 0.99 | Fully coherent |
| C1 ~2 m | vol 0.5 + light reverb + brown noise | 14 | 1.00 | Fully coherent, ~equal to C0 |
| C2 ~4 m | vol 0.3 + heavy reverb + more noise | 16 | 1.00 | Coherent gist; a few word errors ↓ |

Degradation-induced errors appeared only at C2 (harsh): `الجنة` (paradise) misheard as
`الجن` (jinn); the 2nd `يزني` (commits zina) became `يسري` (travels); `والعياذ بالله`
flattened. C0/C1 were essentially perfect. **The confidence stayed 1.00 even at C2 —
a live demonstration of the §8 blind spot: high confidence ≠ clean audio.**

## Translation leg — Claude

Terminology preservation across all conditions was flawless: `La ilaha illa Allah`,
`Azza wa Jall`, `Subhanahu wa Ta'ala`, `Mizan (the scale of deeds)`, `zina` all kept,
never flattened to generic English. Register matched the khutbah. Model routing fired
correctly (Haiku for narrative, Sonnet for verse/hadith).

## Terminology probe — 7/7

| # | Input | Result | Verdict |
|---|---|---|---|
| 1 | Khutbah opening | "Allah" kept, formal register | ✅ |
| 2 | Quranic verse + surah | Sonnet · rendered + **(Quran Al-Baqarah:156)** correct | ✅ |
| 3 | Hadith (actions by intentions) | Prophet Muhammad ﷺ + **(Sahih al-Bukhari 1)** correct | ✅ |
| 4 | Fiqh terms | Salah/fard/Sadaqah/Sunnah Muakkadah all preserved | ✅ |
| 5 | "Garbled" verse | Recognized as real ayah + **(Quran Al-An'am:1)** correct | ✅ |
| 6 | English-in-Arabic-script | Returned **empty string** (off-language gate) | ✅ |
| 7 | Du'a (not a verse) | No fabricated citation; terminology kept | ✅ |

All three citations the model emitted are genuinely correct (verified by hand). The
off-language gate and the no-fabrication rule both held.

## Verdict (bench)

- **Plumbing:** ✅ Both legs work end-to-end against live APIs.
- **STT on clean→moderate MSA:** ✅ Excellent.
- **Translation + Islamic terminology:** ✅ Essentially perfect on this battery.
- **Real-masjid viability:** ❓ **UNKNOWN — still requires the physical test.** This
  bench is optimistic: clean source recording + crude digital degradation. Real
  acoustics are harsher and more complex than `aecho` + brown noise.

**Bottom line:** the core (Arabic STT + terminology-preserving translation) is sound
and de-risked. The remaining question — does it survive a real PA + reverberant room?
— is exactly what `field-test-protocol.md` §11 says only the masjid trip can answer.

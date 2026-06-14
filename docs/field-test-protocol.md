# Tarjuman Field-Test Protocol

**Purpose:** prove — or disprove — that Tarjuman produces a *usable* Arabic→English transcript when
a phone captures audio from a PA speaker across a room. This is the single assumption the whole
product rests on, and until you run this test you don't actually know whether it holds.

Run this before spending another hour on features, marketing, or polish. A week of validation here
can save three months of building on top of a core that doesn't work.

---

## 1. Why this test exists

Tarjuman's promise is real-time understanding of a live khutbah/lecture. Everything else — the
landing page, summaries, history, settings — is scaffolding around one question:

> When the phone is 1–2 meters from a speaker in a reverberant room, can a non-Arabic speaker
> **follow the meaning** of what's being said, live, from Tarjuman's screen?

"Works" is not the bar. **Usable** is the bar. Define it concretely before you start:

- **Live usability:** a person who speaks no Arabic could follow the gist of the talk in real time
  from the English column — not every word, but the actual point of each passage.
- **Summary usability:** after stopping, the AI summary names the real main topic and the real key
  points (not hallucinated ones).

If both are true at 1–2 m in moderate noise, the core is validated. If not, you have a precise,
prioritized fix list (§10) instead of a vague "it's not good enough."

---

## 2. Why play through a speaker — not headphones

Do **not** test by piping clean YouTube audio straight into the browser. That tests Deepgram's
model on pristine audio, which is the easy case and not your use case.

The real input is sound that has left a PA system, traveled through air, bounced off hard walls,
and mixed with crowd noise and AC hum before reaching a phone mic. You **must** reproduce that
degradation: play the source out loud through a speaker, and capture it through the air with the
phone. Anything else is measuring the wrong thing.

---

## 3. Equipment

- **Capture device:** the phone you expect users to have (test the worst common one, not your best).
- **Playback speaker:** a separate Bluetooth speaker, laptop, or second phone — loud enough to fill
  a room. Not the same device that's capturing.
- **Source audio:** a real Arabic khutbah or lecture from YouTube (see §4 for variety). Use real
  delivery, not a slow studio reading.
- **A way to mark distance:** tape measure or counted floor tiles for 1 m / 2 m / 4 m.
- **A room with hard surfaces** if possible (tile/marble/concrete) — that reverb is the hard part.
- **Optional noise source:** a fan, AC, or low background chatter to simulate a real gathering.

---

## 4. Test matrix

Run the conditions that matter most first (1–2 m, moderate volume, MSA khutbah). Expand outward
only if the core passes the easy cases.

| Axis | Values |
|---|---|
| **Distance** | 1 m · 2 m · 4 m |
| **Volume** | moderate (normal listening) · loud (PA-like) |
| **Noise** | silent room · ambient (fan/AC + light chatter) |
| **Source type** | MSA khutbah · Quran recitation · fast-paced lecture · dialectal speech |

You do not need every combination. Prioritize:

1. 1 m, moderate, silent, MSA khutbah ← the "does it work at all" baseline
2. 2 m, moderate, ambient, MSA khutbah ← the realistic masjid case
3. 2 m, loud, ambient, fast lecture ← the stress case
4. One Quran-recitation sample and one dialectal sample ← coverage of harder material

---

## 5. Procedure (per condition)

1. Open Tarjuman → `/record`. Set **source = Arabic, target = English**.
2. Position the phone at the target distance, mic pointed toward the speaker, uncovered.
3. Start the source audio, then start recording.
4. **Watch the live signal meter** (the bars + level under the language bar). It must read
   **good or strong**. If the amber **"Move closer to the speaker — signal is weak"** warning
   appears and stays, the capture is too quiet — fix position/volume before trusting any result
   from this run. (See §8 for what the meter does and doesn't tell you.)
5. Record **~5 minutes**. Note the wall-clock start so you can line up chunks later.
6. Stop. Generate the summary.
7. Score using §6 and log into §7. Repeat for the next condition.

---

## 6. Scoring rubric (per ~1-minute chunk)

Grade each minute, not the session as a whole — averages hide where it breaks.

| Dimension | Scale | What you're judging |
|---|---|---|
| **Transcription fidelity** | Good ≥90% · Partial 70–90% · Poor <70% | Is the **Arabic** text right? Rough word accuracy by ear. |
| **Translation usability** | **Pass / Partial / Fail** | Could a non-Arabic speaker follow the **meaning** from the English? This is the headline metric. |
| **Latency** | seconds | Time from a sentence being spoken to it appearing on screen. |
| **Segmentation** | Good / Fragmented | Are sentences whole, or chopped mid-thought? |
| **Dropouts** | count | Spoken passages that produced no transcript at all. |
| **Islamic terms** | Kept / Flattened | Allah, the ﷺ honorific, Quran/hadith citations — preserved correctly? |

**Translation usability is the metric that decides the test.** The others explain *why* it passed
or failed and point at which knob to turn.

---

## 7. Results log (copy one block per condition)

```
Condition: ____ m · ____ volume · ____ noise · source: ____________
Signal meter held at: silent / quiet / good / strong

Chunk | Transcription | Translation | Latency | Segments   | Dropouts | Terms
------+---------------+-------------+---------+------------+----------+---------
 0–1m |               | Pass/Part/Fail |  __s  | Good/Frag  |   __     | Kept/Flat
 1–2m |               |             |         |            |          |
 2–3m |               |             |         |            |          |
 3–4m |               |             |         |            |          |
 4–5m |               |             |         |            |          |

Translation: __ Pass / __ Partial / __ Fail   →  __% Pass
Summary named the real topic + key points?  Yes / Partly / No
Notes (what broke, where): ______________________________________
```

---

## 8. Interpreting the signal meter (read this — it has a blind spot)

The meter is wired to the audio **after** the processing pipeline — after the compressor and the
1.6× makeup gain (`src/lib/audio-processor.ts`, analyser connected at the gain node). That's
deliberate: it shows what Deepgram actually receives. But it has one important limitation:

- **It measures signal *level*, not signal-to-noise *quality*.** The compressor + gain will boost a
  quiet, noisy, reverberant signal up to a healthy-looking level. So the meter can read **strong**
  while the underlying audio is mush.

Use this to diagnose, not just to reassure:

| Meter | Transcript | Diagnosis |
|---|---|---|
| Weak (amber warning) | Poor | **Level problem** — move closer / raise volume / boost gain (§10). |
| Good / strong | Poor | **SNR / reverb problem** — the level is fine but the audio is too noisy or echoey. Moving closer or reducing room reverb helps; raising gain will **not**. |
| Good / strong | Good | Working. |

A strong meter is necessary but not sufficient. Don't conclude "the model is bad" from a strong
meter alone — first rule out reverb and noise.

---

## 9. Pass / fail decision

Judge on the realistic case: **1–2 m, moderate volume**, against translation-usability Pass rate.

- **≥80% chunks Pass** → **core validated.** Stop tuning. Go get 5–10 real users (next priority).
- **60–80% Pass** → **usable but needs tuning.** Work the §10 guide, re-test the same conditions.
- **<60% Pass** → **core not ready.** Do not market, do not add features. Fix the pipeline first;
  this is the only thing that matters until it clears 60%.

Also gate on the summary: if transcription passes but summaries invent topics, that's a
summarization-prompt problem (`src/app/api/summarize/route.ts`), separate from capture/STT.

---

## 10. Tuning guide — if results are poor

Each knob below is real, current code. Change one thing at a time and re-test the same condition so
you can attribute the difference. (Values here reflect the code as of this writing; if the pipeline
is retuned later, refresh these numbers.)

| Symptom | Knob | Where | Direction |
|---|---|---|---|
| Too quiet (meter weak even up close) | makeup gain `1.6` | `src/lib/audio-processor.ts` (~line 145) | raise toward `2.0–2.5` (watch for clipping) |
| Distant speech under-amplified | compressor `threshold -26`, `ratio 4` | `src/lib/audio-processor.ts` (~lines 135–137) | lower threshold to `-32`, raise ratio to `6:1` |
| Low-frequency rumble / hum | highpass `120 Hz` | `src/lib/audio-processor.ts` (~line 117) | raise to `150–180 Hz` (slight warmth loss) |
| Hiss / crowd sibilance | lowpass `7000 Hz` | `src/lib/audio-processor.ts` (~line 125) | lower to `5000–6000 Hz` (slight consonant dulling) |
| Sentences fragment at every pause | `endpointing=500` | `src/app/api/deepgram/route.ts` (~line 140) | raise to `800–1000` ms |
| Side conversations bleed in | speaker-lock warmup `15 s`, min-duration `5 s` | `src/hooks/use-deepgram.ts` (~lines 102–104) | lower warmup, raise min-duration |
| Junk / low-confidence lines in transcript | `FINAL_CONFIDENCE_THRESHOLD 0.55` | `src/hooks/use-deepgram.ts` (~line 88) | raise to `0.65–0.75` (drops quieter speech too) |
| Near-silence padding the transcript | noise gate `−55 dBFS` | `public/pcm-worklet.js` (~line 20) | raise toward `−50 dBFS` (stricter gate) |

The STT model itself is `nova-3` (`src/app/api/deepgram/route.ts`, ~line 120) — required for
Arabic. If Arabic accuracy is fundamentally poor even with clean capture, the lever is the model,
not these knobs, and that's a deeper investigation.

> **Doc drift note:** `CLAUDE.md` still says `model=nova-2`. That is **stale** — the code runs
> `nova-3`, because nova-2 returns HTTP 400 on any Arabic (`language=ar`) connection. Trust the
> code, not CLAUDE.md, on this.

---

## 11. The real test

The simulated matrix gets you 90% of the confidence. The last 10% only comes from the real
environment: take the phone to an actual khutbah or lecture, run one full session, and score it the
same way. Real rooms, real PA systems, and real crowd noise will surface things a living-room
simulation won't. Do this once before you tell anyone the product works.

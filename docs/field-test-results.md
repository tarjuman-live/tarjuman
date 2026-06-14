# Tarjuman Field-Test Results

Fill this in as you run the conditions from [`field-test-protocol.md`](./field-test-protocol.md).
One block per condition. Grade per ~1-minute chunk. The metric that decides the test is
**translation usability** (Pass / Partial / Fail — could a non-Arabic speaker follow the meaning?).

> **Before you start:** sign in to the app first. Transcription works signed-out, but **translation
> requires login** (the `/api/translate` route returns 401 otherwise) — you'd see Arabic with no
> English. Set source = **Arabic**, target = **English**.

**Run date:** ____________  **Phone:** ____________  **Room:** ____________

---

## Condition 1 — baseline · 1 m · moderate volume · silent room · MSA khutbah

Source clip: ____________________   Signal meter held at: silent / quiet / good / strong

| Chunk | Transcription (Good/Part/Poor) | Translation (Pass/Part/Fail) | Latency (s) | Segments (Good/Frag) | Dropouts | Terms (Kept/Flat) |
|-------|--------------------------------|------------------------------|-------------|----------------------|----------|-------------------|
| 0–1m  |                                |                              |             |                      |          |                   |
| 1–2m  |                                |                              |             |                      |          |                   |
| 2–3m  |                                |                              |             |                      |          |                   |
| 3–4m  |                                |                              |             |                      |          |                   |
| 4–5m  |                                |                              |             |                      |          |                   |

Translation: __ Pass / __ Partial / __ Fail → **__% Pass** Summary named real topic + key points? Y / Partly / N
Notes: ___________________________________________________________________

---

## Condition 2 — realistic masjid · 2 m · moderate · ambient (fan/AC + light chatter) · MSA khutbah

Source clip: ____________________   Signal meter held at: silent / quiet / good / strong

| Chunk | Transcription | Translation | Latency (s) | Segments | Dropouts | Terms |
|-------|---------------|-------------|-------------|----------|----------|-------|
| 0–1m  |               |             |             |          |          |       |
| 1–2m  |               |             |             |          |          |       |
| 2–3m  |               |             |             |          |          |       |
| 3–4m  |               |             |             |          |          |       |
| 4–5m  |               |             |             |          |          |       |

Translation: __ Pass / __ Partial / __ Fail → **__% Pass** Summary good? Y / Partly / N
Notes: ___________________________________________________________________

---

## Condition 3 — stress · 2 m · loud · ambient · fast-paced lecture

Source clip: ____________________   Signal meter held at: silent / quiet / good / strong

| Chunk | Transcription | Translation | Latency (s) | Segments | Dropouts | Terms |
|-------|---------------|-------------|-------------|----------|----------|-------|
| 0–1m  |               |             |             |          |          |       |
| 1–2m  |               |             |             |          |          |       |
| 2–3m  |               |             |             |          |          |       |
| 3–4m  |               |             |             |          |          |       |
| 4–5m  |               |             |             |          |          |       |

Translation: __ Pass / __ Partial / __ Fail → **__% Pass**
Notes: ___________________________________________________________________

---

## Condition 4 — coverage · Quran recitation + dialectal samples · 1–2 m

| Sample | Transcription | Translation | Terms (Kept/Flat) | Notes |
|--------|---------------|-------------|-------------------|-------|
| Quran recitation |        |             |                   |       |
| Dialectal speech |        |             |                   |       |

---

## VERDICT (judge on Conditions 1–2, the realistic 1–2 m cases)

- [ ] **≥80% translation Pass → CORE VALIDATED.** Stop tuning. Go get 5–10 real users.
- [ ] **60–80% Pass → USABLE, NEEDS TUNING.** Work the protocol's §10 tuning guide, re-test.
- [ ] **<60% Pass → CORE NOT READY.** Fix the pipeline before features/marketing. Note what failed:

If transcription passed but the **summary** invented topics → that's a summarization-prompt issue
(`src/app/api/summarize/route.ts`), separate from capture/STT.

**Biggest failure pattern observed:** _______________________________________________
**Decision:** ___ validated / ___ tune / ___ fix pipeline

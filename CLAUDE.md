# CLAUDE.md — Tarjuman Build Instructions

## WHAT YOU ARE BUILDING

Tarjuman is a real-time speech transcription and translation web app. A user selects a source language (e.g., Arabic) and target language (e.g., English), taps record, and instantly sees live transcription and translation on screen. When the session ends, they can generate an AI summary of the entire transcript — instant notes without writing anything down.

**Primary use case:** Non-Arabic speakers attending khutbahs, lectures, and classes in Madinah/Saudi Arabia. Also: conferences, multilingual meetings, educational settings.

**Core flow:** Select languages → Record → See live transcription + translation → Pause/Resume → Stop → View transcript → Generate summary → Access history anytime.

## INTERACTIVE PROTOTYPE

An interactive prototype is included in this package as `prototype.jsx`. Open it to see and interact with every state: idle (language selection + record button), recording (live Arabic transcript appearing segment by segment with translations), paused, completed (with AI summary generation), history list, and session detail view. **This prototype is the visual source of truth.** Match its layout, flow, colors, and interactions exactly.

## CRITICAL: SPEAKER AUDIO ENVIRONMENT

This app will primarily capture audio from **PA speakers in masjids, lecture halls, and conference rooms** — NOT direct close-mic speech. The phone mic picks up sound that has traveled through a speaker system, bounced off marble/concrete walls, mixed with crowd noise, coughs, AC hum, and ambient reverb.

**This means:**
1. Raw mic input will be noisy. The app MUST process audio through a Web Audio API pipeline (highpass → lowpass → compressor → gain) BEFORE sending it to the STT engine. See the "Audio Capture Details" section for the complete pipeline.
2. STT parameters must be tuned for noisy environments. On Speechmatics that means `operating_point: "enhanced"` and `max_delay: 1.5` (trading latency for right-context so the model can correct itself); on the Deepgram fallback it means `endpointing=500` and `smart_format=true` on `nova-3`.
3. An audio level monitor component must show users whether the mic is picking up adequate signal — if it's too quiet, prompt them to move closer to the speaker.
4. Show first-time users positioning tips: hold phone close to speaker, point mic toward sound source, avoid covering mic.

## TECH STACK

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 15 (App Router) + TypeScript | SSR for landing page, API routes for backend, consistent ecosystem |
| Backend / DB | Convex | Real-time subscriptions, file storage, serverless, type-safe |
| Auth | Convex Auth (email/password + Google OAuth) | Integrated, simple, handles sessions |
| Styling | Tailwind CSS + shadcn/ui | Fast, mobile-first, accessible components |
| Speech-to-Text | **Speechmatics** realtime (WebSocket) — primary; **Deepgram** `nova-3` — fallback | Speechmatics won the 2026-08 Arabic bake-off: whole coherent sentences at ~1.00 confidence where nova-3 fragmented and dropped clauses. Deepgram stays wired behind a one-line switch (`STT_PROVIDER`). |
| Translation | Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Preserves Islamic terminology (Allah, Subhan'Allah, ﷺ, etc.) where Google Translate flattens them. Single LLM provider. |
| Summarization | Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`) | High-quality contextual summaries, handles religious/academic terminology |
| Hosting | Vercel | Zero-config Next.js deployment |
| Error Tracking | Sentry | Error monitoring from day one |

## ENVIRONMENT VARIABLES

```
# Convex
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=

# Speechmatics — PRIMARY realtime STT
SPEECHMATICS_API_KEY=

# Deepgram — FALLBACK STT (only used when STT_PROVIDER = "deepgram")
DEEPGRAM_API_KEY=

# Anthropic (for translation + summaries)
ANTHROPIC_API_KEY=

# Sentry
NEXT_PUBLIC_SENTRY_DSN=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## API SETUP GUIDE

### Speechmatics (PRIMARY STT)
1. Sign up at portal.speechmatics.com
2. Generate an API key
3. `/api/speechmatics` exchanges it for a short-lived JWT (`POST https://mp.speechmatics.com/v1/api_keys?type=rt`) so the long-lived key never reaches the browser
4. Streaming endpoint: `wss://global.rt.speechmatics.com/v2`
5. ⚠️ **Free tier = 2 concurrent sessions, app-wide.** The third simultaneous
   recorder anywhere gets `quota_exceeded`. Must be upgraded before multi-user
   launch — this is a hard launch constraint, not a tuning detail.

### Deepgram (FALLBACK STT)
1. Sign up at deepgram.com
2. Create a new project
3. Generate an API key with `keys:write` scope (prod mints short-lived session keys)
4. Free tier: $200 in credit (covers ~775 hours of transcription)
5. Streaming endpoint: `wss://api.deepgram.com/v1/listen`
6. Only reached when `STT_PROVIDER` in `src/lib/constants.ts` is flipped to
   `"deepgram"`, plus `/dev/stt-compare`, which always runs both engines.

### Anthropic Claude (translation + summaries)
1. Go to console.anthropic.com
2. Generate an API key (`sk-ant-api03-...`)
3. Models used:
   - Translation (per-segment, low-latency): `claude-haiku-4-5-20251001`
   - Summarization (one-shot per session): `claude-sonnet-4-6`
4. Endpoint: `https://api.anthropic.com/v1/messages`
5. Why Claude (not Google Translate / DeepL): preserves Islamic terminology
   correctly (Allah, Subhan'Allah, ﷺ, etc.) — DeepL has no Arabic support;
   Google flattens religious terms in ways the khutbah audience finds wrong.

## FILE STRUCTURE

```
livetranscribe/
├── CLAUDE.md
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── .env.local
├── vercel.json
│
├── convex/
│   ├── _generated/
│   ├── schema.ts                    # Complete database schema
│   ├── auth.config.ts               # Auth configuration
│   ├── auth.ts                      # Auth setup
│   ├── sessions.ts                  # Transcription session CRUD
│   ├── users.ts                     # User queries
│   └── http.ts                      # HTTP routes if needed
│
├── src/
│   ├── app/
│   │   ├── layout.tsx               # Root layout with providers + Google Fonts
│   │   ├── page.tsx                 # Landing page (marketing)
│   │   ├── globals.css              # Tailwind + custom styles
│   │   │
│   │   ├── (auth)/
│   │   │   ├── layout.tsx           # Auth layout
│   │   │   ├── login/page.tsx       # Login page
│   │   │   └── signup/page.tsx      # Signup page
│   │   │
│   │   ├── (app)/
│   │   │   ├── layout.tsx           # App layout (nav + auth guard)
│   │   │   ├── record/page.tsx      # ⭐ Main recording page
│   │   │   ├── history/page.tsx     # Session history list
│   │   │   └── session/[id]/page.tsx # View past session transcript + summary
│   │   │
│   │   └── api/
│   │       ├── speechmatics/
│   │       │   └── route.ts         # ⭐ Mint short-lived Speechmatics JWT (PRIMARY)
│   │       ├── deepgram/
│   │       │   └── route.ts         # Proxy: temporary Deepgram token (fallback)
│   │       ├── translate/
│   │       │   └── route.ts         # Proxy: Claude translation API
│   │       └── summarize/
│   │           └── route.ts         # Proxy: Claude API for summaries
│   │
│   ├── components/
│   │   ├── ui/                      # shadcn/ui components
│   │   ├── providers/
│   │   │   └── convex-provider.tsx   # ConvexProvider wrapper
│   │   ├── recording/
│   │   │   ├── language-selector.tsx # Source + target language pickers
│   │   │   ├── record-button.tsx    # Record / Pause / Resume / Stop controls
│   │   │   ├── live-transcript.tsx  # Real-time transcript display (dual column)
│   │   │   ├── audio-visualizer.tsx # Simple waveform/pulse showing mic is active
│   │   │   └── session-timer.tsx    # Duration timer
│   │   ├── session/
│   │   │   ├── transcript-view.tsx  # Full transcript view (source + translated)
│   │   │   ├── summary-view.tsx     # AI-generated summary display
│   │   │   └── session-card.tsx     # Card for history list
│   │   ├── layout/
│   │   │   ├── app-nav.tsx          # App navigation bar
│   │   │   └── mobile-nav.tsx       # Bottom nav for mobile
│   │   └── shared/
│   │       ├── loading.tsx          # Loading states
│   │       └── empty-state.tsx      # Empty states
│   │
│   ├── hooks/
│   │   ├── use-stt.ts               # ⭐ Engine dispatcher (reads STT_PROVIDER)
│   │   ├── use-speechmatics.ts      # ⭐ WebSocket connection to Speechmatics
│   │   ├── use-deepgram.ts          # WebSocket connection to Deepgram (fallback)
│   │   ├── use-translator.ts        # Translation hook
│   │   ├── use-recorder.ts          # ⭐ Mic + Web Audio pipeline → AudioWorklet (Int16 PCM)
│   │   └── use-auth.ts              # Auth state wrapper
│   │
│   ├── lib/
│   │   ├── utils.ts                 # Utility functions
│   │   ├── constants.ts             # Languages list, config values
│   │   ├── stt/
│   │   │   ├── types.ts             # Shared engine contract
│   │   │   ├── speaker-lock.ts      # ⭐ Shared, tested "ignore side conversations" policy
│   │   │   ├── keyterms.ts          # Islamic-vocabulary bias, shared by both engines
│   │   │   ├── speechmatics-client.ts # Client used by /dev/stt-compare
│   │   │   └── deepgram-client.ts   # Client used by /dev/stt-compare
│   │   ├── audio-processor.ts       # ⭐ Web Audio API pipeline (highpass → lowpass → compressor → gain)
│   │   └── languages.ts             # Supported language codes + labels
│   │
│   └── types/
│       └── index.ts                 # Shared TypeScript types
│
└── public/
    ├── logo.svg
    └── favicon.ico
```

## DATABASE SCHEMA (Convex)

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  sessions: defineTable({
    userId: v.id("users"),
    title: v.optional(v.string()),           // Auto-generated or user-set
    sourceLanguage: v.string(),               // e.g., "ar"
    targetLanguage: v.string(),               // e.g., "en"
    status: v.union(
      v.literal("recording"),
      v.literal("paused"),
      v.literal("completed")
    ),
    // Transcript stored as array of segments
    segments: v.array(v.object({
      id: v.string(),                         // Unique segment ID
      sourceText: v.string(),                 // Original transcription
      translatedText: v.string(),             // Translated text
      timestamp: v.number(),                  // Seconds from session start
    })),
    duration: v.number(),                     // Total duration in seconds
    summary: v.optional(v.string()),          // AI-generated summary
    summaryLanguage: v.optional(v.string()),  // Language of the summary
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"])
    .index("by_user_date", ["userId", "createdAt"]),
});
```

## CONVEX FUNCTIONS

### `convex/sessions.ts`

```
Queries:
- getSession(sessionId): Get a single session by ID (auth + ownership check)
- getUserSessions(userId): Get all sessions for current user, ordered by createdAt desc
- getRecentSessions(userId, limit): Get last N sessions

Mutations:
- createSession({ sourceLanguage, targetLanguage }): Create new session with status "recording"
- addSegment({ sessionId, sourceText, translatedText, timestamp }): Append a segment to the session
- addSegments({ sessionId, segments }): Batch append multiple segments (for efficiency)
- pauseSession(sessionId): Set status to "paused"
- resumeSession(sessionId): Set status to "recording"
- completeSession({ sessionId, duration }): Set status to "completed", set duration
- saveSummary({ sessionId, summary, summaryLanguage }): Save the AI summary
- updateTitle({ sessionId, title }): Update session title
- deleteSession(sessionId): Hard delete (user's own data, not medical records)
```

**Every mutation must verify the session belongs to the authenticated user.**

## API ROUTES

### `/api/speechmatics/route.ts` — Mint a Speechmatics JWT (PRIMARY)

`SPEECHMATICS_API_KEY` never reaches the browser. This route POSTs to
`https://mp.speechmatics.com/v1/api_keys?type=rt` and returns a short-lived JWT
(1h) plus the realtime URL; the client opens
`wss://global.rt.speechmatics.com/v2?jwt=<token>` directly.

A session longer than the TTL is fine: the hook re-fetches a fresh JWT on every
connect, including every backoff reconnect, so a 6-hour dars keeps minting new
credentials rather than riding one expiring token.

**Every STT credential route must carry the same three gates**, because minting
a credential is what actually spends STT budget:
1. `requireAuthFromHeader` → 401
2. `checkRateLimit(userId, "transcribe")` → 429
3. `getUsageFromHeader` plan cost gate → 402 (fails OPEN — the reactive UI is
   the primary gate)

A gate that exists on only one engine's route silently stops gating anything the
moment `STT_PROVIDER` changes. See `src/app/api/speechmatics/route.ts`.

### `/api/deepgram/route.ts` — Get Temporary Deepgram Token (FALLBACK)

Same trust model and the same three gates. In production it mints a short-lived
key via Deepgram's management API. In dev it returns a token pointing at the
`/api/deepgram-ws` loopback proxy in `server.js`, which exists because some
networks block the browser's TLS WebSocket handshake to `api.deepgram.com`.
Speechmatics has **no** such proxy — if a venue ever blocks it the same way, the
fix is to add an equivalent proxy, not to fall back silently.

See `src/app/api/deepgram/route.ts` for the implementation (`nova-3` is
required for Arabic; `nova-2` returns HTTP 400 on any `language=ar` connection).

### `/api/translate/route.ts` — Claude Translation Proxy

The route calls Anthropic's `claude-haiku-4-5-20251001` with a system prompt
that pins religious terminology (Allah, Subhan'Allah, ﷺ, etc.). The system
message is set up with `cache_control: ephemeral` so once the prompt grows
past Haiku's 2048-token caching threshold it becomes free across a session.

Request shape: `POST /api/translate { text, source?, target } → { translatedText }`.

See `src/app/api/translate/route.ts` for the implementation.

### `/api/summarize/route.ts` — Claude Summary Proxy

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { transcript, targetLanguage, context } = await req.json();

  if (!transcript) {
    return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
  }

  const languageNames: Record<string, string> = {
    en: "English", ar: "Arabic", fr: "French", es: "Spanish",
    ur: "Urdu", tr: "Turkish", ms: "Malay", id: "Indonesian",
    // Add more as needed
  };

  const targetLangName = languageNames[targetLanguage] || "English";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `You are summarizing a live transcription of spoken content${context ? ` (${context})` : ""}. The transcript below may contain transcription errors — use context to interpret unclear words.

Provide a clear, well-structured summary in ${targetLangName}. Include:
1. **Main Topic** — What was this about? (1-2 sentences)
2. **Key Points** — The most important points made (bullet points)
3. **Action Items / Takeaways** — If any practical advice or calls to action were mentioned
4. **Notable Quotes** — Any particularly impactful or memorable statements (if applicable)

Keep the summary concise but comprehensive. If this appears to be a religious lecture (khutbah), preserve the Islamic terminology and references accurately.

TRANSCRIPT:
${transcript}`,
        },
      ],
    }),
  });

  const data = await response.json();
  const summary = data.content?.[0]?.text || "Summary could not be generated.";

  return NextResponse.json({ summary });
}
```

## THE RECORDING FLOW — CRITICAL IMPLEMENTATION DETAILS

### The STT hooks (Most Important Files)

Three files, one contract:

- **`use-stt.ts`** — the dispatcher. Reads `STT_PROVIDER` from
  `src/lib/constants.ts` and returns one engine's hook. Both hooks are *called*
  unconditionally (React requires stable hook order); the inactive one gets
  `enabled: false`, its documented idle path — no credential fetch, no socket,
  no mic frames consumed. The record page never knows which engine is live.
- **`use-speechmatics.ts`** — the primary engine.
- **`use-deepgram.ts`** — the fallback engine.

Both hooks expose an identical surface, so drift shows up as a type error in the
dispatcher rather than at runtime:

```
Props: { pcmNode, sourceLanguage, enabled, paused, mainSpeakerOnly }

State:
- segments: LiveSegment[]      (final segments, already filtered)
- interimText: string          (live partial, rendered faded)
- connectionState: "idle" | "connecting" | "connected" | "reconnecting" | "error"
- error: string | null
- reconnectAttempt: number
- resetTranscript(): void
```

There is no `startRecording()`/`stopRecording()` — the hooks are **declarative**.
`use-recorder.ts` owns the mic and hands over an `AudioWorkletNode`; flipping
`enabled` opens or tears down the socket, and flipping `paused` gates outbound
frames without dropping the connection.

Shared filtering applied to every final segment, in order:
1. **Confidence floor** — `DEEPGRAM.finalConfidenceFloor` /
   `SPEECHMATICS.finalConfidenceFloor` (both 0.45, both in `lib/constants.ts`)
2. **Off-language script gate** — `lib/script.ts`, shared by both hooks
3. **Speaker lock** — `lib/stt/speaker-lock.ts`, the tested "ignore side
   conversations" policy. Generic over the speaker key because Deepgram returns
   numeric indices and Speechmatics returns labels like `"S1"`. Both engines run
   this same module; a fallback whose speaker policy silently diverges from the
   tested one is worse than no fallback.

Reconnects use `RECONNECT_BACKOFF` and re-fetch credentials on every attempt.

### Audio Capture Details — SPEAKER/AMBIENT AUDIO HANDLING

**CRITICAL CONTEXT:** This app will primarily be used to capture audio from SPEAKERS in masjids, lecture halls, and conference rooms — NOT direct microphone speech. The phone mic is picking up sound that has traveled through a PA system, bounced off marble/concrete walls, mixed with crowd noise, coughs, and ambient reverb. This is fundamentally harder than clean direct-mic input.

**Strategy: Use the Web Audio API to clean the signal BEFORE sending it to the STT engine.**

```typescript
// ═══════════════════════════════════════════════════
// AUDIO PIPELINE: Mic → AudioContext → Processing → AudioWorklet → STT
// ═══════════════════════════════════════════════════

// 1. Capture mic with browser-level noise handling enabled
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    sampleRate: { ideal: 16000 },
    echoCancellation: true,      // Cancel echo from speakers
    noiseSuppression: true,      // Browser-level noise suppression
    autoGainControl: true,       // Normalize volume levels (critical for distant speakers)
  },
});

// 2. Create AudioContext for processing pipeline
const audioContext = new AudioContext({ sampleRate: 16000 });
const source = audioContext.createMediaStreamSource(stream);

// 3. HIGH-PASS FILTER — Remove low-frequency rumble
// Masjid environments have AC hum, foot shuffling, door thuds
// Cut everything below 85Hz (speech fundamentals start ~85Hz)
const highPassFilter = audioContext.createBiquadFilter();
highPassFilter.type = "highpass";
highPassFilter.frequency.value = 85;
highPassFilter.Q.value = 0.7;

// 4. LOW-PASS FILTER — Remove high-frequency noise
// Cut above 8000Hz — speech content lives between 85Hz-8kHz
// This removes hiss, electronic interference, high-freq crowd noise
const lowPassFilter = audioContext.createBiquadFilter();
lowPassFilter.type = "lowpass";
lowPassFilter.frequency.value = 8000;
lowPassFilter.Q.value = 0.7;

// 5. COMPRESSOR — Even out volume dynamics
// PA speakers have huge dynamic range. A compressor keeps
// loud parts from clipping and brings up quiet parts.
const compressor = audioContext.createDynamicsCompressor();
compressor.threshold.value = -24;    // Start compressing at -24dB
compressor.knee.value = 12;          // Soft knee for natural sound
compressor.ratio.value = 4;          // 4:1 compression ratio
compressor.attack.value = 0.003;     // Fast attack to catch transients
compressor.release.value = 0.25;     // Medium release

// 6. GAIN — Boost the signal after compression
// Speaker audio captured by phone mic is often too quiet
const gainNode = audioContext.createGain();
gainNode.gain.value = 1.5;  // Boost by 50% — adjust based on testing

// 7. Connect the pipeline
source
  .connect(highPassFilter)
  .connect(lowPassFilter)
  .connect(compressor)
  .connect(gainNode);

// 8. Feed the processed signal into an AudioWorkletNode.
//
// ⚠️ NOT MediaRecorder. The shipped app does NOT use MediaRecorder or
// webm/opus chunks — that was the original design and it is gone. Both engines
// receive RAW LINEAR16 PCM from `public/pcm-worklet.js`: mono Int16 frames of
// 40ms, with a -55 dBFS noise gate that zero-fills silence so the engine sees
// clean silence rather than room tone. See `src/lib/audio-processor.ts`.
const pcmNode = new AudioWorkletNode(audioContext, "pcm-worklet");
gainNode.connect(pcmNode);

// The STT hook attaches to pcmNode.port.onmessage and forwards frames.
// Frames are dropped (not buffered) while paused.
```

**CRITICAL — sample rate.** Browsers are free to ignore the requested 16000 and
hand back 44100/48000. The rate declared to the engine MUST be read from
`pcmNode.context.sampleRate` at connect time, never from the requested value, or
every transcript comes back garbled. This bit iOS specifically.

### Audio Quality Tips (Document in UI or Onboarding)

Show these tips to users before recording, especially first-time users:

```
For best results:
• Hold your phone close to the speaker or place it on a surface near the speaker
• Point the bottom of your phone (where the mic is) toward the sound source
• Avoid covering the mic with your hand or case
• If using earphones, the earphone mic may pick up less ambient noise
• Quiet environments produce significantly better results
```

### Engine Parameters Explained (for noisy audio)

All values live in `src/lib/constants.ts` (`SPEECHMATICS` / `DEEPGRAM` blocks)
so both engines' knobs can be read side by side. Tune there, not in the hooks.

**Speechmatics (primary)**
```
operating_point: "enhanced"  — the accurate model, not the fast one.

max_delay: 1.5               — final-transcript latency budget (vendor range
                               0.7-4s). LOWER is snappier but gives the model
                               less right-context to correct itself, which is
                               exactly what we are paying it for. 1.5 produced
                               the winning bake-off output.

additional_vocab             — Islamic keyterms from lib/stt/keyterms.ts,
                               always on for this engine.

diarization + prefer_current_speaker — held one stable label across testing,
                               which is why its diarize warmup is 10s vs
                               Deepgram's 25s.
```

**Known trade:** Speechmatics finals land ~1.3-1.5s behind the speaker vs
Deepgram's ~0.4-0.8s. Accuracy wins — the transcript is the product.

**Deepgram (fallback)**
```
model=nova-3        — REQUIRED for Arabic. nova-2 returns HTTP 400 on any
                       /listen connection with language=ar. nova-3 is a strict
                       superset of nova-2's language coverage.

endpointing=500     — Wait 500ms of silence before finalizing (up from 300ms).
                       Speakers in masjids pause between sentences. A longer
                       endpointing window prevents premature segment breaks.

smart_format=true   — Intelligent formatting (numbers, dates, punctuation).

keyterm=…           — OPT-IN behind ?keyterms=1, and never proven on a real
                       Arabic session. Deepgram rejects unsupported params at
                       the WS handshake, which would break recording outright,
                       so this stays behind a flag.
```

### Audio Level Monitor (Build This)

Create a simple audio level monitor component that shows the user whether the mic is picking up adequate audio. This helps them position their phone correctly.

```typescript
// Use an AnalyserNode to get real-time audio levels
const analyser = audioContext.createAnalyser();
analyser.fftSize = 256;
gainNode.connect(analyser);

// In an animation frame loop:
const dataArray = new Uint8Array(analyser.frequencyBinCount);
analyser.getByteFrequencyData(dataArray);
const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

// Map 'average' (0-255) to a visual level indicator:
// 0-10: Too quiet (show red "Move closer to speaker")
// 10-50: Good (show green level bars)
// 50+: Strong signal (show green, all good)
```

Wire this into the `audio-visualizer.tsx` component. Instead of a simple pulsing circle, show actual audio level bars that respond to the incoming signal. This gives users confidence the app is "hearing" the speaker and helps them reposition if the signal is weak.

### Translation Pipeline

```
When the STT engine returns a FINAL transcript segment:
1. Send the text to /api/translate with source + target language
2. When translation returns, create a TranscriptSegment:
   { id: uuid(), sourceText, translatedText, timestamp }
3. Add segment to local state (for real-time display)
4. Batch save to Convex every 5 seconds (or on pause/stop)
   - Don't save every segment individually — too many mutations
   - Accumulate segments locally, flush in batches

When the STT engine returns an INTERIM result:
1. Show it in the UI with reduced opacity (it will change)
2. Do NOT translate interim results (wastes API calls)
3. Replace with the final version when it arrives
```

### Pause/Resume Logic

```
PAUSE:
- Set the hook's `paused` prop — the worklet's frames are dropped, not buffered
- Keep the WebSocket connection alive (engines time out on silence)
- Send a keepAlive: Deepgram every DEEPGRAM.keepAliveIntervalMs (5s);
  Speechmatics keeps the socket warm the same way
- Save any pending segments to Convex
- UI shows paused state with resume button

RESUME:
- Clear `paused` — the worklet resumes forwarding frames
- Continue appending segments with correct timestamps
- A visual indicator that recording has resumed

IMPORTANT: Track elapsed time correctly across pause/resume cycles.
Store pausedAt timestamp on pause, calculate elapsed = previousElapsed + (pausedAt - lastResumedAt)
```

## UI SPECIFICATIONS

### Design Direction
- **Dark mode by default** (users will be in lecture halls, masjids — bright screens are disruptive)
- **Mobile-first** (90% of usage will be on phones held during lectures)
- **Large text for transcript** (must be readable at arm's length)
- **Minimal chrome** (during recording, the transcript is the UI — everything else gets out of the way)
- **Colors:** Dark background (#0A0F1C), accent green (#2ECC71) for active states, amber (#F59E0B) for paused state

### Page: `/record` (Main Recording Page)

**Pre-Recording State:**
```
┌────────────────────────────────┐
│  [← Back]         Tarjuman      │
│                                │
│  ┌──────────────────────────┐  │
│  │  Source: [Arabic ▾]       │  │
│  │  Target: [English ▾]     │  │
│  └──────────────────────────┘  │
│                                │
│         [ 🎙 Record ]          │
│                                │
│    Tap to start transcribing   │
│                                │
│  ── Recent Sessions ──         │
│  📄 Khutbah - Apr 11   15:32  │
│  📄 Lecture - Apr 10   42:15  │
│  📄 Class - Apr 9      28:40  │
└────────────────────────────────┘
```

**Recording State (MOST IMPORTANT VIEW):**
```
┌────────────────────────────────┐
│  🔴 Recording    ●● 12:34     │
│  Arabic → English              │
│                                │
│  ┌─ Source (Arabic) ─────────┐ │
│  │ النص العربي المباشر هنا    │ │
│  │ يظهر النص فوراً            │ │
│  │ ░░░ interim text...  ░░░  │ │
│  └───────────────────────────┘ │
│                                │
│  ┌─ Translation (English) ───┐ │
│  │ The live Arabic text here  │ │
│  │ appears instantly          │ │
│  │ ░░░ translating... ░░░    │ │
│  └───────────────────────────┘ │
│                                │
│    [ ⏸ Pause ]  [ ⏹ Stop ]   │
└────────────────────────────────┘
```

**Paused State:**
```
┌────────────────────────────────┐
│  ⏸ Paused    ●● 12:34         │
│  Arabic → English              │
│                                │
│  [... transcript so far ...]   │
│                                │
│    [ ▶ Resume ]  [ ⏹ Stop ]   │
└────────────────────────────────┘
```

**Completed State (after stop):**
```
┌────────────────────────────────┐
│  ✓ Session Complete   12:34    │
│                                │
│  [Full transcript visible]     │
│  [Scrollable, source + transl] │
│                                │
│  ┌──────────────────────────┐  │
│  │  ✨ Generate Summary      │  │
│  └──────────────────────────┘  │
│                                │
│  [📋 Copy]  [🔗 Share]  [🗑]  │
└────────────────────────────────┘
```

### Page: `/history` (Session History)

List of past sessions, most recent first. Each card shows: title (auto-generated from first sentence or user-set), source → target languages, duration, date, whether a summary exists (badge). Tapping a card navigates to `/session/[id]`.

### Page: `/session/[id]` (Session Detail)

Full transcript view (source + translation side by side or stacked on mobile). Summary section (if generated). Option to generate summary if not yet generated. Copy transcript button. Delete session button (with confirmation).

### Mobile Considerations
- During recording, the screen should NOT sleep. Use the Wake Lock API: `navigator.wakeLock.request("screen")`
- Large touch targets for Record/Pause/Stop (minimum 56px height)
- Transcript text should be at least 16px, preferably 18px
- Auto-scroll to bottom as new transcript segments arrive
- Haptic feedback on record/pause/stop if available (navigator.vibrate)

## SUPPORTED LANGUAGES (MVP)

Focus on languages relevant to the primary use case (Islamic lectures) + global coverage:

```typescript
export const LANGUAGES = [
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "en", name: "English", native: "English", rtl: false },
  { code: "fr", name: "French", native: "Français", rtl: false },
  { code: "es", name: "Spanish", native: "Español", rtl: false },
  { code: "ur", name: "Urdu", native: "اردو", rtl: true },
  { code: "tr", name: "Turkish", native: "Türkçe", rtl: false },
  { code: "ms", name: "Malay", native: "Bahasa Melayu", rtl: false },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", rtl: false },
  { code: "bn", name: "Bengali", native: "বাংলা", rtl: false },
  { code: "de", name: "German", native: "Deutsch", rtl: false },
  { code: "pt", name: "Portuguese", native: "Português", rtl: false },
  { code: "ru", name: "Russian", native: "Русский", rtl: false },
  { code: "zh", name: "Chinese", native: "中文", rtl: false },
  { code: "ja", name: "Japanese", native: "日本語", rtl: false },
  { code: "ko", name: "Korean", native: "한국어", rtl: false },
  { code: "hi", name: "Hindi", native: "हिन्दी", rtl: false },
  { code: "sw", name: "Swahili", native: "Kiswahili", rtl: false },
  { code: "so", name: "Somali", native: "Soomaali", rtl: false },
] as const;
```

**CRITICAL: RTL support.** Arabic and Urdu are right-to-left. When displaying source text in Arabic, the text container must have `dir="rtl"` and `text-align: right`. The translation container uses the target language's direction.

## INTERACTIVE PROTOTYPE

An interactive prototype is included in this package as `prototype.tsx`. This is the **visual source of truth** for the entire app. Before building any UI component, reference the prototype for:

- Layout and spacing
- Color usage and dark theme implementation
- Component structure (recording controls, transcript display, session cards)
- State transitions (idle → recording → paused → completed)
- Language selector behavior (bottom sheet modal)
- Transcript segment design (blue border = source, green border = translation)
- RTL Arabic text rendering
- Summary display formatting
- History list card design
- Audio level visualizer placement
- Navigation (bottom tab bar: Record / History)

**The prototype demonstrates every state:**
1. **Idle** — Language selectors with swap button, large record button, recent sessions preview
2. **Recording** — Live transcript appearing segment by segment, interim text faded, timer counting, pause/stop controls
3. **Paused** — Timer frozen, resume/stop controls, transcript preserved
4. **Completed** — "Generate Summary" button → AI summary with key points/takeaways, full transcript below, new recording + copy actions
5. **History** — List of past sessions with metadata, summary badges
6. **Session Detail** — Back navigation, summary (or generate button), full transcript with RTL support

**Match the prototype's visual design exactly.** Convert inline styles to Tailwind classes, but do not change colors, spacing, layout structure, or component hierarchy.

## BUILD ORDER

### Phase 1: Foundation (First)
1. Initialize Next.js 15 project with TypeScript, Tailwind, ESLint
2. Install and init Convex
3. Install shadcn/ui, add components: button, card, input, label, select, dialog, badge, separator, avatar, dropdown-menu, toast, scroll-area
4. Set up Convex Auth (email/password + Google OAuth)
5. Create ConvexProvider wrapper
6. Create root layout with providers + DM Sans font
7. Create auth pages (login, signup)
8. Create app layout with nav and auth guard
9. Set up environment variables

### Phase 2: Recording Core (Critical Path)
10. Create `/api/speechmatics/route.ts` (primary) and `/api/deepgram/route.ts` (fallback) — STT credential routes. Both MUST carry auth + rate limit + plan cost gate.
11. Create `/api/translate/route.ts` — Claude (Haiku 4.5) translation proxy
12. Build `use-recorder.ts` hook — microphone access, Web Audio API processing pipeline (highpass → lowpass → compressor → gain), then an AudioWorkletNode on the PROCESSED signal emitting Int16 PCM (NOT MediaRecorder)
13. Build `use-speechmatics.ts` + `use-deepgram.ts` hooks behind the `use-stt.ts` dispatcher — WebSocket connection, PCM streaming, transcript parsing, shared speaker lock
14. Build `use-translator.ts` hook — translate final segments via API route
15. Build `language-selector.tsx` — source + target language pickers with RTL flag
16. Build `record-button.tsx` — record/pause/resume/stop state machine
17. Build `session-timer.tsx` — elapsed time with pause/resume awareness
18. Build `live-transcript.tsx` — real-time display with interim (faded) + final segments
19. Build `audio-visualizer.tsx` — real-time audio level bars using AnalyserNode (shows signal strength, helps user position phone toward speaker)
20. Build `/record/page.tsx` — assemble all recording components

### Phase 3: Data Persistence
21. Create Convex schema
22. Create Convex session mutations (create, addSegments, pause, resume, complete)
23. Wire recording flow to save sessions to Convex on stop
24. Batch-save segments every 5 seconds during recording
25. Save on pause (flush pending segments)

### Phase 4: History & Summaries
26. Create `/api/summarize/route.ts` — Claude summary proxy
27. Build `session-card.tsx` — card for history list
28. Build `/history/page.tsx` — session list
29. Build `transcript-view.tsx` — full transcript display
30. Build `summary-view.tsx` — summary display with generate button
31. Build `/session/[id]/page.tsx` — session detail page
32. Create Convex queries (getSession, getUserSessions)
33. Create Convex mutation (saveSummary)

### Phase 5: Polish & Deploy
34. Mobile responsive pass (375px, 768px, 1280px)
35. Wake Lock API for screen-on during recording
36. RTL support for Arabic/Urdu source text
37. Auto-scroll transcript during recording
38. Loading states, empty states, error handling
39. Landing page (`/`) with value proposition
40. Deploy to Vercel
41. Test with real Arabic audio (YouTube khutbah)

## TESTING CHECKLIST

- [ ] Auth: signup, login, logout, session persistence
- [ ] Microphone: permission request, granted, denied (show helpful error)
- [ ] Recording: start → see live transcript appear → pause → resume → stop
- [ ] Transcript: interim results show faded, final results solid, auto-scroll works
- [ ] Translation: final segments translated correctly, RTL Arabic displays correctly
- [ ] Timer: counts correctly, pauses on pause, resumes on resume
- [ ] Persistence: completed session appears in history after stop
- [ ] History: sessions listed, sorted by date, tappable to detail view
- [ ] Session detail: full transcript visible, source + translation
- [ ] Summary: generate button works, summary appears, saved to session
- [ ] Pause/Resume: transcript continuity maintained, no duplicate segments
- [ ] Mobile: full flow works on phone-sized viewport, large touch targets
- [ ] Screen stays on during recording (Wake Lock)
- [ ] Dark mode looks correct on all pages
- [ ] Error states: no mic, STT disconnection, translation failure — all handled gracefully
- [ ] Fallback regression: flip `STT_PROVIDER` to `"deepgram"`, record, confirm the speaker lock still locks and drops side speakers after the 25s diarize warmup — then flip back
- [ ] Audio processing: highpass + lowpass + compressor + gain pipeline is active (verify in code)
- [ ] Audio visualizer: shows real signal levels, "move closer" prompt when signal too weak
- [ ] Speaker audio test: play Arabic khutbah through a speaker, capture from 1-2 meters away, verify transcript accuracy is usable

## CRITICAL REMINDERS

1. **Never expose API keys to the client.** All API calls (STT credentials, translate, summarize) go through Next.js API routes. Every credential route carries auth + rate limit + plan cost gate — a gate on only one engine's route stops gating anything the moment `STT_PROVIDER` changes.
2. **The STT WebSocket is the exception** — the client connects directly to the engine's WSS endpoint using a short-lived credential fetched from the API route (a Speechmatics JWT, or a Deepgram temp key). This is both vendors' recommended pattern.
3. **Batch segment saves.** Don't call a Convex mutation for every single transcript segment — accumulate locally and save every 5 seconds or on pause/stop.
4. **RTL support is not optional.** Arabic is the primary source language. If RTL is broken, the app is broken.
5. **Interim results are NOT translated.** Only translate final results. Translating interim results wastes API calls (they change constantly).
6. **The transcript IS the product.** If the transcript display is hard to read, too small, or doesn't auto-scroll, the entire app fails. Make it beautiful.
7. **Mobile-first.** This app is used in lecture halls on phones. Desktop is secondary.
8. **Dark mode only for MVP.** Bright screens in a masjid are disruptive.
9. **Handle STT disconnections gracefully.** WebSockets drop. Auto-reconnect with exponential backoff (`RECONNECT_BACKOFF`), re-fetching credentials each attempt. Don't lose transcript segments.
10. **Test with Arabic.** English STT is easy mode. Arabic is the real test. Record 5 minutes of an Arabic khutbah from YouTube and verify accuracy before building the full UI.
11. **Audio comes from SPEAKERS, not direct mic.** The phone is capturing sound from a PA system in a reverberant room (marble walls, crowd noise, AC hum). The Web Audio API processing pipeline (highpass → lowpass → compressor → gain) is NOT optional — it is the difference between usable and unusable transcription. Always process audio before sending it to the engine.
12. **Audio level visualizer is functional, not decorative.** Users need to know if the app is "hearing" the speaker well enough. Show real signal levels. If the level is too low, show a "Move closer to the speaker" prompt. This prevents users from sitting through a 30-minute lecture only to find out the transcript is garbage.
13. **Segment boundaries are tuned for pauses.** Speakers in masjids pause naturally between sentences, and too-short boundaries create fragmented segments that break sentence structure and make translation worse. Speechmatics: `max_delay: 1.5`. Deepgram: `endpointing=500` (not the default 300ms).
14. **Test in a REAL noisy environment.** Play an Arabic khutbah through a phone speaker at moderate volume, place a second phone 1-2 meters away, and capture with the app. This simulates the actual use case far better than a clean YouTube feed through headphones.
15. **Two engines, one policy.** Speechmatics is primary; Deepgram is a live fallback behind `STT_PROVIDER`. Anything that filters or shapes transcript output — confidence floors, the off-language script gate, the speaker lock — must be SHARED, not reimplemented per engine. A fallback that silently diverges only reveals it during an outage, which is the worst moment to find out. `/dev/stt-compare` runs both engines off one mic; it is dev-gated because each run burns two of the two available concurrent Speechmatics sessions.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`bunx convex ai-files install`.

<!-- convex-ai-end -->

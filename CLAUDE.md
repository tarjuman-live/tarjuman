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
1. Raw mic input will be noisy. The app MUST process audio through a Web Audio API pipeline (highpass → lowpass → compressor → gain) BEFORE sending to Deepgram. See the "Audio Capture Details" section for the complete pipeline code.
2. Deepgram parameters must be tuned for noisy environments: `endpointing=500` (longer silence tolerance), `smart_format=true`, `model=nova-2` (most noise-resilient).
3. An audio level monitor component must show users whether the mic is picking up adequate signal — if it's too quiet, prompt them to move closer to the speaker.
4. Show first-time users positioning tips: hold phone close to speaker, point mic toward sound source, avoid covering mic.

## TECH STACK

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 15 (App Router) + TypeScript | SSR for landing page, API routes for backend, consistent ecosystem |
| Backend / DB | Convex | Real-time subscriptions, file storage, serverless, type-safe |
| Auth | Convex Auth (email/password + Google OAuth) | Integrated, simple, handles sessions |
| Styling | Tailwind CSS + shadcn/ui | Fast, mobile-first, accessible components |
| Speech-to-Text | Deepgram (WebSocket streaming API) | Best real-time STT, excellent multilingual, low latency |
| Translation | Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Preserves Islamic terminology (Allah, Subhan'Allah, ﷺ, etc.) where Google Translate flattens them. Single LLM provider. |
| Summarization | Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`) | High-quality contextual summaries, handles religious/academic terminology |
| Hosting | Vercel | Zero-config Next.js deployment |
| Error Tracking | Sentry | Error monitoring from day one |

## ENVIRONMENT VARIABLES

```
# Convex
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=

# Deepgram
DEEPGRAM_API_KEY=

# Anthropic (for translation + summaries)
ANTHROPIC_API_KEY=

# Sentry
NEXT_PUBLIC_SENTRY_DSN=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## API SETUP GUIDE

### Deepgram
1. Sign up at deepgram.com
2. Create a new project
3. Generate an API key with "Usage" permission
4. Free tier: $200 in credit (covers ~775 hours of transcription)
5. Streaming endpoint: `wss://api.deepgram.com/v1/listen`

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
│   │       ├── deepgram/
│   │       │   └── route.ts         # Proxy: get temporary Deepgram auth token
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
│   │   ├── use-deepgram.ts          # ⭐ WebSocket connection to Deepgram
│   │   ├── use-translator.ts        # Translation hook
│   │   ├── use-recorder.ts          # ⭐ MediaRecorder + Web Audio API processing pipeline
│   │   └── use-auth.ts              # Auth state wrapper
│   │
│   ├── lib/
│   │   ├── utils.ts                 # Utility functions
│   │   ├── constants.ts             # Languages list, config values
│   │   ├── deepgram.ts              # Deepgram client helper
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

### `/api/deepgram/route.ts` — Get Temporary Deepgram Token

Deepgram API keys should never be exposed to the client. This route creates a temporary token that the client uses to establish the WebSocket connection.

```typescript
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const language = url.searchParams.get("language") || "en";

  // Option A: Proxy the API key securely
  // Return the key for client-side WebSocket (Deepgram supports this pattern)
  // In production, use Deepgram's temporary key endpoint

  return NextResponse.json({
    key: process.env.DEEPGRAM_API_KEY,
    url: `wss://api.deepgram.com/v1/listen?language=${language}&model=nova-2&punctuate=true&interim_results=true&endpointing=500&vad_events=true&smart_format=true&diarize=false&multichannel=false&encoding=opus&sample_rate=16000&filler_words=false`,
  });
}
```

**Note:** For production, use Deepgram's temporary key API (`/v1/manage/keys`) to generate short-lived tokens. For MVP, passing the key to the client via this route is acceptable.

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

### `use-deepgram.ts` Hook (Most Important File)

This hook manages the WebSocket connection to Deepgram for real-time STT.

```
State:
- connectionState: "idle" | "connecting" | "connected" | "paused" | "error"
- transcript: Array of { id, text, isFinal, timestamp }
- error: string | null

Flow:
1. startRecording(sourceLanguage):
   a. Request microphone permission (navigator.mediaDevices.getUserMedia)
   b. Fetch Deepgram token from /api/deepgram?language={sourceLanguage}
   c. Open WebSocket to Deepgram with the token
   d. Create MediaRecorder or use AudioContext + ScriptProcessorNode
   e. Pipe audio chunks to WebSocket
   f. Listen for WebSocket messages:
      - Deepgram returns { channel.alternatives[0].transcript, is_final, speech_final }
      - On interim results: update the current segment (shows text appearing live)
      - On final results: finalize the segment, trigger translation
   g. Set connectionState to "connected"

2. pauseRecording():
   a. Stop sending audio chunks to WebSocket (keep connection open)
   b. Pause the MediaRecorder
   c. Set connectionState to "paused"

3. resumeRecording():
   a. Resume MediaRecorder
   b. Resume sending audio chunks
   c. Set connectionState to "connected"

4. stopRecording():
   a. Stop MediaRecorder
   b. Close WebSocket connection
   c. Release microphone
   d. Set connectionState to "idle"
   e. Return final transcript
```

### Audio Capture Details — SPEAKER/AMBIENT AUDIO HANDLING

**CRITICAL CONTEXT:** This app will primarily be used to capture audio from SPEAKERS in masjids, lecture halls, and conference rooms — NOT direct microphone speech. The phone mic is picking up sound that has traveled through a PA system, bounced off marble/concrete walls, mixed with crowd noise, coughs, and ambient reverb. This is fundamentally harder than clean direct-mic input.

**Strategy: Use the Web Audio API to clean the signal BEFORE sending to Deepgram.**

```typescript
// ═══════════════════════════════════════════════════
// AUDIO PIPELINE: Mic → AudioContext → Processing → Deepgram
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

// 8. Create a MediaStream from the processed audio
const destination = audioContext.createMediaStreamDestination();
gainNode.connect(destination);

// 9. Use the PROCESSED stream for MediaRecorder (not the raw mic stream)
const processedStream = destination.stream;

const mediaRecorder = new MediaRecorder(processedStream, {
  mimeType: "audio/webm;codecs=opus",
});

mediaRecorder.ondataavailable = (event) => {
  if (event.data.size > 0 && websocket.readyState === WebSocket.OPEN) {
    websocket.send(event.data);
  }
};

// Send data every 250ms for low latency
mediaRecorder.start(250);
```

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

### Deepgram Parameters Explained (for noisy audio)

```
endpointing=500     — Wait 500ms of silence before finalizing (up from 300ms).
                       Speakers in masjids pause between sentences. A longer
                       endpointing window prevents premature segment breaks.

smart_format=true   — Deepgram applies intelligent formatting (numbers, dates,
                       punctuation). Reduces post-processing needed.

model=nova-2        — Deepgram's most accurate model. Better at handling
                       noisy audio than nova-1.

For Arabic specifically, Deepgram's nova-2 model handles:
- Modern Standard Arabic (MSA) — what most khutbahs use
- Some dialectal Arabic — varies by region
- Quran recitation — generally accurate for well-known verses

If accuracy is poor, experiment with:
  model=nova-2-general   (general model, sometimes better for noisy environments)
  model=whisper-large    (Deepgram's hosted Whisper, slower but very accurate for Arabic)
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
When Deepgram returns a FINAL transcript segment:
1. Send the text to /api/translate with source + target language
2. When translation returns, create a TranscriptSegment:
   { id: uuid(), sourceText, translatedText, timestamp }
3. Add segment to local state (for real-time display)
4. Batch save to Convex every 5 seconds (or on pause/stop)
   - Don't save every segment individually — too many mutations
   - Accumulate segments locally, flush in batches

When Deepgram returns an INTERIM result:
1. Show it in the UI with reduced opacity (it will change)
2. Do NOT translate interim results (wastes API calls)
3. Replace with the final version when it arrives
```

### Pause/Resume Logic

```
PAUSE:
- MediaRecorder.pause()
- Stop sending data to WebSocket
- Keep WebSocket connection alive (Deepgram has a 10-second timeout for silence)
- Send a keepAlive message if needed: websocket.send(JSON.stringify({ type: "KeepAlive" }))
- Save any pending segments to Convex
- UI shows paused state with resume button

RESUME:
- MediaRecorder.resume()
- Resume sending audio data
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
10. Create `/api/deepgram/route.ts` — Deepgram token proxy
11. Create `/api/translate/route.ts` — Claude (Haiku 4.5) translation proxy
12. Build `use-recorder.ts` hook — microphone access, Web Audio API processing pipeline (highpass → lowpass → compressor → gain), MediaRecorder on PROCESSED stream
13. Build `use-deepgram.ts` hook — WebSocket connection, audio streaming, transcript parsing
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
- [ ] Error states: no mic, Deepgram disconnection, translation failure — all handled gracefully
- [ ] Audio processing: highpass + lowpass + compressor + gain pipeline is active (verify in code)
- [ ] Audio visualizer: shows real signal levels, "move closer" prompt when signal too weak
- [ ] Speaker audio test: play Arabic khutbah through a speaker, capture from 1-2 meters away, verify transcript accuracy is usable

## CRITICAL REMINDERS

1. **Never expose API keys to the client.** All API calls (Deepgram token, translate, summarize) go through Next.js API routes.
2. **Deepgram WebSocket is the exception** — the client connects directly to Deepgram's WSS endpoint using a temporary key fetched from your API route. This is Deepgram's recommended pattern.
3. **Batch segment saves.** Don't call a Convex mutation for every single transcript segment — accumulate locally and save every 5 seconds or on pause/stop.
4. **RTL support is not optional.** Arabic is the primary source language. If RTL is broken, the app is broken.
5. **Interim results are NOT translated.** Only translate final results. Translating interim results wastes API calls (they change constantly).
6. **The transcript IS the product.** If the transcript display is hard to read, too small, or doesn't auto-scroll, the entire app fails. Make it beautiful.
7. **Mobile-first.** This app is used in lecture halls on phones. Desktop is secondary.
8. **Dark mode only for MVP.** Bright screens in a masjid are disruptive.
9. **Handle Deepgram disconnections gracefully.** WebSockets drop. Auto-reconnect with exponential backoff. Don't lose transcript segments.
10. **Test with Arabic.** English STT is easy mode. Arabic is the real test. Record 5 minutes of an Arabic khutbah from YouTube and verify accuracy before building the full UI.
11. **Audio comes from SPEAKERS, not direct mic.** The phone is capturing sound from a PA system in a reverberant room (marble walls, crowd noise, AC hum). The Web Audio API processing pipeline (highpass → lowpass → compressor → gain) is NOT optional — it is the difference between usable and unusable transcription. Always process audio before sending to Deepgram.
12. **Audio level visualizer is functional, not decorative.** Users need to know if the app is "hearing" the speaker well enough. Show real signal levels. If the level is too low, show a "Move closer to the speaker" prompt. This prevents users from sitting through a 30-minute lecture only to find out the transcript is garbage.
13. **Deepgram endpointing is set to 500ms** (not the default 300ms) because speakers in masjids pause naturally between sentences. Too-short endpointing creates fragmented segments that break sentence structure and make translation worse.
14. **Test in a REAL noisy environment.** Play an Arabic khutbah through a phone speaker at moderate volume, place a second phone 1-2 meters away, and capture with the app. This simulates the actual use case far better than a clean YouTube feed through headphones.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

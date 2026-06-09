# Tarjuman — Claude Code Build Prompt

You are building **Tarjuman** — a real-time speech transcription and translation app. Users record live audio (e.g., an Arabic khutbah playing through masjid speakers), see instant transcription + translation on screen, and generate AI summaries when the session ends.

## Build Package

You have 3 files:

1. **CLAUDE.md** — Read this FIRST and completely. Full tech stack, database schema, API routes with code, the complete Web Audio API processing pipeline, Deepgram configuration for noisy environments, UI wireframes, 41-step build order, and testing checklist.
2. **prototype.jsx** — Interactive prototype showing every screen and state. This is the visual source of truth. Match its layout, colors, flow, and interactions exactly.
3. **PROMPT.md** — This file.

## What To Do

1. Read CLAUDE.md — follow the 41-step build order exactly
2. Initialize Next.js 15 + TypeScript + Tailwind + Convex + shadcn/ui
3. Set up Convex Auth (email/password + Google OAuth)
4. Build the audio processing pipeline — this is NOT simple mic capture:
   - Mic input goes through Web Audio API (highpass 85Hz, lowpass 8kHz, compressor, gain boost) to produce a processed stream
   - The processed stream feeds into MediaRecorder which sends chunks to the Deepgram WebSocket
   - Audio is coming from PA SPEAKERS in masjids, not direct speech into the mic
   - Echo cancellation, noise suppression, and auto gain control enabled at capture
5. Build the Deepgram WebSocket connection — interim results display faded, final results trigger translation
6. Build the Google Translate proxy — only translate FINAL segments, never interim
7. Build the recording UI matching the prototype exactly — idle, recording, paused, completed states
8. Build audio level monitor — show real-time signal strength so users can position their phone correctly
9. Implement pause/resume with correct timestamp tracking
10. Build session persistence in Convex — batch save segments every 5 seconds
11. Build history page and session detail page matching prototype
12. Build summary generation via Claude API
13. Add first-time user tips overlay (positioning phone near speaker, pointing mic, etc.)
14. Mobile-first, dark mode only
15. RTL support for Arabic/Urdu
16. Deploy to Vercel

## Architecture

```
User taps Record
  Browser captures mic (echo cancellation + noise suppression + auto gain)
  Web Audio API pipeline cleans the signal:
    Highpass (85Hz) then Lowpass (8kHz) then Compressor then Gain boost
  Processed audio streams via MediaRecorder (250ms chunks)
  Chunks sent via WebSocket to Deepgram (nova-2, endpointing=500, smart_format)
  Deepgram returns real-time transcript (interim + final)
  Final segments sent to /api/translate (Google Translate)
  Source + translated text displayed side by side (RTL for Arabic)
  Audio level monitor shows signal strength in real-time
  Segments batch-saved to Convex every 5 seconds
  On Stop: session completed, full transcript saved
  Generate Summary button calls /api/summarize (Claude API) and saves summary
```

## Critical Rules

- Audio pipeline is mandatory. Never send raw mic audio to Deepgram. Always process through the Web Audio API chain. Speaker audio without processing will produce terrible transcription.
- API keys never reach the client. All APIs proxied through Next.js routes.
- Only translate FINAL results. Interim results show faded but do not hit the translation API.
- Batch save segments to Convex every 5 seconds, not per-segment.
- RTL support for Arabic/Urdu source text is mandatory.
- Dark mode only. Background #060B18.
- Mobile-first. 90% usage on phones in lecture halls. Min touch target 56px. Transcript text 18px.
- Screen stays on during recording (Wake Lock API).
- Auto-reconnect Deepgram WebSocket on disconnect.
- Audio level monitor must be visible during recording so users know if their phone is picking up the speaker.
- Match the prototype for layout, colors, flow, and interactions.

## First Validation Step

Before building any UI beyond the record page, prove the core pipeline works:
1. Capture mic, process through audio pipeline, stream to Deepgram, get transcript, translate, display
2. Test with Arabic audio playing through a speaker (not headphones, not direct speech — an actual speaker in the room)
3. If accuracy is poor, try model=whisper-large instead of nova-2

If this works with speaker audio, everything else is UI. If it does not, debug the audio pipeline before proceeding.

Ship it.

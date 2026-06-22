#!/usr/bin/env bash
# Produce 3 degraded 16k-mono PCM conditions from bench/audio/source.wav.
# Each = ROOM channel (distance attenuation + reverb + noise) THEN the app's
# own Web Audio pipeline (highpass 120 → lowpass 7000 → compressor → gain 1.6),
# so the PCM matches what Deepgram receives in production.
set -e
SRC="bench/audio/source.wav"
DUR=60   # seconds per condition
cd "$(dirname "$0")/.."

# App pipeline (replicates src/lib/audio-processor.ts), applied after room channel.
APP="highpass=f=120,lowpass=f=7000,acompressor=threshold=0.05:ratio=4:attack=3:release=250,volume=1.6"

# ── C0 control: near-clean capture, app pipeline only ──
ffmpeg -y -i "$SRC" -t "$DUR" -filter_complex \
"[0:a]aresample=16000,aformat=channel_layouts=mono,volume=1.0,${APP}[out]" \
-map "[out]" -f s16le -acodec pcm_s16le bench/audio/c0-control.pcm 2>/dev/null
echo "✅ c0-control.pcm"

# ── C1 ~2m: vol 0.5, light reverb, light brown noise ──
ffmpeg -y -i "$SRC" -t "$DUR" -filter_complex \
"[0:a]aresample=16000,aformat=channel_layouts=mono,volume=0.5,aecho=0.8:0.7:40|55:0.4|0.25[room]; \
 anoisesrc=color=brown:sample_rate=16000:amplitude=0.04,aformat=channel_layouts=mono[n]; \
 [room][n]amix=inputs=2:duration=first:weights=1 0.45,${APP}[out]" \
-map "[out]" -f s16le -acodec pcm_s16le bench/audio/c1-2m.pcm 2>/dev/null
echo "✅ c1-2m.pcm"

# ── C2 ~4m: vol 0.3, heavy reverb, more noise ──
ffmpeg -y -i "$SRC" -t "$DUR" -filter_complex \
"[0:a]aresample=16000,aformat=channel_layouts=mono,volume=0.3,aecho=0.85:0.75:50|75|110:0.5|0.35|0.2[room]; \
 anoisesrc=color=brown:sample_rate=16000:amplitude=0.06,aformat=channel_layouts=mono[n]; \
 [room][n]amix=inputs=2:duration=first:weights=1 0.6,${APP}[out]" \
-map "[out]" -f s16le -acodec pcm_s16le bench/audio/c2-4m.pcm 2>/dev/null
echo "✅ c2-4m.pcm"

echo "--- sizes (bytes; 32000 B/s @ 16k mono s16le → ${DUR}s ≈ $((DUR*32000))) ---"
ls -la bench/audio/*.pcm

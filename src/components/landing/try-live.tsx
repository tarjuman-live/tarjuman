"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { COLORS } from "@/lib/constants";

const AuthModal = dynamic(
  () => import("@/components/auth/auth-modal").then((m) => m.AuthModal),
  { ssr: false }
);

// ── Minimal Web Speech API typings (not in lib.dom for webkit-prefixed UA) ──
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  [index: number]: SRResult;
}
interface SREvent {
  readonly resultIndex: number;
  readonly results: SRResultList;
}
interface SRErrorEvent {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRConstructor = new () => SpeechRecognitionLike;

function getSR(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── Languages (codes match src/lib/constants LANGUAGES; bcp for recognition) ──
const SPEAK_LANGS = [
  { code: "en", bcp: "en-US", label: "English", rtl: false },
  { code: "ar", bcp: "ar-SA", label: "Arabic", rtl: true },
  { code: "es", bcp: "es-ES", label: "Spanish", rtl: false },
  { code: "fr", bcp: "fr-FR", label: "French", rtl: false },
  { code: "de", bcp: "de-DE", label: "German", rtl: false },
  { code: "id", bcp: "id-ID", label: "Indonesian", rtl: false },
] as const;

const TARGET_LANGS = [
  { code: "ar", label: "Arabic", rtl: true },
  { code: "en", label: "English", rtl: false },
  { code: "es", label: "Spanish", rtl: false },
  { code: "fr", label: "French", rtl: false },
  { code: "tr", label: "Turkish", rtl: false },
  { code: "id", label: "Indonesian", rtl: false },
] as const;

const isRtlCode = (code: string) =>
  code === "ar" || code === "he" || code === "ur" || code === "fa";

const CAP_SECONDS = 60;
const MAX_SEGMENTS = 14;

interface Seg {
  id: number;
  source: string;
  translation: string;
  translating: boolean;
  error: boolean;
}

type Status = "idle" | "listening" | "ended" | "denied" | "unsupported";

export function TryLive() {
  const [status, setStatus] = useState<Status>("idle");
  const [segs, setSegs] = useState<Seg[]>([]);
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [hint, setHint] = useState<string | null>(null);

  const [sourceCode, setSourceCode] = useState("en");
  const [targetCode, setTargetCode] = useState("ar");

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false); // true while we *want* recognition running
  const segIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Web Speech is browser/network-dependent and fails in many quiet ways
  // (no-speech, network, language-not-supported, Safari half-support). Surface
  // the actual reason instead of an infinite silent "Listening".
  const [srError, setSrError] = useState<string | null>(null);
  const heardRef = useRef(false); // any interim/final result seen this session
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth popup for the post-trial nudge.
  const [modalMounted, setModalMounted] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const speak = SPEAK_LANGS.find((l) => l.code === sourceCode) ?? SPEAK_LANGS[0];
  const targetRtl = isRtlCode(targetCode);

  // Flag unsupported browsers after mount (not during render, to avoid an SSR
  // hydration mismatch — the server can't feature-detect the Web Speech API).
  useEffect(() => {
    // One-shot feature detect; intentionally post-hydration (see above).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!getSR()) setStatus("unsupported");
  }, []);

  // Smoothly keep the newest line in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [segs, interim]);

  const stop = useCallback((next: Status) => {
    activeRef.current = false;
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    const rec = recRef.current;
    if (rec) {
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    recRef.current = null;
    setInterim("");
    setStatus(next);
  }, []);

  const translate = useCallback(
    async (id: number, text: string, src: string, tgt: string) => {
      try {
        const r = await fetch("/api/trial/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, source: src, target: tgt }),
        });
        const data = (await r.json().catch(() => ({}))) as {
          translatedText?: string;
          error?: string;
        };
        if (!r.ok) {
          // Out of trial budget → end gracefully with the signup nudge.
          if (r.status === 429 || r.status === 503) {
            setHint(data.error ?? "Trial limit reached.");
            stop("ended");
          }
          setSegs((prev) =>
            prev.map((s) => (s.id === id ? { ...s, translating: false, error: true } : s))
          );
          return;
        }
        setSegs((prev) =>
          prev.map((s) =>
            s.id === id
              ? { ...s, translating: false, translation: data.translatedText ?? "" }
              : s
          )
        );
      } catch {
        setSegs((prev) =>
          prev.map((s) => (s.id === id ? { ...s, translating: false, error: true } : s))
        );
      }
    },
    [stop]
  );

  const start = useCallback(() => {
    const SR = getSR();
    if (!SR) {
      setStatus("unsupported");
      return;
    }
    // Fresh session.
    setSegs([]);
    setInterim("");
    setElapsed(0);
    setHint(null);
    setSrError(null);
    heardRef.current = false;
    segIdRef.current = 0;

    const rec = new SR();
    rec.lang = speak.bcp;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: SREvent) => {
      heardRef.current = true;
      setSrError(null);
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const txt = res[0]?.transcript ?? "";
        if (res.isFinal) {
          const clean = txt.trim();
          if (clean) {
            const id = segIdRef.current++;
            setSegs((prev) => {
              if (prev.length >= MAX_SEGMENTS) return prev;
              return [
                ...prev,
                { id, source: clean, translation: "", translating: true, error: false },
              ];
            });
            // capture current codes for this segment
            translate(id, clean, sourceCode, targetCode);
            if (segIdRef.current >= MAX_SEGMENTS) stop("ended");
          }
        } else {
          live += txt;
        }
      }
      setInterim(live);
    };

    rec.onerror = (e: SRErrorEvent) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stop("denied");
      } else if (e.error === "no-speech" || e.error === "aborted") {
        /* transient — onend restarts if still active */
      } else if (e.error === "network") {
        setSrError(
          "Can't reach the speech service. Your browser sends audio to the cloud to transcribe — check your internet connection."
        );
      } else if (e.error === "language-not-supported") {
        setSrError(
          `Your browser can't do live recognition for ${speak.label}. Try Chrome or Edge, or pick a different language.`
        );
      } else if (e.error === "audio-capture") {
        setSrError("No microphone was detected.");
      } else {
        setSrError(`Speech recognition error: ${e.error}`);
      }
    };

    rec.onend = () => {
      // Chrome ends recognition periodically; restart (after a beat, to dodge
      // the "recognition has already started" race) while still active.
      if (!activeRef.current) return;
      setTimeout(() => {
        if (!activeRef.current) return;
        try {
          rec.start();
        } catch {
          /* transient InvalidStateError — the next onend/tick recovers */
        }
      }, 150);
    };

    recRef.current = rec;
    activeRef.current = true;
    try {
      rec.start();
      setStatus("listening");
      // Watchdog: if we've heard nothing after 8s, it's not going to work
      // silently — tell the user what to check.
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        if (activeRef.current && !heardRef.current) {
          setSrError(
            "Not picking up any speech yet. Check that your mic works and you're speaking — this works best in Chrome or Edge (Safari's live transcription is limited)."
          );
        }
      }, 8000);
    } catch {
      setStatus("idle");
    }
  }, [speak.bcp, speak.label, sourceCode, targetCode, translate, stop]);

  // Elapsed timer + hard cap.
  useEffect(() => {
    if (status !== "listening") return;
    const id = setInterval(() => {
      setElapsed((e) => {
        if (e + 1 >= CAP_SECONDS) {
          stop("ended");
          return CAP_SECONDS;
        }
        return e + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [status, stop]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      const rec = recRef.current;
      if (rec) {
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  const openSignup = () => {
    setModalMounted(true);
    setModalOpen(true);
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const remaining = CAP_SECONDS - elapsed;

  return (
    <div
      className="relative w-full max-w-3xl mx-auto rounded-3xl overflow-hidden"
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.borderLight}`,
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
      }}
    >
      {/* Header / controls */}
      <div
        className="px-5 py-4 flex flex-wrap items-center justify-between gap-3"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <div className="flex items-center gap-2">
          {status === "listening" ? (
            <>
              <span
                className="w-2.5 h-2.5 rounded-full animate-pulse"
                style={{ background: COLORS.red }}
              />
              <span className="text-sm font-semibold" style={{ color: COLORS.w }}>
                Listening
              </span>
              <span
                className="text-[13px] font-bold tabular-nums ms-1"
                style={{ color: remaining <= 10 ? COLORS.amber : COLORS.t3 }}
              >
                {mm}:{ss}
              </span>
            </>
          ) : (
            <span className="text-sm font-semibold" style={{ color: COLORS.w }}>
              Try it live
            </span>
          )}
        </div>

        {/* language pickers */}
        <div className="flex items-center gap-2">
          <LangSelect
            value={sourceCode}
            disabled={status === "listening"}
            onChange={setSourceCode}
            options={SPEAK_LANGS.map((l) => ({ code: l.code, label: l.label }))}
            ariaLabel="Language you'll speak"
          />
          <span style={{ color: COLORS.t4 }}>→</span>
          <LangSelect
            value={targetCode}
            disabled={status === "listening"}
            onChange={setTargetCode}
            options={TARGET_LANGS.map((l) => ({ code: l.code, label: l.label }))}
            ariaLabel="Translate to"
          />
        </div>
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="px-5 py-4 overflow-auto transcript-scroll flex flex-col gap-3"
        style={{ height: 320 }}
      >
        {segs.length === 0 && status !== "listening" && (
          <div className="flex-1 grid place-items-center text-center px-6">
            <div>
              <div className="text-sm" style={{ color: COLORS.t2 }}>
                {status === "unsupported"
                  ? "Live mic transcription needs Chrome, Edge, or Safari."
                  : status === "denied"
                    ? "Mic access was blocked."
                    : "Press the mic and start speaking."}
              </div>
              <div className="text-xs mt-1" style={{ color: COLORS.t4 }}>
                {status === "unsupported"
                  ? "Or create a free account to use the full recorder."
                  : status === "denied"
                    ? "Allow the microphone in your browser, then try again."
                    : `Your words appear in ${
                        SPEAK_LANGS.find((l) => l.code === sourceCode)?.label
                      }, translated to ${
                        TARGET_LANGS.find((l) => l.code === targetCode)?.label
                      } as you go.`}
              </div>
            </div>
          </div>
        )}

        {srError && status === "listening" && (
          <div
            className="rounded-xl px-3.5 py-3 text-[13px] leading-relaxed"
            style={{
              background: COLORS.amberSoft,
              border: `1px solid ${COLORS.amber}55`,
              color: COLORS.w,
            }}
          >
            {srError}
          </div>
        )}

        {segs.length === 0 && status === "listening" && !srError && (
          <div className="flex-1 grid place-items-center text-center">
            <div className="text-sm" style={{ color: COLORS.t3 }}>
              Listening… say something.
            </div>
          </div>
        )}

        {segs.map((seg) => (
          <div
            key={seg.id}
            className="rounded-xl px-3.5 py-3 animate-in fade-in slide-in-from-bottom-1 duration-300"
            style={{
              background: COLORS.bg,
              borderInlineStart: `2px solid ${COLORS.blue}`,
            }}
          >
            <div
              dir={speak.rtl ? "rtl" : "ltr"}
              className="text-[15px] leading-relaxed"
              style={{ color: COLORS.w, textAlign: speak.rtl ? "right" : "left" }}
            >
              {seg.source}
            </div>
            <div
              className="mt-2 pt-2 text-[14px] leading-relaxed"
              dir={targetRtl ? "rtl" : "ltr"}
              style={{
                borderTop: `1px solid ${COLORS.border}`,
                textAlign: targetRtl ? "right" : "left",
                color: seg.translation ? COLORS.accent : COLORS.t3,
              }}
            >
              {seg.translation ? (
                <span className="animate-in fade-in duration-500">{seg.translation}</span>
              ) : seg.translating ? (
                <span style={{ color: COLORS.t4 }}>…translating</span>
              ) : seg.error ? (
                <span style={{ color: COLORS.t4 }}>
                  (translation unavailable)
                </span>
              ) : null}
            </div>
          </div>
        ))}

        {interim && (
          <div
            className="rounded-xl px-3.5 py-3 opacity-60"
            style={{ background: COLORS.bg, borderInlineStart: `2px solid ${COLORS.border}` }}
          >
            <div
              dir={speak.rtl ? "rtl" : "ltr"}
              className="text-[15px] leading-relaxed"
              style={{ color: COLORS.t2, textAlign: speak.rtl ? "right" : "left" }}
            >
              {interim}
              <span
                className="inline-block align-middle ms-0.5 w-[2px] h-[1em] animate-pulse"
                style={{ background: COLORS.accent }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer / mic control */}
      <div
        className="px-5 py-4 flex items-center justify-between gap-4"
        style={{ borderTop: `1px solid ${COLORS.border}` }}
      >
        {status === "listening" ? (
          <>
            <button
              type="button"
              onClick={() => stop("ended")}
              className="h-12 px-5 rounded-2xl flex items-center gap-2 font-bold text-sm cursor-pointer transition-transform active:scale-95"
              style={{ background: COLORS.redSoft, color: COLORS.red }}
            >
              <span className="w-3.5 h-3.5 rounded-[3px]" style={{ background: COLORS.red }} />
              Stop
            </button>
            <span className="text-xs" style={{ color: COLORS.t4 }}>
              {remaining}s left in the trial
            </span>
          </>
        ) : status === "ended" ? (
          <button
            type="button"
            onClick={start}
            className="h-12 px-5 rounded-2xl font-bold text-sm cursor-pointer transition-transform active:scale-95"
            style={{ background: COLORS.surfaceLight, color: COLORS.w }}
          >
            ↻ Try again
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={status === "unsupported"}
            className="h-12 px-6 rounded-2xl flex items-center gap-2 font-bold text-sm cursor-pointer transition-transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: COLORS.accent,
              color: "#0A0F1C",
              boxShadow: `0 0 24px ${COLORS.accent}33`,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0A0F1C" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0014 0" />
              <line x1="12" y1="20" x2="12" y2="24" />
            </svg>
            {status === "denied" ? "Try again" : "Start speaking"}
          </button>
        )}

        <span className="text-xs hidden sm:inline" style={{ color: COLORS.t4 }}>
          No sign-up · runs in your browser
        </span>
      </div>

      {/* Ended overlay nudge */}
      {status === "ended" && (
        <div
          className="absolute inset-0 z-10 grid place-items-center px-6 text-center animate-in fade-in duration-300"
          style={{ background: "rgba(6,11,24,0.82)", backdropFilter: "blur(6px)" }}
        >
          <div className="max-w-sm">
            <div className="text-lg font-bold" style={{ color: COLORS.w }}>
              That&apos;s Tarjuman.
            </div>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: COLORS.t2 }}>
              {hint ??
                "Create a free account to record full lectures, translate Arabic khutbahs with terminology kept intact, and save every transcript."}
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={openSignup}
                className="h-11 px-5 rounded-xl font-bold text-sm cursor-pointer transition-transform active:scale-95"
                style={{
                  background: COLORS.accent,
                  color: "#0A0F1C",
                  boxShadow: `0 0 24px ${COLORS.accent}33`,
                }}
              >
                Get started free
              </button>
              <button
                type="button"
                onClick={start}
                className="h-11 px-4 rounded-xl font-semibold text-sm cursor-pointer"
                style={{
                  background: "transparent",
                  border: `1px solid ${COLORS.borderLight}`,
                  color: COLORS.t2,
                }}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {modalMounted && (
        <AuthModal open={modalOpen} onOpenChange={setModalOpen} initialMode="signUp" />
      )}
    </div>
  );
}

// Custom dropdown — the native <select> renders the OS-accent (red on macOS)
// highlight, which clashes with the app. This matches the app: dark surface
// menu, green check + green text on the selected option, hover lift.
function LangSelect({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { code: string; label: string }[];
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = options.find((o) => o.code === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="h-9 pl-3 pr-2 rounded-lg text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          background: COLORS.surfaceLight,
          border: `1px solid ${open ? COLORS.accent : COLORS.borderLight}`,
          color: COLORS.w,
        }}
      >
        {current?.label ?? value}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-1.5 z-30 min-w-[150px] rounded-xl overflow-hidden py-1 animate-in fade-in slide-in-from-top-1 duration-150"
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.borderLight}`,
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
          }}
        >
          {options.map((o) => {
            const selected = o.code === value;
            return (
              <button
                key={o.code}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(o.code);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left text-[13px] font-semibold cursor-pointer transition-colors hover:bg-[var(--color-surface-light)]"
                style={{ color: selected ? COLORS.accent : COLORS.t2 }}
              >
                {o.label}
                {selected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={COLORS.accent}
                    strokeWidth="3"
                    aria-hidden
                  >
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

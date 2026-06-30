"use client";

import { useEffect, useRef, useState } from "react";
import { COLORS } from "@/lib/constants";
import { RotatingText } from "./rotating-text";

/**
 * Self-contained, looping preview of the recording screen — a scripted
 * Arabic→English khutbah transcript that types itself in real time, the way the
 * real app does (word-by-word source, then the translation fades in beneath).
 *
 * It is a *visual demo*, not a live capture: real transcription needs a mic +
 * an authenticated Deepgram token, so the landing shows the experience with
 * hand-authored, accurate content instead. Respects prefers-reduced-motion by
 * showing the whole transcript at once.
 *
 * Hand-authored content (the hadith of intentions, Sahih al-Bukhari 1) — kept
 * accurate and respectful; Islamic terms and the ﷺ honorific are preserved, as
 * the product itself guarantees.
 */
interface Segment {
  ar: string;
  en: string;
  ref?: string;
}

const SCRIPT: Segment[] = [
  {
    ar: "الحمد لله رب العالمين، والصلاة والسلام على رسول الله ﷺ",
    en: "All praise is due to Allah, Lord of all the worlds, and peace and blessings be upon the Messenger of Allah ﷺ.",
  },
  {
    ar: "قال رسول الله ﷺ: إنما الأعمال بالنيات",
    en: "The Messenger of Allah ﷺ said: “Actions are but by intentions,”",
    ref: "Sahih al-Bukhari 1",
  },
  {
    ar: "وإنما لكل امرئ ما نوى",
    en: "and every person will have only what they intended.",
  },
];

const MS_PER_WORD = 150;

export function LiveDemo() {
  const [reduce, setReduce] = useState(false);
  // idx = the segment currently being revealed; segments before it are done.
  const [idx, setIdx] = useState(0);
  const [words, setWords] = useState(0);
  const [enShown, setEnShown] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const reduceRef = useRef(false);

  useEffect(() => {
    reduceRef.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceRef.current) {
      setReduce(true);
      setIdx(SCRIPT.length - 1);
      setWords(999);
      setEnShown(true);
      setElapsed(12);
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => {
      const id = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
      timers.push(id);
    };

    const run = (i: number) => {
      if (i >= SCRIPT.length) {
        // Hold the finished transcript, then clear and loop.
        after(2600, () => {
          setIdx(0);
          setWords(0);
          setEnShown(false);
          setElapsed(0);
          run(0);
        });
        return;
      }
      const count = SCRIPT[i].ar.split(" ").length;
      setIdx(i);
      setWords(0);
      setEnShown(false);
      for (let w = 1; w <= count; w++) after(MS_PER_WORD * w, () => setWords(w));
      const doneWords = MS_PER_WORD * count + 300;
      after(doneWords, () => setEnShown(true));
      after(doneWords + 1600, () => run(i + 1));
    };
    run(0);

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  // Elapsed timer (skipped under reduced motion).
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [reduce]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="relative">
      {/* soft glow behind the phone */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 blur-3xl opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 30%, rgba(46,204,113,0.18), transparent 70%)",
        }}
      />

      {/* Phone frame */}
      <div
        className="mx-auto w-[300px] sm:w-[320px] rounded-[2.5rem] p-2.5"
        style={{
          background: "linear-gradient(160deg, #1b2438, #0c1322)",
          border: `1px solid ${COLORS.borderLight}`,
          boxShadow:
            "0 30px 70px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        <div
          className="relative rounded-[2rem] overflow-hidden flex flex-col"
          style={{ background: COLORS.bg, height: 520 }}
        >
          {/* notch */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-1.5 rounded-full bg-black/60" />

          {/* Recording header */}
          <div
            className="pt-7 px-4 pb-3"
            style={{ borderBottom: `1px solid ${COLORS.border}` }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ background: COLORS.red }}
                />
                <span className="text-[12px] font-semibold" style={{ color: COLORS.w }}>
                  Recording
                </span>
              </div>
              <span
                className="text-[13px] font-bold tabular-nums"
                style={{ color: COLORS.w }}
              >
                {mm}:{ss}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: COLORS.t3 }}>
                <RotatingText
                  items={["Arabic", "Urdu", "Spanish", "French", "Turkish", "Indonesian"]}
                  intervalMs={2400}
                  className="font-semibold"
                />
                <span>→</span>
                <span style={{ color: COLORS.accent }}>English</span>
              </div>
              {/* audio meter */}
              <div className="flex items-end gap-[3px] h-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="demo-eq-bar w-[3px] rounded-full"
                    style={{
                      height: "100%",
                      background: COLORS.accent,
                      transformOrigin: "bottom",
                      animationDelay: `${i * 120}ms`,
                      // static fallback height when motion is reduced
                      transform: reduce ? "scaleY(0.5)" : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Transcript */}
          <div className="flex-1 overflow-hidden px-4 py-4 flex flex-col gap-3">
            {SCRIPT.map((seg, i) => {
              if (i > idx) return null;
              const isCurrent = i === idx;
              const arWords = seg.ar.split(" ");
              const showEn = isCurrent ? enShown : true;
              return (
                <div
                  key={i}
                  className="rounded-xl px-3 py-2.5"
                  style={{
                    background: COLORS.surface,
                    borderInlineStart: `2px solid ${COLORS.blue}`,
                  }}
                >
                  <div
                    dir="rtl"
                    lang="ar"
                    className="text-right text-[15px] leading-relaxed"
                    style={{ color: COLORS.w }}
                  >
                    {isCurrent
                      ? arWords.map((word, wi) => (
                          <span
                            key={wi}
                            style={{
                              opacity: wi < words ? 1 : 0,
                              transition: "opacity 280ms ease",
                            }}
                          >
                            {word}
                            {wi < arWords.length - 1 ? " " : ""}
                          </span>
                        ))
                      : seg.ar}
                    {isCurrent && words < arWords.length && (
                      <span
                        className="inline-block align-middle ms-0.5 w-[2px] h-[1em] animate-pulse"
                        style={{ background: COLORS.accent }}
                      />
                    )}
                  </div>

                  {showEn && (
                    <div
                      className="mt-2 text-[13px] leading-relaxed animate-in fade-in slide-in-from-bottom-1 duration-500"
                      style={{
                        color: COLORS.t2,
                        borderTop: `1px solid ${COLORS.border}`,
                        paddingTop: 8,
                      }}
                    >
                      {seg.en}
                      {seg.ref && (
                        <span className="ms-1" style={{ color: COLORS.accent }}>
                          ({seg.ref})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Controls (decorative) */}
          <div
            className="px-4 py-3 flex items-center justify-center gap-3"
            style={{ borderTop: `1px solid ${COLORS.border}` }}
          >
            <span
              className="w-11 h-11 rounded-full grid place-items-center"
              style={{ background: COLORS.amberSoft }}
              aria-hidden
            >
              <span className="flex gap-[3px]">
                <span className="w-1 h-3.5 rounded-sm" style={{ background: COLORS.amber }} />
                <span className="w-1 h-3.5 rounded-sm" style={{ background: COLORS.amber }} />
              </span>
            </span>
            <span
              className="w-11 h-11 rounded-full grid place-items-center"
              style={{ background: COLORS.redSoft }}
              aria-hidden
            >
              <span className="w-3.5 h-3.5 rounded-[3px]" style={{ background: COLORS.red }} />
            </span>
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs" style={{ color: COLORS.t4 }}>
        Live preview · actual transcription runs on your device
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { COLORS } from "@/lib/constants";

/**
 * Self-contained, looping preview of the recording screen. It cycles through
 * several languages — each "lesson" types its own source text in real time
 * (word-by-word) and fades the English translation in beneath, with the header
 * language label changing to match. So the demo actually demonstrates the
 * multilingual capability instead of always showing Arabic.
 *
 * Visual demo, not a live capture (real transcription needs a mic + an
 * authenticated Deepgram token). Hand-authored, accurate content — the same
 * well-known opening ("All praise is due to Allah, Lord of the worlds") in each
 * language, with "Allah" preserved to show the terminology handling. Respects
 * prefers-reduced-motion.
 */
interface Segment {
  src: string;
  en: string;
  ref?: string;
}
interface Lesson {
  lang: string;
  rtl: boolean;
  segments: Segment[];
}

const LESSONS: Lesson[] = [
  {
    lang: "Arabic",
    rtl: true,
    segments: [
      {
        src: "الحمد لله رب العالمين، والصلاة والسلام على رسول الله ﷺ",
        en: "All praise is due to Allah, Lord of all the worlds, and peace and blessings be upon the Messenger of Allah ﷺ.",
      },
      {
        src: "قال رسول الله ﷺ: إنما الأعمال بالنيات",
        en: "The Messenger of Allah ﷺ said: “Actions are but by intentions,”",
        ref: "Sahih al-Bukhari 1",
      },
    ],
  },
  {
    lang: "Urdu",
    rtl: true,
    segments: [
      {
        src: "تمام تعریفیں اللہ کے لیے ہیں جو سارے جہانوں کا رب ہے",
        en: "All praise belongs to Allah, the Lord of all the worlds.",
      },
    ],
  },
  {
    lang: "Spanish",
    rtl: false,
    segments: [
      {
        src: "Todas las alabanzas pertenecen a Allah, Señor de los mundos.",
        en: "All praise belongs to Allah, Lord of the worlds.",
      },
    ],
  },
  {
    lang: "French",
    rtl: false,
    segments: [
      {
        src: "Toutes les louanges reviennent à Allah, Seigneur des mondes.",
        en: "All praise belongs to Allah, Lord of the worlds.",
      },
    ],
  },
  {
    lang: "Turkish",
    rtl: false,
    segments: [
      {
        src: "Hamd, âlemlerin Rabbi olan Allah'a mahsustur.",
        en: "All praise is due to Allah, Lord of the worlds.",
      },
    ],
  },
  {
    lang: "Indonesian",
    rtl: false,
    segments: [
      {
        src: "Segala puji bagi Allah, Tuhan semesta alam.",
        en: "All praise be to Allah, Lord of the worlds.",
      },
    ],
  },
];

const MS_PER_WORD = 150;

export function LiveDemo() {
  const [reduce, setReduce] = useState(false);
  const [lesson, setLesson] = useState(0);
  // idx = segment within the current lesson being revealed; earlier ones are done.
  const [idx, setIdx] = useState(0);
  const [words, setWords] = useState(0);
  const [enShown, setEnShown] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // One-shot reduced-motion fallback (post-hydration).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReduce(true);
      setLesson(0);
      setIdx(LESSONS[0].segments.length - 1);
      setWords(999);
      setEnShown(true);
      setElapsed(8);
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

    const runSeg = (lessonIdx: number, i: number) => {
      const segs = LESSONS[lessonIdx].segments;
      if (i >= segs.length) {
        // Hold the finished lesson, then advance to the next language.
        after(2400, () => playLesson((lessonIdx + 1) % LESSONS.length));
        return;
      }
      const count = segs[i].src.split(" ").length;
      setIdx(i);
      setWords(0);
      setEnShown(false);
      for (let w = 1; w <= count; w++) after(MS_PER_WORD * w, () => setWords(w));
      const doneWords = MS_PER_WORD * count + 300;
      after(doneWords, () => setEnShown(true));
      after(doneWords + 1500, () => runSeg(lessonIdx, i + 1));
    };

    const playLesson = (lessonIdx: number) => {
      setLesson(lessonIdx);
      setIdx(0);
      setWords(0);
      setEnShown(false);
      setElapsed(0);
      runSeg(lessonIdx, 0);
    };

    playLesson(0);

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
  const current = LESSONS[lesson];

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

      {/* iPhone 17 Pro Max */}
      <div className="relative mx-auto w-[300px] sm:w-[320px]">
        {/* titanium side buttons — left: Action + volume up/down; right:
            Camera Control + side (power) button */}
        {[
          { side: "left", top: 112, h: 26 },
          { side: "left", top: 152, h: 46 },
          { side: "left", top: 208, h: 46 },
          { side: "right", top: 150, h: 34 },
          { side: "right", top: 198, h: 64 },
        ].map((b, i) => (
          <span
            key={i}
            aria-hidden
            className={`absolute w-[3px] ${
              b.side === "left" ? "-left-[2px] rounded-l-[2px]" : "-right-[2px] rounded-r-[2px]"
            }`}
            style={{
              top: b.top,
              height: b.h,
              background: "linear-gradient(180deg,#5b6478,#2a3140)",
            }}
          />
        ))}

        {/* titanium rim + black bezel */}
        <div
          className="rounded-[3rem] p-[10px]"
          style={{
            background: "#05070c",
            boxShadow:
              "0 0 0 2px #343d50, 0 0 0 3px #0c0f17, 0 30px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <div
            className="relative rounded-[2.35rem] overflow-hidden flex flex-col"
            style={{ background: COLORS.bg, height: 600 }}
          >
            {/* Dynamic Island */}
            <div
              className="absolute top-[10px] left-1/2 -translate-x-1/2 z-20 flex items-center justify-end pe-2.5 rounded-full"
              style={{ width: 110, height: 31, background: "#000" }}
            >
              <span
                className="w-[9px] h-[9px] rounded-full"
                style={{
                  background: "#0a0f1a",
                  boxShadow: "inset 0 0 0 1px rgba(90,110,140,0.5)",
                }}
              />
            </div>

            {/* Recording header */}
            <div
              className="pt-12 px-4 pb-3"
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
                {/* language label fades when the lesson (language) changes */}
                <span
                  key={lesson}
                  className="font-semibold animate-in fade-in duration-300"
                  style={{ color: COLORS.t2 }}
                >
                  {current.lang}
                </span>
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
                      transform: reduce ? "scaleY(0.5)" : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Transcript — keyed on lesson so it cleanly resets per language */}
          <div
            key={lesson}
            className="flex-1 overflow-hidden px-4 py-4 flex flex-col gap-3"
          >
            {current.segments.map((seg, i) => {
              if (i > idx) return null;
              const isCurrent = i === idx;
              const srcWords = seg.src.split(" ");
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
                    dir={current.rtl ? "rtl" : "ltr"}
                    lang={current.rtl ? "ar" : undefined}
                    className="text-[15px] leading-relaxed"
                    style={{
                      color: COLORS.w,
                      textAlign: current.rtl ? "right" : "left",
                    }}
                  >
                    {isCurrent
                      ? srcWords.map((word, wi) => (
                          <span
                            key={wi}
                            style={{
                              opacity: wi < words ? 1 : 0,
                              transition: "opacity 280ms ease",
                            }}
                          >
                            {word}
                            {wi < srcWords.length - 1 ? " " : ""}
                          </span>
                        ))
                      : seg.src}
                    {isCurrent && words < srcWords.length && (
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
      </div>

      <p className="mt-4 text-center text-xs" style={{ color: COLORS.t4 }}>
        Live preview · actual transcription runs on your device
      </p>
    </div>
  );
}

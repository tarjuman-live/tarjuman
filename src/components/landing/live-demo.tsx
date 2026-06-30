"use client";

import { useEffect, useState } from "react";
import { COLORS } from "@/lib/constants";

/**
 * Looping preview of the recording screen, framed as an iPhone 17 Pro Max. It
 * cycles through different language PAIRS (not just everything → English): each
 * "lesson" types its own source text word-by-word and fades in a translation in
 * the matching target language, with the header showing that pair. So the demo
 * shows real translation between many languages, both directions.
 *
 * Visual demo, not a live capture. Hand-authored, accurate content — well-known
 * phrases (Basmala, Shahada, Alhamdulillah, a famous saying / hadith) rendered
 * by hand in each language, with "Allah" preserved to show the terminology
 * handling. Respects prefers-reduced-motion.
 */
interface Lesson {
  srcLang: string;
  tgtLang: string;
  srcRtl: boolean;
  tgtRtl: boolean;
  src: string;
  tgt: string;
}

const LESSONS: Lesson[] = [
  {
    srcLang: "Arabic",
    tgtLang: "English",
    srcRtl: true,
    tgtRtl: false,
    src: "الحمد لله رب العالمين، والصلاة والسلام على رسول الله ﷺ",
    tgt: "All praise is due to Allah, Lord of the worlds, and peace be upon the Messenger of Allah ﷺ.",
  },
  {
    srcLang: "French",
    tgtLang: "Spanish",
    srcRtl: false,
    tgtRtl: false,
    src: "Au nom d'Allah, le Tout Miséricordieux, le Très Miséricordieux.",
    tgt: "En el nombre de Allah, el Compasivo, el Misericordioso.",
  },
  {
    srcLang: "Turkish",
    tgtLang: "German",
    srcRtl: false,
    tgtRtl: false,
    src: "Allah'tan başka ilah yoktur, Muhammed O'nun elçisidir.",
    tgt: "Es gibt keinen Gott außer Allah, und Muhammad ist Sein Gesandter.",
  },
  {
    srcLang: "English",
    tgtLang: "Arabic",
    srcRtl: false,
    tgtRtl: true,
    src: "Seek knowledge from the cradle to the grave.",
    tgt: "اطلبوا العلم من المهد إلى اللحد.",
  },
  {
    srcLang: "Indonesian",
    tgtLang: "French",
    srcRtl: false,
    tgtRtl: false,
    src: "Segala puji bagi Allah, Tuhan semesta alam.",
    tgt: "Toutes les louanges appartiennent à Allah, Seigneur des mondes.",
  },
  {
    srcLang: "Urdu",
    tgtLang: "Turkish",
    srcRtl: true,
    tgtRtl: false,
    src: "بے شک اعمال کا دارومدار نیتوں پر ہے",
    tgt: "Şüphesiz ameller niyetlere göredir.",
  },
];

const MS_PER_WORD = 150;

export function LiveDemo() {
  const [reduce, setReduce] = useState(false);
  const [lesson, setLesson] = useState(0);
  const [words, setWords] = useState(0);
  const [tgtShown, setTgtShown] = useState(false);
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
      setWords(999);
      setTgtShown(true);
      setElapsed(6);
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

    const play = (lessonIdx: number) => {
      const l = LESSONS[lessonIdx];
      const count = l.src.split(" ").length;
      setLesson(lessonIdx);
      setWords(0);
      setTgtShown(false);
      setElapsed(0);
      for (let w = 1; w <= count; w++) after(MS_PER_WORD * w, () => setWords(w));
      const doneWords = MS_PER_WORD * count + 350;
      after(doneWords, () => setTgtShown(true));
      after(doneWords + 2400, () => play((lessonIdx + 1) % LESSONS.length));
    };

    play(0);

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
  const l = LESSONS[lesson];
  const srcWords = l.src.split(" ");

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
                {/* the language pair fades when the lesson changes */}
                <div
                  key={lesson}
                  className="flex items-center gap-1.5 text-[11px] font-semibold animate-in fade-in duration-300"
                  style={{ color: COLORS.t2 }}
                >
                  <span>{l.srcLang}</span>
                  <span style={{ color: COLORS.t4 }}>→</span>
                  <span style={{ color: COLORS.accent }}>{l.tgtLang}</span>
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

            {/* Transcript — one card per lesson, keyed so it resets cleanly */}
            <div key={lesson} className="flex-1 overflow-hidden px-4 py-4">
              <div
                className="rounded-xl px-3 py-2.5"
                style={{
                  background: COLORS.surface,
                  borderInlineStart: `2px solid ${COLORS.blue}`,
                }}
              >
                {/* source — types word-by-word */}
                <div
                  dir={l.srcRtl ? "rtl" : "ltr"}
                  lang={l.srcRtl ? "ar" : undefined}
                  className="text-[15px] leading-relaxed"
                  style={{ color: COLORS.w, textAlign: l.srcRtl ? "right" : "left" }}
                >
                  {srcWords.map((word, wi) => (
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
                  ))}
                  {words < srcWords.length && (
                    <span
                      className="inline-block align-middle ms-0.5 w-[2px] h-[1em] animate-pulse"
                      style={{ background: COLORS.accent }}
                    />
                  )}
                </div>

                {/* translation — fades in once the source is read */}
                {tgtShown && (
                  <div
                    dir={l.tgtRtl ? "rtl" : "ltr"}
                    lang={l.tgtRtl ? "ar" : undefined}
                    className="mt-2 text-[13px] leading-relaxed animate-in fade-in slide-in-from-bottom-1 duration-500"
                    style={{
                      color: COLORS.t2,
                      borderTop: `1px solid ${COLORS.border}`,
                      paddingTop: 8,
                      textAlign: l.tgtRtl ? "right" : "left",
                    }}
                  >
                    {l.tgt}
                  </div>
                )}
              </div>
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

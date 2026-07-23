"use client";

import { useEffect, useRef, useState } from "react";
import { COLORS } from "@/lib/constants";

/**
 * Looping preview of the recording screen, framed as an iPhone 17 Pro Max. Each
 * cycle picks a RANDOM source language and a random (different) target language
 * and shows the same well-known phrase typed in the source, then translated into
 * the target — so any language can pair with any other, both directions. This
 * works because every phrase is hand-authored in every demo language.
 *
 * Visual demo, not a live capture. Phrases (Alhamdulillah, the Basmala, a famous
 * saying on seeking knowledge) are hand-translated, with "Allah" preserved to
 * show the terminology handling. Respects prefers-reduced-motion.
 */
type LangCode = "ar" | "en" | "fr" | "es" | "de" | "tr" | "id" | "ur";

const LANGS: { code: LangCode; label: string; rtl: boolean }[] = [
  { code: "ar", label: "Arabic", rtl: true },
  { code: "en", label: "English", rtl: false },
  { code: "fr", label: "French", rtl: false },
  { code: "es", label: "Spanish", rtl: false },
  { code: "de", label: "German", rtl: false },
  { code: "tr", label: "Turkish", rtl: false },
  { code: "id", label: "Indonesian", rtl: false },
  { code: "ur", label: "Urdu", rtl: true },
];
const LANG_BY_CODE = Object.fromEntries(LANGS.map((l) => [l.code, l])) as Record<
  LangCode,
  (typeof LANGS)[number]
>;

const PHRASES: Record<LangCode, string>[] = [
  {
    ar: "الحمد لله رب العالمين",
    en: "All praise is due to Allah, Lord of the worlds.",
    fr: "Toutes les louanges reviennent à Allah, Seigneur des mondes.",
    es: "Todas las alabanzas pertenecen a Allah, Señor de los mundos.",
    de: "Alles Lob gebührt Allah, dem Herrn der Welten.",
    tr: "Hamd, âlemlerin Rabbi olan Allah'a mahsustur.",
    id: "Segala puji bagi Allah, Tuhan semesta alam.",
    ur: "تمام تعریفیں اللہ کے لیے ہیں جو سارے جہانوں کا رب ہے",
  },
  {
    ar: "بسم الله الرحمن الرحيم",
    en: "In the name of Allah, the Most Gracious, the Most Merciful.",
    fr: "Au nom d'Allah, le Tout Miséricordieux, le Très Miséricordieux.",
    es: "En el nombre de Allah, el Compasivo, el Misericordioso.",
    de: "Im Namen Allahs, des Allerbarmers, des Barmherzigen.",
    tr: "Rahman ve Rahim olan Allah'ın adıyla.",
    id: "Dengan nama Allah, Yang Maha Pengasih, Maha Penyayang.",
    ur: "اللہ کے نام سے جو نہایت مہربان رحم والا ہے",
  },
  {
    ar: "اطلبوا العلم من المهد إلى اللحد",
    en: "Seek knowledge from the cradle to the grave.",
    fr: "Cherchez la connaissance du berceau jusqu'à la tombe.",
    es: "Buscad el conocimiento desde la cuna hasta la tumba.",
    de: "Suche Wissen von der Wiege bis zum Grabe.",
    tr: "Beşikten mezara kadar ilim öğrenin.",
    id: "Tuntutlah ilmu dari buaian hingga liang lahat.",
    ur: "علم حاصل کرو گہوارے سے قبر تک",
  },
];

const MS_PER_WORD = 150;

export function LiveDemo() {
  const [reduce, setReduce] = useState(false);
  // Deterministic initial pair so SSR and the first client render match; the
  // effect switches to random picks right after mount.
  const [phrase, setPhrase] = useState(0);
  const [src, setSrc] = useState<LangCode>("ar");
  const [tgt, setTgt] = useState<LangCode>("en");
  const [words, setWords] = useState(0);
  const [tgtShown, setTgtShown] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const lastKey = useRef("");

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // One-shot reduced-motion fallback (post-hydration).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReduce(true);
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

    const pick = () => {
      // random source + a different random target; avoid repeating the exact
      // previous combination so the loop always feels fresh.
      for (let tries = 0; tries < 12; tries++) {
        const p = Math.floor(Math.random() * PHRASES.length);
        const si = Math.floor(Math.random() * LANGS.length);
        let ti = Math.floor(Math.random() * LANGS.length);
        if (ti === si) ti = (ti + 1) % LANGS.length;
        const key = `${p}:${si}:${ti}`;
        if (key !== lastKey.current) {
          lastKey.current = key;
          return { p, s: LANGS[si].code, t: LANGS[ti].code };
        }
      }
      return { p: 0, s: "ar" as LangCode, t: "en" as LangCode };
    };

    const play = () => {
      const { p, s, t } = pick();
      const count = PHRASES[p][s].split(" ").length;
      setPhrase(p);
      setSrc(s);
      setTgt(t);
      setWords(0);
      setTgtShown(false);
      setElapsed(0);
      for (let w = 1; w <= count; w++) after(MS_PER_WORD * w, () => setWords(w));
      const doneWords = MS_PER_WORD * count + 350;
      after(doneWords, () => setTgtShown(true));
      after(doneWords + 2400, play);
    };

    play();

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
  const srcLang = LANG_BY_CODE[src];
  const tgtLang = LANG_BY_CODE[tgt];
  const srcText = PHRASES[phrase][src];
  const tgtText = PHRASES[phrase][tgt];
  const srcWords = srcText.split(" ");
  const pairKey = `${phrase}:${src}:${tgt}`;

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
                {/* the language pair fades when it changes */}
                <div
                  key={pairKey}
                  className="flex items-center gap-1.5 text-[11px] font-semibold animate-in fade-in duration-300"
                  style={{ color: COLORS.t2 }}
                >
                  <span>{srcLang.label}</span>
                  <span style={{ color: COLORS.t4 }}>→</span>
                  <span style={{ color: COLORS.accent }}>{tgtLang.label}</span>
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

            {/* Transcript — one card per pair, keyed so it resets cleanly */}
            <div key={pairKey} className="flex-1 overflow-hidden px-4 py-4">
              <div
                className="rounded-xl px-3 py-2.5"
                style={{
                  background: COLORS.surface,
                  borderInlineStart: `2px solid ${COLORS.blue}`,
                }}
              >
                {/* source — types word-by-word */}
                <div
                  dir={srcLang.rtl ? "rtl" : "ltr"}
                  lang={srcLang.rtl ? "ar" : undefined}
                  className="text-[15px] leading-relaxed"
                  style={{ color: COLORS.w, textAlign: srcLang.rtl ? "right" : "left" }}
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
                </div>

                {/* translation — fades in once the source is read */}
                {tgtShown && (
                  <div
                    dir={tgtLang.rtl ? "rtl" : "ltr"}
                    lang={tgtLang.rtl ? "ar" : undefined}
                    className="mt-2 text-[13px] leading-relaxed animate-in fade-in slide-in-from-bottom-1 duration-500"
                    style={{
                      color: COLORS.t2,
                      borderTop: `1px solid ${COLORS.border}`,
                      paddingTop: 8,
                      textAlign: tgtLang.rtl ? "right" : "left",
                    }}
                  >
                    {tgtText}
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

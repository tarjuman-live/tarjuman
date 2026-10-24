import { MarketingNav } from "@/components/landing/marketing-nav";
import { LiveDemo } from "@/components/landing/live-demo";
import { RotatingText } from "@/components/landing/rotating-text";
import { Features } from "@/components/landing/features";
import { TryItFree } from "@/components/landing/try-it-free";
import { UseCases } from "@/components/landing/use-cases";
import { EarlyNote } from "@/components/landing/early-note";
import { Faq } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { Pricing } from "@/components/landing/pricing";
import { Reveal } from "@/components/landing/reveal";
import { T } from "@/components/landing/t";
import { JsonLd } from "@/components/seo/json-ld";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { MotionProvider } from "@/components/providers/motion-provider";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { HeroParallax } from "@/components/landing/hero-parallax";
import { HeroGlow } from "@/components/landing/hero-glow";
import { SHOW_PRICING } from "@/lib/constants";

// Hero left-column items center on mobile, left-align from lg up (beside the
// demo) — mirrors the column's own alignment so Reveal doesn't shift layout.
const HERO_ITEM = "w-full flex flex-col items-center lg:items-start";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col">
      {/* applyDir=false: only nav/hero/headings are translated, so we don't
          flip the whole marketing layout RTL (the English bodies stay LTR). */}
      <LocaleProvider applyDir={false}>
      <MotionProvider>
      <JsonLd />
      <SmoothScroll />
      <MarketingNav />

      {/* Hero — pitch + CTA beside the live demo on desktop; stacked on mobile.
          Extra top padding clears the floating island nav. */}
      <section className="relative overflow-hidden px-6 pt-24 pb-16 sm:pt-28 sm:pb-24">
        {/* HeroGlow renders the CSS glow always, and swaps in a small WebGL
            quad on desktop only (see hero-glow.tsx). HeroParallax adds a
            scroll-scrubbed parallax over whichever one is showing — it wraps
            rather than targets, because .hero-glow's CSS keyframe already owns
            that element's transform. */}
        <HeroParallax>
          <HeroGlow />
        </HeroParallax>

        <div className="mx-auto max-w-6xl grid lg:grid-cols-2 items-center gap-14 lg:gap-10 lg:min-h-[78vh]">
          {/* Left — the pitch */}
          <div className="flex flex-col items-center lg:items-start text-center lg:text-left gap-6">
            <Reveal delay={0} className={HERO_ITEM} fade={false}>
              <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]/30">
                ✦ <T k="lp.heroEyebrow" />
              </span>
            </Reveal>

            <Reveal delay={90} className={HERO_ITEM} fade={false}>
              <h1 className="text-3xl sm:text-5xl font-bold max-w-xl leading-[1.1]">
                <T k="lp.heroTitle" />
              </h1>
            </Reveal>

            <Reveal delay={180} className={HERO_ITEM} fade={false}>
              <p className="max-w-md text-[var(--color-text-2)] text-base sm:text-lg leading-relaxed">
                <T k="lp.heroSubhead" />
              </p>
            </Reveal>

            <Reveal delay={270} className={HERO_ITEM} fade={false}>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <TryItFree />
                <a
                  href="#features"
                  className="px-5 py-3 rounded-xl font-semibold border transition-all duration-200 text-[var(--color-text-2)] border-[var(--color-border-light)] hover:bg-[var(--color-accent)] hover:text-[#0A0F1C] hover:border-[var(--color-accent)] hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(46,204,113,0.5)]"
                >
                  <T k="lp.seeHow" />
                </a>
              </div>
            </Reveal>

            <Reveal delay={350} className={HERO_ITEM} fade={false}>
              <p className="text-xs text-[var(--color-text-4)]">
                Free to start ·{" "}
                <RotatingText
                  items={[
                    "Arabic",
                    "Urdu",
                    "Spanish",
                    "French",
                    "Turkish",
                    "Indonesian",
                  ]}
                  className="font-semibold text-[var(--color-accent)]"
                />{" "}
                into 30+ languages · Live transcription, translation &amp;
                summaries · No card required
              </p>
            </Reveal>
          </div>

          {/* Right — the live demo */}
          <Reveal
            delay={220}
            className="w-full flex justify-center lg:justify-end"
          >
            <LiveDemo />
          </Reveal>
        </div>
      </section>

      {/* Sections self-animate (heading first, then items stagger in) */}
      <Features />
      <UseCases />
      {/* Pricing built but localhost-only until launch (see SHOW_PRICING) */}
      {SHOW_PRICING && <Pricing />}
      <EarlyNote />
      <Faq />
      <Footer />
      </MotionProvider>
      </LocaleProvider>
    </main>
  );
}

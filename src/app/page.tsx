import { Features } from "@/components/landing/features";
import { TryItFree } from "@/components/landing/try-it-free";
import { UseCases } from "@/components/landing/use-cases";
import { Testimonials } from "@/components/landing/testimonials";
import { Faq } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { Reveal } from "@/components/landing/reveal";
import { JsonLd } from "@/components/seo/json-ld";
import { SITE_NAME, SITE_NAME_AR } from "@/lib/site";

// Full-width centering wrapper for staggered hero items — replicates the
// hero section's own centering so the Reveal wrapper doesn't shift layout.
const HERO_ITEM = "w-full flex flex-col items-center";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col">
      <JsonLd />

      {/* Hero — staggered rise on load over a slow-drifting ambient glow */}
      <section className="relative overflow-hidden flex flex-col items-center justify-center text-center px-6 pt-20 pb-16 sm:pt-28 sm:pb-24 gap-6 min-h-[86vh]">
        <div
          aria-hidden
          className="hero-glow pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(46,204,113,0.16), rgba(46,204,113,0) 70%)",
          }}
        />

        <Reveal delay={0} className={HERO_ITEM} fade={false}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)] grid place-items-center shadow-[0_0_30px_rgba(46,204,113,0.4)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0A0F1C"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0014 0" />
                <line x1="12" y1="20" x2="12" y2="24" />
              </svg>
            </div>
            <span className="text-xl font-bold">{SITE_NAME}</span>
            <span
              className="text-lg text-[var(--color-text-3)]"
              lang="ar"
              dir="rtl"
            >
              {SITE_NAME_AR}
            </span>
          </div>
        </Reveal>

        <Reveal delay={90} className={HERO_ITEM} fade={false}>
          <h1 className="text-3xl sm:text-5xl font-bold max-w-2xl leading-[1.1]">
            Real-time khutbah transcription &amp; translation
          </h1>
        </Reveal>

        <Reveal delay={180} className={HERO_ITEM} fade={false}>
          <p className="max-w-md text-[var(--color-text-2)] text-base sm:text-lg leading-relaxed">
            Tarjuman turns Arabic speech into on-screen English as it&apos;s
            spoken — preserving Islamic terms — and writes your summary when the
            lecture ends.
          </p>
        </Reveal>

        <Reveal delay={270} className={HERO_ITEM} fade={false}>
          <TryItFree />
        </Reveal>

        <Reveal delay={350} className={HERO_ITEM} fade={false}>
          <p className="text-xs text-[var(--color-text-4)]">
            Free to start · Arabic → English &amp; 30+ languages
          </p>
        </Reveal>
      </section>

      {/* Sections self-animate (heading first, then items stagger in) */}
      <Features />
      <UseCases />
      <Testimonials />
      <Faq />
      <Footer />
    </main>
  );
}

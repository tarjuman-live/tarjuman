import { Reveal } from "./reveal";
import { TryItFree } from "./try-it-free";
import { T } from "./t";

/**
 * Honest early-stage trust band — the slot where real testimonials will go.
 *
 * Tarjuman has no users yet, so there are no genuine quotes to show. Rather
 * than fabricate social proof (the previous placeholder cards did), this says
 * so plainly and turns it into an invitation. Replace this whole section with
 * a real-quotes grid once people have shared consented feedback — do NOT ship
 * invented named endorsements to real visitors.
 */
export function EarlyNote() {
  return (
    <section className="w-full max-w-5xl mx-auto px-6 py-16 sm:py-24">
      <Reveal>
        <h2 className="text-2xl sm:text-3xl font-bold text-center leading-tight">
          <T k="lp.earlyHeading" />
        </h2>
      </Reveal>

      <Reveal delay={90}>
        <div className="mt-10 mx-auto max-w-2xl rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-8 sm:p-10 text-center transition duration-200 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] hover:shadow-[0_10px_30px_rgba(46,204,113,0.18)]">
          <p className="text-lg sm:text-xl font-semibold text-[var(--color-text-1)] leading-relaxed">
            Tarjuman just launched.
          </p>
          <p className="mt-3 text-[var(--color-text-2)] leading-relaxed">
            No paid reviews, no invented quotes — just the tool. Try it at this
            week&apos;s khutbah, and tell us what worked and what broke.
          </p>

          <div className="mt-7 flex justify-center">
            <TryItFree />
          </div>

          <p className="mt-7 text-xs text-[var(--color-text-4)]">
            Real stories from real users will live here once people have shared
            them — with their consent.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

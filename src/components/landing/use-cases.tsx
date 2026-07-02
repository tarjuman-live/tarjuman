import { Reveal } from "./reveal";
import { T } from "./t";
import type { MessageKey } from "@/lib/i18n/messages";

const USE_CASES: { titleKey: MessageKey; bodyKey: MessageKey }[] = [
  { titleKey: "lp.use1Title", bodyKey: "lp.use1Body" },
  { titleKey: "lp.use2Title", bodyKey: "lp.use2Body" },
  { titleKey: "lp.use3Title", bodyKey: "lp.use3Body" },
  { titleKey: "lp.use4Title", bodyKey: "lp.use4Body" },
];

export function UseCases() {
  return (
    <section id="use-cases" className="w-full">
      <div className="max-w-5xl mx-auto px-6 py-16 sm:py-24">
        <Reveal>
          <h2 className="text-2xl sm:text-3xl font-bold text-center leading-tight">
            <T k="lp.useCasesHeading" />
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map(({ titleKey, bodyKey }, i) => (
            <Reveal key={titleKey} delay={60 + i * 80} className="h-full">
              <div className="group relative h-full overflow-hidden rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-5 transition duration-200 hover:-translate-y-1.5 hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] hover:shadow-[0_14px_36px_rgba(46,204,113,0.2)]">
                {/* accent bar that grows in from the left edge on hover */}
                <span className="absolute left-0 top-0 h-full w-[3px] origin-top scale-y-0 bg-[var(--color-accent)] transition-transform duration-300 group-hover:scale-y-100" />
                <h3
                  dir="auto"
                  className="text-base font-semibold text-[var(--color-accent)] transition-transform duration-200 group-hover:translate-x-1"
                >
                  <T k={titleKey} />
                </h3>
                <p
                  dir="auto"
                  className="mt-1.5 text-[var(--color-text-2)] text-sm leading-relaxed"
                >
                  <T k={bodyKey} />
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

import { Reveal } from "./reveal";
import { T } from "./t";

const USE_CASES = [
  {
    title: "Friday khutbahs",
    body: "Follow the Jumu'ah khutbah in English as it's delivered in Arabic.",
  },
  {
    title: "Lectures & duroos",
    body: "Sit in on classes and halaqahs without missing the point of a passage.",
  },
  {
    title: "University & classes",
    body: "Capture lectures in any of 30+ languages and review a summary later.",
  },
  {
    title: "Conferences & meetings",
    body: "Keep up with multilingual talks and panels in real time.",
  },
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
          {USE_CASES.map(({ title, body }, i) => (
            <Reveal key={title} delay={60 + i * 80} className="h-full">
              <div className="group relative h-full overflow-hidden rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-5 transition duration-200 hover:-translate-y-1.5 hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] hover:shadow-[0_14px_36px_rgba(46,204,113,0.2)]">
                {/* accent bar that grows in from the left edge on hover */}
                <span className="absolute left-0 top-0 h-full w-[3px] origin-top scale-y-0 bg-[var(--color-accent)] transition-transform duration-300 group-hover:scale-y-100" />
                <h3 className="text-base font-semibold text-[var(--color-accent)] transition-transform duration-200 group-hover:translate-x-1">
                  {title}
                </h3>
                <p className="mt-1.5 text-[var(--color-text-2)] text-sm leading-relaxed">
                  {body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

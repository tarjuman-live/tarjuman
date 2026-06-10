import { Reveal } from "./reveal";

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
    <section className="w-full bg-[var(--color-surface)] border-y border-[var(--color-border-light)]">
      <div className="max-w-5xl mx-auto px-6 py-16 sm:py-24">
        <Reveal>
          <h2 className="text-2xl sm:text-3xl font-bold text-center leading-tight">
            Where people use Tarjuman
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map(({ title, body }, i) => (
            <Reveal key={title} delay={60 + i * 80} className="h-full">
              <div className="h-full rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg)] p-5 transition duration-200 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] hover:shadow-[0_10px_30px_rgba(46,204,113,0.18)]">
                <h3 className="text-base font-semibold text-[var(--color-accent)]">
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

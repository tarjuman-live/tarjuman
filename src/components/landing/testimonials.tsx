import { Reveal } from "./reveal";

// ⚠️ PLACEHOLDER testimonials — illustrative, role-based (not real named
// people). Replace each with a real, consented quote (and a real name if the
// person agrees) before relying on this as social proof. Do NOT ship invented
// named endorsements to real visitors.
const TESTIMONIALS = [
  {
    quote:
      "I finally follow the Friday khutbah instead of just standing there — the English shows up as the khateeb speaks.",
    name: "A student",
    role: "Madinah",
  },
  {
    quote:
      "It keeps the Islamic terms intact. 'Subhan'Allah', the Quran references — they're not flattened the way other translators do it.",
    name: "A masjid attendee",
    role: "Friday prayers",
  },
  {
    quote:
      "Recorded a 40-minute lecture and had clean notes in seconds. No more scribbling in the dark.",
    name: "A class attendee",
    role: "Weekly halaqah",
  },
];

export function Testimonials() {
  return (
    <section className="w-full max-w-5xl mx-auto px-6 py-16 sm:py-24">
      <Reveal>
        <h2 className="text-2xl sm:text-3xl font-bold text-center leading-tight">
          What people are saying
        </h2>
        <p className="mt-3 text-center text-[var(--color-text-2)] max-w-xl mx-auto">
          Built for non-Arabic speakers following khutbahs, lectures, and
          classes — wherever the talk is in a language you&apos;re still
          learning.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {TESTIMONIALS.map(({ quote, name, role }, i) => {
          const initial = name.replace(/^A\s+/i, "").charAt(0).toUpperCase();
          return (
            <Reveal key={quote} delay={80 + i * 90} className="h-full">
              <figure className="h-full flex flex-col rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-6 transition duration-200 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] hover:shadow-[0_10px_30px_rgba(46,204,113,0.18)]">
                <blockquote className="flex-1 text-[var(--color-text-1)] leading-relaxed">
                  “{quote}”
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <span
                    className="w-9 h-9 rounded-full grid place-items-center text-[13px] font-bold shrink-0"
                    style={{
                      background: "var(--color-accent-soft)",
                      color: "var(--color-accent)",
                    }}
                    aria-hidden
                  >
                    {initial}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                      {name}
                    </span>
                    <span className="block text-[12px] text-[var(--color-text-3)]">
                      {role}
                    </span>
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

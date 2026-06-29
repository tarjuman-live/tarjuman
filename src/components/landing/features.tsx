import { Languages, BookOpen, Waves, Sparkles } from "lucide-react";
import { Reveal } from "./reveal";

const FEATURES = [
  {
    icon: Languages,
    title: "Live dual-language transcript",
    body: "See the Arabic and the English together as the speaker talks. Each sentence is translated the moment it lands — no waiting until the end.",
  },
  {
    icon: BookOpen,
    title: "Islamic terminology, kept intact",
    body: "Allah, the ﷺ honorific, and Quran and hadith references are preserved — not flattened the way generic translators handle them.",
  },
  {
    icon: Waves,
    title: "Made for masjid & hall audio",
    body: "A noise-cleaning pipeline and a live signal meter handle PA speakers, reverb and crowd noise, so audio from across the room stays usable.",
  },
  {
    icon: Sparkles,
    title: "Instant AI summary",
    body: "Stop recording and get the main topic, key points and takeaways — clear notes from the whole lecture without writing a word.",
  },
];

export function Features() {
  return (
    <section id="features" className="w-full max-w-5xl mx-auto px-6 py-16 sm:py-24">
      <Reveal>
        <h2 className="text-2xl sm:text-3xl font-bold text-center max-w-2xl mx-auto leading-tight">
          Everything you need to follow an Arabic lecture
        </h2>
        <p className="mt-3 text-center text-[var(--color-text-2)] max-w-xl mx-auto">
          Tarjuman is built for the real environment — a khateeb on a PA system,
          across a crowded hall, in a language you&apos;re still learning.
        </p>
      </Reveal>
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <Reveal key={title} delay={80 + i * 90} className="h-full">
            <div className="group h-full rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-6 transition duration-200 hover:-translate-y-1.5 hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] hover:shadow-[0_14px_36px_rgba(46,204,113,0.2)]">
              <div className="w-11 h-11 rounded-xl bg-[var(--color-accent-soft)] grid place-items-center transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-3 group-hover:shadow-[0_0_20px_rgba(46,204,113,0.35)]">
                <Icon className="w-5 h-5 text-[var(--color-accent)]" strokeWidth={2} />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-1.5 text-[var(--color-text-2)] text-sm leading-relaxed">
                {body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

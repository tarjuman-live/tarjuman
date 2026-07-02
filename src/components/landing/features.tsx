import { Languages, BookOpen, Waves, Sparkles } from "lucide-react";
import { Reveal } from "./reveal";
import { T } from "./t";
import type { MessageKey } from "@/lib/i18n/messages";

const FEATURES: {
  icon: typeof Languages;
  titleKey: MessageKey;
  bodyKey: MessageKey;
}[] = [
  { icon: Languages, titleKey: "lp.feat1Title", bodyKey: "lp.feat1Body" },
  { icon: BookOpen, titleKey: "lp.feat2Title", bodyKey: "lp.feat2Body" },
  { icon: Waves, titleKey: "lp.feat3Title", bodyKey: "lp.feat3Body" },
  { icon: Sparkles, titleKey: "lp.feat4Title", bodyKey: "lp.feat4Body" },
];

export function Features() {
  return (
    <section id="features" className="w-full max-w-5xl mx-auto px-6 py-16 sm:py-24">
      <Reveal>
        <h2 className="text-2xl sm:text-3xl font-bold text-center max-w-2xl mx-auto leading-tight">
          <T k="lp.featuresHeading" />
        </h2>
        <p
          dir="auto"
          className="mt-3 text-center text-[var(--color-text-2)] max-w-xl mx-auto"
        >
          <T k="lp.featuresSub" />
        </p>
      </Reveal>
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, titleKey, bodyKey }, i) => (
          <Reveal key={titleKey} delay={80 + i * 90} className="h-full">
            <div className="group relative h-full overflow-hidden rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-6 transition duration-200 hover:-translate-y-1.5 hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] hover:shadow-[0_14px_36px_rgba(46,204,113,0.2)]">
              {/* accent bar that grows in from the left edge on hover */}
              <span className="absolute left-0 top-0 h-full w-[3px] origin-top scale-y-0 bg-[var(--color-accent)] transition-transform duration-300 group-hover:scale-y-100" />
              <div className="w-11 h-11 rounded-xl bg-[var(--color-accent-soft)] grid place-items-center transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-3 group-hover:shadow-[0_0_20px_rgba(46,204,113,0.35)]">
                <Icon className="w-5 h-5 text-[var(--color-accent)]" strokeWidth={2} />
              </div>
              <h3 dir="auto" className="mt-4 text-lg font-semibold">
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
    </section>
  );
}

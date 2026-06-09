import { ChevronDown } from "lucide-react";
import { FAQ_ITEMS } from "./faq-items";

// Native <details> so the answers live in the DOM (crawlable, no client JS) and
// stay accessible. The matching FAQPage JSON-LD is emitted by json-ld.tsx.
export function Faq() {
  return (
    <section className="w-full max-w-3xl mx-auto px-6 py-16 sm:py-24">
      <h2 className="text-2xl sm:text-3xl font-bold text-center leading-tight">
        Frequently asked questions
      </h2>
      <div className="mt-10 flex flex-col gap-3">
        {FAQ_ITEMS.map(({ q, a }) => (
          <details
            key={q}
            className="group rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] px-5 open:bg-[var(--color-surface-light)]"
          >
            <summary className="flex items-center justify-between gap-4 cursor-pointer list-none py-4 [&::-webkit-details-marker]:hidden">
              <h3 className="text-base font-medium">{q}</h3>
              <ChevronDown className="w-5 h-5 shrink-0 text-[var(--color-text-3)] transition-transform group-open:rotate-180" />
            </summary>
            <p className="pb-5 -mt-1 text-[var(--color-text-2)] text-sm leading-relaxed">
              {a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

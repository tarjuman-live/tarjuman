import { FAQ_ITEMS } from "./faq-items";
import { Reveal } from "./reveal";
import { FaqItem } from "./faq-item";

// Rows open/close fluidly (see faq-item.tsx). The matching FAQPage JSON-LD is
// emitted by json-ld.tsx; answers live in the DOM, so they stay crawlable.
export function Faq() {
  return (
    <section className="w-full max-w-3xl mx-auto px-6 py-16 sm:py-24">
      <Reveal>
        <h2 className="text-2xl sm:text-3xl font-bold text-center leading-tight">
          Frequently asked questions
        </h2>
      </Reveal>
      <div className="mt-10 flex flex-col gap-3">
        {FAQ_ITEMS.map(({ q, a }, i) => (
          <Reveal key={q} delay={60 + i * 70}>
            <FaqItem q={q} a={a} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

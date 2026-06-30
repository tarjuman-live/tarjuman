import { FAQ_ITEMS } from "./faq-items";
import { Reveal } from "./reveal";
import { FaqItem } from "./faq-item";
import { T } from "./t";

// Rows open/close fluidly (see faq-item.tsx). The matching FAQPage JSON-LD is
// emitted by json-ld.tsx; answers live in the DOM, so they stay crawlable.
export function Faq() {
  return (
    <section id="faq" className="w-full max-w-3xl mx-auto px-6 py-16 sm:py-24">
      <Reveal>
        <h2 className="text-2xl sm:text-3xl font-bold text-center leading-tight">
          <T k="lp.faqHeading" />
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

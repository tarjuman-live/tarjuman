import { Reveal } from "./reveal";
import { FaqItem } from "./faq-item";
import { T } from "./t";
import type { MessageKey } from "@/lib/i18n/messages";

// Question/answer message-key pairs. The English source lives in messages.ts
// (lp.faqQ*/lp.faqA*) and mirrors faq-items.ts, which still feeds the FAQPage
// JSON-LD (kept English to match the server-rendered / crawled page).
const FAQ_KEYS: { qKey: MessageKey; aKey: MessageKey }[] = [
  { qKey: "lp.faqQ1", aKey: "lp.faqA1" },
  { qKey: "lp.faqQ2", aKey: "lp.faqA2" },
  { qKey: "lp.faqQ3", aKey: "lp.faqA3" },
  { qKey: "lp.faqQ4", aKey: "lp.faqA4" },
  { qKey: "lp.faqQ5", aKey: "lp.faqA5" },
  { qKey: "lp.faqQ6", aKey: "lp.faqA6" },
];

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
        {FAQ_KEYS.map(({ qKey, aKey }, i) => (
          <Reveal key={qKey} delay={60 + i * 70}>
            <FaqItem qKey={qKey} aKey={aKey} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

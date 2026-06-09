/**
 * Shared FAQ source of truth. Rendered visibly by faq.tsx AND emitted as
 * FAQPage JSON-LD by json-ld.tsx — keeping them in one place guarantees the
 * structured data always matches what users actually see (Google penalizes
 * FAQ schema that doesn't match visible content).
 *
 * Each question is phrased the way someone would actually search, so the
 * answers double as long-tail landing content.
 */
export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Can I translate a khutbah in real time?",
    a: "Yes. Tarjuman listens to the khutbah and shows the Arabic transcription alongside an English translation on screen as the khateeb speaks, so you follow along live instead of waiting for notes afterward.",
  },
  {
    q: "Does it work in a noisy masjid or lecture hall?",
    a: "It's built for audio coming through PA speakers in reverberant rooms. Tarjuman runs the microphone through a noise-cleaning pipeline — high-pass, low-pass, compression and gain — and shows a live signal meter so you can position your phone for the clearest capture.",
  },
  {
    q: "Which languages does it support?",
    a: "Tarjuman transcribes and translates Arabic to English plus 30+ other languages, including Urdu, Turkish, French, Spanish, Indonesian and Malay. You choose the source and target language before you record.",
  },
  {
    q: "Does it preserve Islamic terminology?",
    a: "Yes — that's the whole point. Translations keep terms like Allah, the ﷺ honorific, and Quran and hadith references intact instead of flattening them, so the meaning a khutbah audience expects is preserved.",
  },
  {
    q: "Can I get a summary of the lecture afterward?",
    a: "When you stop recording, Tarjuman can generate an AI summary of the whole session — main topic, key points and takeaways — so you leave with clear notes without writing anything down.",
  },
  {
    q: "Is Tarjuman free?",
    a: "Tarjuman is free to start. Open the recorder, pick your languages, and tap record — you can transcribe, translate and generate a summary right away.",
  },
];

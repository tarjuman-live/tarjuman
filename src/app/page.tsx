import Link from "next/link";
import { Features } from "@/components/landing/features";
import { UseCases } from "@/components/landing/use-cases";
import { Faq } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { JsonLd } from "@/components/seo/json-ld";
import { SITE_NAME, SITE_NAME_AR } from "@/lib/site";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col">
      <JsonLd />

      {/* Hero */}
      <section className="flex flex-col items-center justify-center text-center px-6 pt-20 pb-16 sm:pt-28 sm:pb-24 gap-6 min-h-[86vh]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)] grid place-items-center shadow-[0_0_30px_rgba(46,204,113,0.4)]">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0A0F1C"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0014 0" />
              <line x1="12" y1="20" x2="12" y2="24" />
            </svg>
          </div>
          <span className="text-xl font-bold">{SITE_NAME}</span>
          <span
            className="text-lg text-[var(--color-text-3)]"
            lang="ar"
            dir="rtl"
          >
            {SITE_NAME_AR}
          </span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-bold max-w-2xl leading-[1.1]">
          Real-time khutbah transcription &amp; translation
        </h1>
        <p className="max-w-md text-[var(--color-text-2)] text-base sm:text-lg leading-relaxed">
          Tarjuman turns Arabic speech into on-screen English as it&apos;s
          spoken — preserving Islamic terms — and writes your summary when the
          lecture ends.
        </p>

        <Link
          href="/record"
          className="mt-2 px-6 py-3 rounded-xl bg-[var(--color-accent)] text-[#0A0F1C] font-bold shadow-[0_0_24px_rgba(46,204,113,0.35)] hover:brightness-110 transition"
        >
          Try it free
        </Link>
        <p className="text-xs text-[var(--color-text-4)]">
          Free to start · Arabic → English &amp; 30+ languages
        </p>
      </section>

      <Features />
      <UseCases />
      <Faq />
      <Footer />
    </main>
  );
}

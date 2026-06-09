import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
} from "@/lib/site";
import { FAQ_ITEMS } from "@/components/landing/faq-items";

/**
 * Structured data for the landing page. Gives Google a machine-readable signal
 * that this is a free web app and surfaces the FAQ for rich results. Rendered
 * server-side so crawlers see it in the initial HTML.
 */

const webApplication = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": `${SITE_URL}/#app`,
  name: SITE_NAME,
  alternateName: "Tarjuman — Live Khutbah Transcription & Translation",
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: "ProductivityApplication",
  operatingSystem: "Web, iOS, Android",
  inLanguage: ["ar", "en"],
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "Real-time Arabic-to-English transcription and translation",
    "Preserves Islamic terminology (Allah, ﷺ, Quran and hadith references)",
    "Tuned for noisy masjid and lecture-hall PA audio",
    "Instant AI summary of the full session",
    "30+ supported languages",
  ],
  screenshot: `${SITE_URL}/opengraph-image`,
  publisher: { "@id": `${SITE_URL}/#org` },
};

const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#org`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon-512.png`,
};

const faqPage = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.a,
    },
  })),
};

export function JsonLd() {
  return (
    <>
      {[webApplication, organization, faqPage].map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          // Structured data is static, app-authored JSON — safe to inline.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}

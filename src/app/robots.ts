import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Allow indexing of public marketing pages. Sign-in/sign-up live in a popup on
 * the landing now (no standalone /login or /signup pages). Block everything
 * under /start, /record, /history, /session/* (auth-gated, contains private
 * data) and
 * /api/* (no value to crawlers, just adds noise to logs).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy", "/terms"],
        disallow: ["/start", "/record", "/history", "/session/", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

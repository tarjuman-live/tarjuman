import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Allow indexing of public marketing + auth pages. Block everything under
 * /record, /history, /session/* (auth-gated, contains private data) and
 * /api/* (no value to crawlers, just adds noise to logs).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/signup", "/forgot-password", "/privacy", "/terms"],
        disallow: ["/record", "/history", "/session/", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

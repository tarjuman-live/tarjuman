"use client";

import { useLocale } from "@/lib/i18n/locale-context";
import type { MessageKey } from "@/lib/i18n/messages";

/**
 * Inline localized text. Lets server-rendered landing components (hero, section
 * headings) show translated strings without becoming client components
 * themselves — only this leaf is a client component. Renders the default
 * (English) on the server, switching on the client when the locale changes.
 */
export function T({ k }: { k: MessageKey }) {
  const { t } = useLocale();
  return <>{t(k)}</>;
}

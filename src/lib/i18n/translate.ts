import type { LocaleCode } from "./locales";
import { MESSAGES, type MessageKey } from "./messages";
import { EXTRA_LOCALES } from "./messages-extra";
import { LANDING_LOCALES } from "./messages-landing";

/**
 * Pure UI-string lookup, shared by the web LocaleProvider and the native app
 * (mobile/src/i18n). No React, no DOM, no storage: give it a locale + key and
 * it returns the string, so both platforms resolve every key identically.
 */

export type TranslateVars = Record<string, string | number>;

/**
 * Resolve a key for a locale WITHOUT the raw-key fallback. Resolution order:
 * curated locale (messages.ts) → machine-translated dashboard locale
 * (messages-extra.ts) → machine-translated landing-body locale
 * (messages-landing.ts) → English. `undefined` means the key is unknown.
 */
export function lookupMessage(locale: LocaleCode | string, key: string): string | undefined {
  const entry = (MESSAGES as Record<string, Record<string, string> | undefined>)[key];
  return (
    entry?.[locale] ??
    EXTRA_LOCALES[locale]?.[key as MessageKey] ??
    LANDING_LOCALES[locale]?.[key as MessageKey] ??
    entry?.en
  );
}

/** `{name}` placeholder substitution (first occurrence of each var, as before). */
export function interpolate(str: string, vars?: TranslateVars): string {
  if (!vars) return str;
  let out = str;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(`{${k}}`, String(v));
  }
  return out;
}

/** Full `t()`: lookup → raw key when unknown → var substitution. */
export function translate(
  locale: LocaleCode | string,
  key: MessageKey,
  vars?: TranslateVars
): string {
  return interpolate(lookupMessage(locale, key) ?? key, vars);
}

/**
 * Outside-a-provider fallback: English (or the raw key), no substitution —
 * identical to what `useLocale()` has always returned without a provider.
 */
export function translateEnglishFallback(key: MessageKey): string {
  const entry = MESSAGES[key] as Record<string, string> | undefined;
  return entry?.en ?? key;
}

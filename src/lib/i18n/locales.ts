/**
 * UI locales for the dashboard (the *interface* language — separate from the
 * transcription source/target languages in src/lib/constants LANGUAGES).
 * Arabic and Urdu render the dashboard right-to-left.
 */
export const UI_LOCALES = [
  { code: "en", label: "English", native: "English", rtl: false },
  { code: "ar", label: "Arabic", native: "العربية", rtl: true },
  { code: "ur", label: "Urdu", native: "اردو", rtl: true },
  { code: "fr", label: "French", native: "Français", rtl: false },
  { code: "es", label: "Spanish", native: "Español", rtl: false },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia", rtl: false },
  { code: "tr", label: "Turkish", native: "Türkçe", rtl: false },
  { code: "bn", label: "Bengali", native: "বাংলা", rtl: false },
  { code: "ms", label: "Malay", native: "Bahasa Melayu", rtl: false },
  { code: "de", label: "German", native: "Deutsch", rtl: false },
] as const;

export type LocaleCode = (typeof UI_LOCALES)[number]["code"];

export const DEFAULT_LOCALE: LocaleCode = "en";

export function isRtlLocale(code: string): boolean {
  return code === "ar" || code === "ur";
}

export function isLocaleCode(code: string): code is LocaleCode {
  return UI_LOCALES.some((l) => l.code === code);
}

/** Best-effort: map a browser language tag (e.g. "ar-SA") to a supported UI locale. */
export function localeFromNavigator(lang: string | undefined): LocaleCode {
  if (!lang) return DEFAULT_LOCALE;
  const base = lang.toLowerCase().split("-")[0];
  return isLocaleCode(base) ? base : DEFAULT_LOCALE;
}

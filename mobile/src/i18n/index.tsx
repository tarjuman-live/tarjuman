/**
 * Native UI-language layer. Same strings + same resolution order as the web
 * (via the shared pure module @shared/i18n/translate), plus native-only
 * strings from ./strings/<owner>.ts.
 *
 * API
 *   <LocaleProvider>            — root only (mounted in app/_layout.tsx).
 *   useLocale() → { locale, setLocale, dir, isRtl, t }
 *   useT()      → t(key, fallbackOrVars?, vars?)
 *       t("record.copy")                          web MessageKey
 *       t("history.title", { n: 3 })              with {n} substitution
 *       t("foundation.cancel")                    native-only key
 *       t("session.newThing", "New thing")        unknown key → English fallback
 *   Resolution: web MessageKey chain (curated → EXTRA_LOCALES →
 *   LANDING_LOCALES → en) → native strings (l10n/<locale> → en) → fallback
 *   → key.
 *
 * Initial locale: the saved choice (SecureStore "tarjuman.locale", read
 * synchronously so there is no English flash) → else the device's first
 * preferred language mapped with the web's localeFromNavigator().
 *
 * RTL: I18nManager.forceRTL only takes effect after an app reload, which would
 * make switching the UI language a restart. Instead `dir` / `isRtl` are
 * exposed and screens apply RTL exactly where the web sets dir="rtl":
 *   - text: `writingDirection: dir` (+ textAlign "right" where the web
 *     right-aligns), see `rtlText(dir)` below;
 *   - rows: `flexDirection: isRtl ? "row-reverse" : "row"` (`rtlRow(dir)`);
 *   - directional icons (chevrons/back arrows): mirror with scaleX: -1.
 *   Transcript text direction follows the SOURCE/TARGET language (lib/lang
 *   isRtl), not the UI locale — same as the web.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as SecureStore from "expo-secure-store";
import { getLocales } from "expo-localization";
import {
  DEFAULT_LOCALE,
  isLocaleCode,
  isRtlLocale,
  localeFromNavigator,
  type LocaleCode,
} from "@shared/i18n/locales";
import type { MessageKey } from "@shared/i18n/messages";
import { interpolate, lookupMessage, type TranslateVars } from "@shared/i18n/translate";
import { NATIVE } from "./native-strings";
import { NATIVE_L10N } from "./l10n";

export type { LocaleCode } from "@shared/i18n/locales";
export type { MessageKey } from "@shared/i18n/messages";
export type { NativeStrings, NativeStringEntry } from "./types";
export type { NativeKey } from "./native-strings";
export { UI_LOCALES, isRtlLocale } from "@shared/i18n/locales";

/** A web MessageKey (autocompletes) or any native-only key. */
export type TKey = MessageKey | (string & {});
export type TFunction = (
  key: TKey,
  fallbackOrVars?: string | TranslateVars,
  vars?: TranslateVars
) => string;
export type Dir = "ltr" | "rtl";

const STORAGE_KEY = "tarjuman.locale"; // SecureStore keys: [A-Za-z0-9._-]

/** Pure resolver — usable outside React (e.g. Alert text in a callback). */
export function translateNative(
  locale: LocaleCode,
  key: TKey,
  fallbackOrVars?: string | TranslateVars,
  vars?: TranslateVars
): string {
  const fallback = typeof fallbackOrVars === "string" ? fallbackOrVars : undefined;
  const v = typeof fallbackOrVars === "object" ? fallbackOrVars : vars;
  const native = NATIVE[key];
  const localized =
    locale === "en" ? undefined : (NATIVE_L10N[locale] as Record<string, string>)[key];
  const str =
    lookupMessage(locale, key) ?? localized ?? native?.[locale] ?? native?.en ?? fallback ?? key;
  return interpolate(str, v);
}

function deviceLocale(): LocaleCode {
  try {
    return localeFromNavigator(getLocales()[0]?.languageTag);
  } catch {
    return DEFAULT_LOCALE;
  }
}

function initialLocale(): LocaleCode {
  try {
    const saved = SecureStore.getItem(STORAGE_KEY);
    if (saved && isLocaleCode(saved)) return saved;
  } catch {
    /* keychain unavailable */
  }
  return deviceLocale();
}

export interface LocaleContextValue {
  locale: LocaleCode;
  setLocale: (l: LocaleCode) => void;
  dir: Dir;
  isRtl: boolean;
  t: TFunction;
}

const Ctx = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(initialLocale);

  const setLocale = useCallback((l: LocaleCode) => {
    setLocaleState(l);
    SecureStore.setItemAsync(STORAGE_KEY, l).catch(() => {});
  }, []);

  const t = useCallback<TFunction>(
    (key, fallbackOrVars, vars) => translateNative(locale, key, fallbackOrVars, vars),
    [locale]
  );

  const value = useMemo<LocaleContextValue>(() => {
    const rtl = isRtlLocale(locale);
    return { locale, setLocale, dir: rtl ? "rtl" : "ltr", isRtl: rtl, t };
  }, [locale, setLocale, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  dir: "ltr",
  isRtl: false,
  t: (key, fallbackOrVars, vars) => translateNative(DEFAULT_LOCALE, key, fallbackOrVars, vars),
};

/**
 * Locale state. Outside a provider (e.g. the root ErrorBoundary, which renders
 * above LocaleProvider) it degrades to English instead of throwing.
 */
export function useLocale(): LocaleContextValue {
  return useContext(Ctx) ?? FALLBACK;
}

/** Just the translator. */
export function useT(): TFunction {
  return useLocale().t;
}

/** `writingDirection` for UI text under the current UI locale (web dir="rtl"). */
export const rtlText = (dir: Dir) =>
  dir === "rtl"
    ? ({ writingDirection: "rtl", textAlign: "right" } as const)
    : ({ writingDirection: "ltr" } as const);

/** Row direction that mirrors under an RTL UI locale. */
export const rtlRow = (dir: Dir) =>
  ({ flexDirection: dir === "rtl" ? "row-reverse" : "row" } as const);

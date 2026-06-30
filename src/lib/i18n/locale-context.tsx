"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  isLocaleCode,
  isRtlLocale,
  localeFromNavigator,
  type LocaleCode,
} from "./locales";
import { MESSAGES, type MessageKey } from "./messages";

const STORAGE_KEY = "tarjuman:locale";

interface LocaleContextValue {
  locale: LocaleCode;
  setLocale: (l: LocaleCode) => void;
  dir: "ltr" | "rtl";
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<LocaleContextValue | null>(null);

/**
 * Dashboard UI-language provider. Persists the choice to localStorage, falls
 * back to the browser language, and drives RTL by setting `dir`/`lang` on
 * <html> while mounted (restored on unmount, so the landing — which is outside
 * this provider — stays LTR/English).
 */
export function LocaleProvider({
  children,
  applyDir = true,
}: {
  children: ReactNode;
  /**
   * Set <html dir/lang> while mounted. True for the dashboard (full RTL). The
   * landing passes false: only nav/hero/headings are translated, so flipping
   * the whole marketing layout RTL would right-align the still-English bodies —
   * the translated (pure-script) text renders correctly on its own.
   */
  applyDir?: boolean;
}) {
  const [locale, setLocaleState] = useState<LocaleCode>(DEFAULT_LOCALE);

  // Resolve the initial locale after mount (localStorage/navigator aren't
  // available during SSR — doing this in render would cause a hydration
  // mismatch).
  useEffect(() => {
    let initial: LocaleCode = DEFAULT_LOCALE;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && isLocaleCode(saved)) initial = saved;
      else if (typeof navigator !== "undefined")
        initial = localeFromNavigator(navigator.language);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(initial);
  }, []);

  const setLocale = useCallback((l: LocaleCode) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const dir: "ltr" | "rtl" = isRtlLocale(locale) ? "rtl" : "ltr";

  // Apply dir/lang to <html> only while the dashboard is mounted.
  useEffect(() => {
    if (!applyDir) return;
    const html = document.documentElement;
    const prevDir = html.getAttribute("dir");
    const prevLang = html.getAttribute("lang");
    html.setAttribute("dir", dir);
    html.setAttribute("lang", locale);
    return () => {
      if (prevDir) html.setAttribute("dir", prevDir);
      else html.removeAttribute("dir");
      html.setAttribute("lang", prevLang ?? "en");
    };
  }, [dir, locale, applyDir]);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      const entry = MESSAGES[key] as Record<string, string> | undefined;
      let str = entry?.[locale] ?? entry?.en ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, String(v));
        }
      }
      return str;
    },
    [locale]
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, dir, t }),
    [locale, setLocale, dir, t]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Defensive fallback so a component used outside the provider (e.g. in a
    // test) still renders English rather than throwing.
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      dir: "ltr",
      t: (key) => {
        const entry = MESSAGES[key] as Record<string, string> | undefined;
        return entry?.en ?? key;
      },
    };
  }
  return ctx;
}

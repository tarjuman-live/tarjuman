import type { LocaleCode } from "@shared/i18n/locales";

/**
 * Native-only UI strings (things the web has no MessageKey for). One file per
 * builder under ./strings/<owner>.ts. English is required; other locales are
 * optional and fall back to English.
 *
 * KEY NAMING: prefix every key with its owner, e.g. "record.stopConfirm",
 * "session.renameTitle", "foundation.cancel". Web MessageKeys always win on a
 * name clash, so never reuse a web key here — just call t() with the web key.
 */
export type NativeStringEntry = { en: string } & Partial<Record<LocaleCode, string>>;
export type NativeStrings = Record<string, NativeStringEntry>;

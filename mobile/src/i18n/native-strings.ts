/**
 * All native-only strings, merged (owner files never collide — keys are
 * owner-prefixed). English lives in ./strings/<owner>.ts; every other UI
 * locale lives in ./l10n/<code>.ts, which is typed `Record<NativeKey, string>`
 * so a missing or stale translation is a compile error, not a silent English
 * fallback.
 */
import type { NativeStrings } from "./types";
import { FOUNDATION_STRINGS } from "./strings/foundation";
import { WELCOME_HERO_STRINGS } from "./strings/welcome-hero";
import { WELCOME_SECTIONS_STRINGS } from "./strings/welcome-sections";
import { RECORD_STRINGS } from "./strings/record";
import { TRANSCRIPT_STRINGS } from "./strings/transcript";
import { SESSION_STRINGS } from "./strings/session";
import { PRO_TOOLS_STRINGS } from "./strings/pro-tools";
import { SETTINGS_AUTH_NAV_STRINGS } from "./strings/settings-auth-nav";

const ALL = {
  ...FOUNDATION_STRINGS,
  ...WELCOME_HERO_STRINGS,
  ...WELCOME_SECTIONS_STRINGS,
  ...RECORD_STRINGS,
  ...TRANSCRIPT_STRINGS,
  ...SESSION_STRINGS,
  ...PRO_TOOLS_STRINGS,
  ...SETTINGS_AUTH_NAV_STRINGS,
};

/** Every native-only key (literal union — locale files are checked against it). */
export type NativeKey = keyof typeof ALL;

/** One non-English locale's native strings: exactly the English key set. */
export type NativeLocaleStrings = Record<NativeKey, string>;

export const NATIVE: NativeStrings = ALL;

/**
 * Native-only strings for every UI locale except English (English is the
 * source, in ../strings/<owner>.ts). One file per locale, mirroring the web's
 * messages-extra.ts. Each file satisfies `NativeLocaleStrings`, and this map
 * satisfies "every UI_LOCALES code except en" — so adding a native string, or
 * a UI locale, without translating it fails `tsc`.
 *
 * Machine-quality translations (same bar as the web's EXTRA_LOCALES), pending
 * native review. Islamic terms (khutbah, masjid) follow the web copy.
 */
import type { LocaleCode } from "@shared/i18n/locales";
import type { NativeLocaleStrings } from "../native-strings";
import { AR } from "./ar";
import { UR } from "./ur";
import { FR } from "./fr";
import { ES } from "./es";
import { ID } from "./id";
import { TR } from "./tr";
import { BN } from "./bn";
import { MS } from "./ms";
import { DE } from "./de";
import { PT } from "./pt";
import { IT } from "./it";
import { NL } from "./nl";
import { RU } from "./ru";
import { HI } from "./hi";
import { JA } from "./ja";
import { KO } from "./ko";
import { ZH } from "./zh";
import { VI } from "./vi";
import { PL } from "./pl";
import { CS } from "./cs";
import { HU } from "./hu";
import { NO } from "./no";
import { SV } from "./sv";
import { DA } from "./da";
import { FI } from "./fi";
import { EL } from "./el";
import { HE } from "./he";
import { RO } from "./ro";
import { CA } from "./ca";
import { UK } from "./uk";

export const NATIVE_L10N = {
  ar: AR,
  ur: UR,
  fr: FR,
  es: ES,
  id: ID,
  tr: TR,
  bn: BN,
  ms: MS,
  de: DE,
  pt: PT,
  it: IT,
  nl: NL,
  ru: RU,
  hi: HI,
  ja: JA,
  ko: KO,
  zh: ZH,
  vi: VI,
  pl: PL,
  cs: CS,
  hu: HU,
  no: NO,
  sv: SV,
  da: DA,
  fi: FI,
  el: EL,
  he: HE,
  ro: RO,
  ca: CA,
  uk: UK,
} satisfies Record<Exclude<LocaleCode, "en">, NativeLocaleStrings>;

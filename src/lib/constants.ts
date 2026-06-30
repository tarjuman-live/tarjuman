export const LANGUAGES = [
  // Tier 1 — Excellent (code-switching supported)
  { code: "en", name: "English", native: "English", rtl: false },
  { code: "es", name: "Spanish", native: "Español", rtl: false },
  { code: "fr", name: "French", native: "Français", rtl: false },
  { code: "de", name: "German", native: "Deutsch", rtl: false },
  { code: "pt", name: "Portuguese", native: "Português", rtl: false },
  { code: "it", name: "Italian", native: "Italiano", rtl: false },
  { code: "nl", name: "Dutch", native: "Nederlands", rtl: false },
  { code: "ru", name: "Russian", native: "Русский", rtl: false },
  { code: "hi", name: "Hindi", native: "हिन्दी", rtl: false },
  { code: "ja", name: "Japanese", native: "日本語", rtl: false },

  // Tier 2 — Very good
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "ko", name: "Korean", native: "한국어", rtl: false },
  { code: "zh", name: "Chinese", native: "中文", rtl: false },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt", rtl: false },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", rtl: false },
  { code: "ms", name: "Malay", native: "Bahasa Melayu", rtl: false },
  { code: "tr", name: "Turkish", native: "Türkçe", rtl: false },
  { code: "pl", name: "Polish", native: "Polski", rtl: false },
  { code: "cs", name: "Czech", native: "Čeština", rtl: false },
  { code: "hu", name: "Hungarian", native: "Magyar", rtl: false },
  { code: "no", name: "Norwegian", native: "Norsk", rtl: false },
  { code: "sv", name: "Swedish", native: "Svenska", rtl: false },
  { code: "da", name: "Danish", native: "Dansk", rtl: false },
  { code: "fi", name: "Finnish", native: "Suomi", rtl: false },
  { code: "el", name: "Greek", native: "Ελληνικά", rtl: false },
  { code: "he", name: "Hebrew", native: "עברית", rtl: true },
  { code: "ro", name: "Romanian", native: "Română", rtl: false },
  { code: "ca", name: "Catalan", native: "Català", rtl: false },
  { code: "uk", name: "Ukrainian", native: "Українська", rtl: false },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const COLORS = {
  bg: "#060B18",
  surface: "#0E1525",
  surfaceLight: "#151D30",
  border: "rgba(255,255,255,0.06)",
  borderLight: "rgba(255,255,255,0.1)",
  accent: "#2ECC71",
  accentDk: "#22A85A",
  accentSoft: "rgba(46,204,113,0.1)",
  red: "#EF4444",
  redSoft: "rgba(239,68,68,0.1)",
  amber: "#F59E0B",
  amberSoft: "rgba(245,158,11,0.1)",
  blue: "#3B82F6",
  blueSoft: "rgba(59,130,246,0.1)",
  w: "#F0F4F8",
  t2: "#B0BEC5",
  t3: "#6B7D8D",
  t4: "#455A64",
} as const;

// The landing pricing section + "Pricing" nav link are built but NOT public
// yet. Show them only on localhost (next dev → NODE_ENV "development"); they
// stay hidden on the live domain (Vercel prod build → "production"). Flip to a
// hard `true` to launch pricing to the live site.
export const SHOW_PRICING = process.env.NODE_ENV === "development";

export const SEGMENT_FLUSH_INTERVAL_MS = 5000;
export const DEEPGRAM_KEEPALIVE_INTERVAL_MS = 5000;
export const RECONNECT_BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000] as const;

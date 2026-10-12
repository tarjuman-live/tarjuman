import { useRef, useState, useSyncExternalStore } from "react";
import { Appearance, type ScrollView } from "react-native";
import * as SecureStore from "expo-secure-store";
import { COLORS } from "@shared/constants";

/**
 * Theme — dark (default, the web's palette) or light (opt-in from Settings,
 * user request 2026-10-12).
 *
 * Dark stays the default on purpose: the app is used in masjids and lecture
 * halls, where a bright screen is disruptive (CLAUDE.md "Dark mode by
 * default"). Light is a personal choice, persisted in the Keychain and read
 * SYNCHRONOUSLY before any style is built, so a light launch never flashes
 * dark first.
 *
 * How switching works without rewriting every component:
 *   - `C` is a live ES binding re-pointed at a FRESH palette object on every
 *     switch (never mutated in place: Reanimated freezes, and caches by
 *     identity, any object a worklet captured — an in-place edit would throw
 *     in dev and leave animated colours stale). Every `C.x` compiles to a
 *     member read on the module (`_libTheme.C.x`), so readers see the swap.
 *   - Module-level style sheets are built through `themed(() =>
 *     StyleSheet.create(…))`, which rebuilds lazily the first time they are
 *     read after a switch.
 *   - The root layout crossfades from a snapshot of the old look. Underneath,
 *     the visible screen remounts at once (at rest: no entrance animation,
 *     same scroll — themeJustSwitched / useThemeScrollKeeper) and hidden
 *     screens remount a beat later, out of sight (ThemeRemount), so
 *     everything re-reads `C`. A re-render alone is NOT enough: the React
 *     Compiler caches each component's output, so cached subtrees would keep
 *     the old colours. Navigation state is never touched.
 */

export type ThemeMode = "dark" | "light";
export type Palette = { [K in keyof typeof COLORS]: string } & {
  /** Recessed field (search boxes) inside a tray. */
  inset: string;
  /** Translucent glass panel fill (bottom nav, dialogs, sheets). */
  glass: string;
  /** Backdrop behind dialogs / sheets. */
  scrim: string;
  /** Heavier backdrop (auth popup, tips sheet). */
  scrimStrong: string;
  /** expo-blur tint matching the mode. */
  blurTint: "dark" | "light";
};

// Every value that code suffixes with a hex alpha (`${C.accent}40`) MUST stay
// a 6-digit hex in both palettes: accent, red, amber (see the grep in the
// commit that added light mode).
const DARK: Palette = {
  ...COLORS,
  inset: "rgba(10, 16, 30, 0.7)",
  glass: "rgba(20, 28, 46, 0.6)",
  scrim: "rgba(6, 11, 24, 0.4)",
  scrimStrong: "rgba(6, 11, 24, 0.55)",
  blurTint: "dark",
};

/**
 * Cool off-white + white surfaces, slate text, the brand green deepened to
 * green-600 so it still reads as text on white (#2ECC71 is ~1.9:1 there).
 */
const LIGHT: Palette = {
  bg: "#F4F6FA",
  surface: "#FFFFFF",
  surfaceLight: "#EEF2F7",
  border: "rgba(15, 23, 42, 0.08)",
  borderLight: "rgba(15, 23, 42, 0.13)",
  accent: "#16A34A",
  accentDk: "#15803D",
  accentSoft: "rgba(22, 163, 74, 0.1)",
  red: "#DC2626",
  redSoft: "rgba(220, 38, 38, 0.08)",
  amber: "#D97706",
  amberSoft: "rgba(217, 119, 6, 0.1)",
  blue: "#2563EB",
  blueSoft: "rgba(37, 99, 235, 0.08)",
  w: "#0F172A",
  t2: "#334155",
  t3: "#64748B",
  t4: "#94A3B8",
  inset: "rgba(15, 23, 42, 0.05)",
  glass: "rgba(255, 255, 255, 0.72)",
  scrim: "rgba(15, 23, 42, 0.22)",
  scrimStrong: "rgba(15, 23, 42, 0.32)",
  blurTint: "light",
};

const KEY = "tarjuman.theme";

function readStored(): ThemeMode {
  try {
    return SecureStore.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark"; // keychain unavailable → the default
  }
}

let mode: ThemeMode = readStored();
let version = 0;
let switchedAt = 0;
const listeners = new Set<() => void>();

/** The live palette. Read it at render time (or inside `themed`), never cache it in a module constant. */
// eslint-disable-next-line import/no-mutable-exports -- deliberate live binding (see header)
export let C: Palette = { ...(mode === "light" ? LIGHT : DARK) };

// Native chrome (keyboard, alerts, the stack header's glass) follows too.
if (mode === "light") Appearance.setColorScheme?.("light");

export const getThemeMode = (): ThemeMode => mode;

export function setThemeMode(next: ThemeMode): void {
  if (next === mode) return;
  mode = next;
  C = { ...(next === "light" ? LIGHT : DARK) };
  version++;
  switchedAt = Date.now();
  SecureStore.setItemAsync(KEY, next).catch(() => {});
  Appearance.setColorScheme?.(next);
  for (const l of listeners) l();
}

/**
 * Settings calls this; the root layout registers the handler that runs the
 * switch as a snapshot crossfade (ThemeCrossfade in app/_layout.tsx). Without a handler
 * (or under Reduce Motion) it switches instantly.
 */
type SwitchHandler = (next: ThemeMode) => void;
let switchHandler: SwitchHandler | null = null;
let prepareHandler: (() => void) | null = null;

export function registerThemeSwitcher(h: SwitchHandler, prepare?: () => void): () => void {
  switchHandler = h;
  prepareHandler = prepare ?? null;
  return () => {
    if (switchHandler === h) {
      switchHandler = null;
      prepareHandler = null;
    }
  };
}

/** Call on press-IN of a theme option: lets the transition get ready early. */
export function prepareThemeSwitch(): void {
  prepareHandler?.();
}

export function requestThemeMode(next: ThemeMode): void {
  if (next === mode) return;
  if (switchHandler) switchHandler(next);
  else setThemeMode(next);
}

/**
 * True for a moment after a switch. Screens remounted by the switch use it to
 * mount already at rest (no entrance fade, same scroll position) — under the
 * crossfade they must look exactly like the screen they replace.
 */
export const themeJustSwitched = (): boolean => switchedAt > 0 && Date.now() - switchedAt < 1500;

const scrollMemo = new Map<string, number>();

/**
 * Keeps a ScrollView's offset across a theme remount:
 *   <ScrollView {...useThemeScrollKeeper("settings")} …>
 * A normal mount starts at the top; one caused by a switch starts where the
 * old instance was.
 */
export function useThemeScrollKeeper(id: string) {
  const [y] = useState(() => (themeJustSwitched() ? (scrollMemo.get(id) ?? 0) : 0));
  const ref = useRef<ScrollView | null>(null);
  const pending = useRef(y > 0);
  return {
    ref,
    contentOffset: { x: 0, y },
    scrollEventThrottle: 16,
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      scrollMemo.set(id, e.nativeEvent.contentOffset.y);
    },
    // contentOffset alone is clamped to 0 if the content isn't laid out yet
    // at mount; re-apply it once the content has a size.
    onContentSizeChange: (_w: number, h: number) => {
      if (!pending.current || h <= y) return;
      pending.current = false;
      ref.current?.scrollTo({ y, animated: false });
    },
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Re-renders on every theme switch; the number keys remounts. */
export function useThemeVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, () => mode, () => mode);
}

/**
 * Light mode keeps the dark design's depth (trays, raised tiles) but its
 * black drop shadows were tuned for a near-black page: on white they read as
 * smudges. Scale every black shadow's alpha down; leave coloured glows alone.
 */
function soften(shadow: string): string {
  return shadow.replace(/rgba\(0,\s*0,\s*0,\s*(0?\.\d+|1)\)/g, (_m, a: string) => {
    const v = Math.round(parseFloat(a) * 0.35 * 1000) / 1000;
    return `rgba(0, 0, 0, ${v})`;
  });
}

function lighten<T>(sheet: T): T {
  if (mode !== "light" || !sheet || typeof sheet !== "object") return sheet;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sheet as Record<string, unknown>)) {
    if (v && typeof v === "object" && typeof (v as { boxShadow?: unknown }).boxShadow === "string") {
      out[k] = { ...(v as object), boxShadow: soften((v as { boxShadow: string }).boxShadow) };
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * A module-level style sheet that follows the theme:
 *
 *   const styles = themed(() => StyleSheet.create({ card: { backgroundColor: C.surface } }));
 *
 * Built lazily on first read and rebuilt on the first read after a switch.
 */
export function themed<T extends object>(factory: () => T): T {
  let cache: T | null = null;
  let builtAt = -1;
  const current = () => {
    if (!cache || builtAt !== version) {
      cache = lighten(factory());
      builtAt = version;
    }
    return cache;
  };
  return new Proxy({} as T, {
    get: (_t, prop) => (current() as Record<string | symbol, unknown>)[prop],
    has: (_t, prop) => prop in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_t, prop) => {
      const d = Object.getOwnPropertyDescriptor(current(), prop);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

/** Soften an inline (non-sheet) shadow string the same way sheets are. */
export const themedShadow = (shadow: string): string => (mode === "light" ? soften(shadow) : shadow);

export const RADIUS = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

/** Transcript text must read at arm's length in a lecture hall. */
export const TRANSCRIPT_FONT = 19;

import { useWindowDimensions } from "react-native";

/**
 * True on an iPad-sized window in either orientation (iPad mini's short side
 * is 744pt). Components switch to their `large` sizing here: phone-sized type
 * and controls read as tiny on a 13" screen. A narrow Split View / Slide Over
 * window falls back to the phone sizing, which is what it is laid out for.
 */
export function useTablet(): boolean {
  const { width, height } = useWindowDimensions();
  return Math.min(width, height) >= 700;
}

/**
 * iPad sidebar gutter: the island sits exactly this far inside the safe area
 * on EVERY edge (top under the status bar, side, bottom above the home
 * indicator) — one number, so the margins match (user: "make sure the
 * dimensions are right and accurate", 2026-10-13).
 */
export const TABLET_GUTTER = 16;

/**
 * iPad top line: every tab's first content block starts level with the
 * sidebar island's top edge.
 */
export const TABLET_TOP = TABLET_GUTTER;

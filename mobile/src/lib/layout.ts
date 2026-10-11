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

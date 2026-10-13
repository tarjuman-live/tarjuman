/**
 * iPad: a session shown BESIDE the sidebar (design approved 2026-10-11).
 * Opened from the sidebar's Recent rows and from History when the rail is up;
 * phones keep the full-screen push (app/session/[id].tsx). Keyed so
 * switching sessions (or modes) remounts instead of patching it.
 */
import { useLocalSearchParams } from "expo-router";
import { SessionDetail } from "../../session/[id]";

export default function EmbeddedSession() {
  const { id, completed } = useLocalSearchParams<{ id: string; completed?: string }>();
  // Keyed by id AND mode: the same session can come back here as "Session
  // complete" (after Stop) and later as a plain detail view. Reusing the
  // instance across that switch kept the Done button's animated green fill
  // on the view that became "Share .md".
  return <SessionDetail key={`${id}:${completed === "1" ? "done" : "view"}`} embedded />;
}

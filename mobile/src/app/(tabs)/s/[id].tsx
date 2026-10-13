/**
 * iPad: a session shown BESIDE the sidebar (design approved 2026-10-11).
 * Opened from the sidebar's Recent rows and from History when the rail is up;
 * phones keep the full-screen push (app/session/[id].tsx). Keyed by id so
 * switching sessions replays the screen's enter instead of patching it.
 */
import { useLocalSearchParams } from "expo-router";
import { SessionDetail } from "../../session/[id]";

export default function EmbeddedSession() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SessionDetail key={id} embedded />;
}

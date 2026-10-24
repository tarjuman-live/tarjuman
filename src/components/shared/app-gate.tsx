import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

/**
 * Branded full-screen gate shown while auth (or a post-sign-in redirect)
 * resolves — gentle pulse, not a bare spinner, so the app reads as "loading"
 * on-brand. Shared by the (app) auth guard and /start so the hand-off between
 * them is seamless.
 */
export function AppGate() {
  return (
    <div
      className="w-full mx-auto relative overflow-hidden flex flex-col items-center justify-center"
      style={{
        maxWidth: 420,
        minHeight: "100dvh",
        background: COLORS.bg,
      }}
    >
      <div
        className="w-12 h-12 rounded-2xl grid place-items-center animate-pulse"
        style={{
          background: COLORS.accent,
          boxShadow: `0 0 30px ${COLORS.accent}40`,
        }}
      >
        <Icon name="mic" size={22} color="#0A0F1C" />
      </div>
    </div>
  );
}

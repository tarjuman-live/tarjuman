"use client";

import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

interface MicErrorStateProps {
  permissionDenied: boolean;
  unavailable: boolean;
  message: string | null;
  onRetry: () => void;
}

export function MicErrorState({
  permissionDenied,
  unavailable,
  message,
  onRetry,
}: MicErrorStateProps) {
  const title = unavailable
    ? "Microphone not available"
    : permissionDenied
      ? "Microphone access denied"
      : "Couldn't start recording";

  const body = unavailable
    ? "This device or browser doesn't expose a microphone we can use. Try opening Tarjuman in Safari, Chrome, or Firefox on a device with a mic."
    : permissionDenied
      ? "Tarjuman needs microphone access to transcribe audio. Open your browser's site settings, allow the microphone for this site, then tap Try Again."
      : message || "Something went wrong. Please try again.";

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 text-center">
      <div
        className="w-16 h-16 rounded-2xl grid place-items-center"
        style={{
          background: COLORS.redSoft,
          border: `1px solid ${COLORS.red}30`,
        }}
      >
        <Icon name="mic" size={28} color={COLORS.red} />
      </div>
      <div>
        <div
          className="text-lg font-bold mb-2"
          style={{ color: COLORS.w }}
        >
          {title}
        </div>
        <div
          className="text-sm leading-relaxed"
          style={{ color: COLORS.t2 }}
        >
          {body}
        </div>
      </div>
      {!unavailable && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 px-5 py-3 rounded-xl font-bold text-sm transition-transform active:scale-95"
          style={{
            background: COLORS.accent,
            color: "#0A0F1C",
            boxShadow: `0 0 24px ${COLORS.accent}35`,
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

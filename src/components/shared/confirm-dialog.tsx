"use client";

import { useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { COLORS } from "@/lib/constants";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  /** Pass `null` to hide the cancel button (alert-style single-action dialog). */
  cancelLabel?: string | null;
  /** When true, the confirm button is rendered in destructive red. */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * In-app confirm modal that mirrors the dark-theme pattern from
 * `positioning-tips.tsx`. Used in place of `window.confirm` / `window.alert`
 * so destructive actions match the rest of the app's visual language.
 *
 * Built on Radix's AlertDialog primitive (focus trap, escape-to-close,
 * accessibility semantics) — `cancelLabel: null` collapses to a single OK
 * button for alert-style flows.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      // Surface the failure inline and keep the dialog open, instead of
      // silently reverting the button (which reads as a no-op) and leaking an
      // unhandled promise rejection.
      setError(
        e instanceof Error ? e.message : "Something went wrong. Try again."
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmBg = destructive ? COLORS.red : COLORS.accent;
  const confirmFg = destructive ? COLORS.w : "#0A0F1C";

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className="fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{
            // Light dim only — leave the heavy blur to the card so the
            // card's backdrop-filter has interesting content to refract.
            background: "rgba(6, 11, 24, 0.4)",
          }}
        />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-[calc(100%-32px)] max-w-[420px] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-150"
          style={{
            // Liquid glass: translucent tint over a heavy frosted backdrop.
            background: "rgba(20, 28, 46, 0.6)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            borderRadius: 24,
            border: "1px solid rgba(255, 255, 255, 0.1)",
            boxShadow:
              "0 24px 60px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.25)",
            padding: 24,
          }}
        >
          <AlertDialog.Title
            className="text-[16px] font-bold mb-2"
            style={{ color: COLORS.w }}
          >
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description
            className="text-[13px] leading-relaxed mb-5"
            style={{ color: COLORS.t2 }}
          >
            {message}
          </AlertDialog.Description>

          {error && (
            <div
              className="text-[12px] mb-4 px-3 py-2 rounded-lg"
              role="alert"
              style={{ color: COLORS.red, background: `${COLORS.red}14` }}
            >
              {error}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            {cancelLabel !== null && (
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  className="h-10 px-4 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors"
                  style={{
                    background: "transparent",
                    border: `1px solid ${COLORS.borderLight}`,
                    color: COLORS.t2,
                  }}
                >
                  {cancelLabel}
                </button>
              </AlertDialog.Cancel>
            )}
            <AlertDialog.Action asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirm();
                }}
                disabled={busy}
                className="h-10 px-4 rounded-lg text-[13px] font-bold cursor-pointer transition-transform active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait"
                style={{
                  background: confirmBg,
                  color: confirmFg,
                }}
              >
                {busy ? "Working…" : confirmLabel}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

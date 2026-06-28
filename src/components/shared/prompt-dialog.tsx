"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { COLORS } from "@/lib/constants";

export interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  saveLabel?: string;
  cancelLabel?: string;
  maxLength?: number;
  /** Called with the trimmed value when the user confirms. */
  onSave: (value: string) => void | Promise<void>;
}

/**
 * In-app text-input modal that mirrors the dark-theme pattern from
 * `positioning-tips.tsx`. Used in place of `window.prompt` so rename and
 * other text-entry flows match the rest of the app.
 *
 * Auto-focuses the input on open. Enter submits, Escape cancels (Radix
 * handles Escape via its own keyboard handler).
 */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  defaultValue = "",
  saveLabel = "Save",
  cancelLabel = "Cancel",
  maxLength = 120,
  onSave,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Re-seed the input each time the dialog opens so reusing the same
  // component for a different row doesn't show stale text.
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      // Defer focus until after Radix mounts the content node.
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    }
  }, [open, defaultValue]);

  const handleSave = async () => {
    if (busy) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed);
      onOpenChange(false);
    } catch (e) {
      // Surface the failure inline + keep the dialog open, instead of silently
      // reverting the button and leaking an unhandled promise rejection.
      setError(
        e instanceof Error ? e.message : "Something went wrong. Try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{
            // Light dim only — leave the heavy blur to the card so the
            // card's backdrop-filter has interesting content to refract.
            background: "rgba(6, 11, 24, 0.4)",
          }}
        />
        <Dialog.Content
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
          <Dialog.Title
            className="text-[16px] font-bold mb-3"
            style={{ color: COLORS.w }}
          >
            {title}
          </Dialog.Title>
          {label && (
            <Dialog.Description
              className="text-[12px] mb-2"
              style={{ color: COLORS.t3 }}
            >
              {label}
            </Dialog.Description>
          )}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSave();
              }
            }}
            placeholder={placeholder}
            maxLength={maxLength}
            className="w-full h-10 px-3 rounded-lg text-[14px] outline-none transition-colors mb-5"
            style={{
              // Toned down against the glass card — slightly translucent so
              // it still feels like part of the same material, but solid
              // enough to read as the interactive surface.
              background: "rgba(10, 16, 30, 0.7)",
              border: `1px solid ${COLORS.borderLight}`,
              color: COLORS.w,
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = COLORS.accent;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = COLORS.borderLight;
            }}
          />

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
            <Dialog.Close asChild>
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
            </Dialog.Close>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !value.trim()}
              className="h-10 px-4 rounded-lg text-[13px] font-bold cursor-pointer transition-transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: COLORS.accent,
                color: "#0A0F1C",
              }}
            >
              {busy ? "Saving…" : saveLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

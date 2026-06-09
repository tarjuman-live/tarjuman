"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AuthForm } from "./auth-form";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: "signIn" | "signUp";
}

/**
 * Sign-in / sign-up as a centered liquid-glass popup, reusing AuthForm. Same
 * material as the prompt/confirm dialogs. The mode toggles in place via
 * AuthForm's `onSwitchMode`, so the popup flips between sign in / sign up
 * without a page change. On success AuthForm routes to /record, which dismisses
 * the modal along with the landing page.
 */
export function AuthModal({
  open,
  onOpenChange,
  initialMode = "signUp",
}: AuthModalProps) {
  const [mode, setMode] = useState<"signIn" | "signUp">(initialMode);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{
            // Dim + heavy blur so the page behind the popup fully recedes.
            background: "rgba(6, 11, 24, 0.55)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
          }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-[calc(100%-32px)] max-w-[420px] max-h-[90dvh] overflow-auto outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-150"
          style={{
            // Liquid glass: translucent tint over a heavy frosted backdrop.
            background: "rgba(20, 28, 46, 0.6)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            borderRadius: 24,
            // Longhand border (not the shorthand) to avoid React shorthand/
            // longhand rerender warnings.
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "rgba(255, 255, 255, 0.1)",
            boxShadow:
              "0 24px 60px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.25)",
          }}
        >
          {/* Visually-hidden title for Radix a11y; AuthForm shows its own heading. */}
          <Dialog.Title className="sr-only">
            {mode === "signUp" ? "Create your account" : "Sign in"}
          </Dialog.Title>
          <AuthForm mode={mode} onSwitchMode={setMode} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

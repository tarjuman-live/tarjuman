"use client";

import { useCallback, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useLenis } from "lenis/react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { useLocale } from "@/lib/i18n/locale-context";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface WaitlistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Join the waitlist" popup — the landing's pre-launch CTA. Same liquid-glass
 * material as AuthModal. Email → `waitlist.join` (public, deduped); joining
 * twice shows the same confirmation, so it never reveals who's on the list.
 */
export function WaitlistModal({ open, onOpenChange }: WaitlistModalProps) {
  const { t, locale } = useLocale();
  const join = useMutation(api.waitlist.join);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Parked while open — same Lenis/Radix wheel-handler reasoning as AuthModal.
  const lenis = useLenis();

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) lenis?.stop();
      else lenis?.start();
      onOpenChange(next);
    },
    [lenis, onOpenChange],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError(t("lp.waitlistInvalid"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await join({ email: value, locale });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ConvexError && err.data === "invalid_email"
          ? t("lp.waitlistInvalid")
          : t("lp.waitlistError"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{
            background: "rgba(6, 11, 24, 0.55)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
          }}
        />
        <Dialog.Content
          data-lenis-prevent
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-[calc(100%-32px)] max-w-[420px] max-h-[90dvh] overflow-auto outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-150"
          style={{
            background: "rgba(20, 28, 46, 0.6)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            borderRadius: 24,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "rgba(255, 255, 255, 0.1)",
            boxShadow:
              "0 24px 60px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.25)",
          }}
        >
          <Dialog.Close
            aria-label="Close"
            className="absolute top-4 end-4 w-8 h-8 rounded-full grid place-items-center cursor-pointer transition-colors hover:bg-white/10"
          >
            <Icon name="close" size={14} color={COLORS.t3} />
          </Dialog.Close>

          {/* Fixed min-height so the form → "You're on the list" swap only
              cross-fades the content; the card itself doesn't snap shorter. */}
          <div className="px-6 pt-9 pb-7 min-h-[356px] flex flex-col items-center justify-center text-center">
            {done ? (
              <div
                key="done"
                className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none"
              >
                <span
                  className="w-14 h-14 rounded-2xl grid place-items-center"
                  style={{
                    background: COLORS.accentSoft,
                    border: `1px solid ${COLORS.accent}40`,
                  }}
                >
                  <Icon name="check" size={26} color={COLORS.accent} />
                </span>
                <Dialog.Title
                  className="mt-5 text-[22px] font-bold leading-tight"
                  style={{ color: COLORS.w }}
                >
                  {t("lp.waitlistDoneTitle")}
                </Dialog.Title>
                <Dialog.Description
                  className="mt-2 text-[14px] leading-relaxed"
                  style={{ color: COLORS.t2 }}
                >
                  {t("lp.waitlistDoneBody")}
                </Dialog.Description>
              </div>
            ) : (
              <>
                <span
                  className="w-14 h-14 rounded-2xl grid place-items-center shadow-[0_0_24px_rgba(46,204,113,0.4)]"
                  style={{ background: COLORS.accent }}
                >
                  <Icon name="mic" size={24} color="#0A0F1C" />
                </span>
                <Dialog.Title
                  className="mt-5 text-[22px] font-bold leading-tight"
                  style={{ color: COLORS.w }}
                >
                  {t("lp.joinWaitlist")}
                </Dialog.Title>
                <Dialog.Description
                  className="mt-2 text-[14px] leading-relaxed"
                  style={{ color: COLORS.t2 }}
                >
                  {t("lp.waitlistBody")}
                </Dialog.Description>

                <form onSubmit={submit} noValidate className="w-full mt-6 flex flex-col gap-3">
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="you@example.com"
                    aria-label={t("lp.waitlistEmail")}
                    aria-invalid={error ? true : undefined}
                    dir="ltr"
                    className="w-full h-12 px-4 rounded-xl text-[15px] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--color-text-4)] focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_rgba(46,204,113,0.18)]"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: `1px solid ${error ? COLORS.red : "rgba(255,255,255,0.12)"}`,
                      color: COLORS.w,
                    }}
                  />
                  {error && (
                    <p
                      role="alert"
                      className="text-[12.5px] text-start animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
                      style={{ color: COLORS.red }}
                    >
                      {error}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="h-12 rounded-xl text-[15px] font-bold cursor-pointer transition-all duration-200 active:scale-[0.98] bg-[var(--color-accent)] text-[#0A0F1C] hover:brightness-110 shadow-[0_0_20px_rgba(46,204,113,0.3)] hover:shadow-[0_0_30px_rgba(46,204,113,0.6)] disabled:opacity-60 disabled:cursor-default"
                  >
                    {submitting ? "…" : t("lp.joinWaitlist")}
                  </button>
                </form>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

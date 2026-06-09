"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

const ACK_KEY = "livetranscribe:positioning-tips-ack";

interface PositioningTipsProps {
  /**
   * Force the tips open even after they've been acknowledged. Used when the
   * user explicitly taps a "How to record" button later.
   */
  forceOpen?: boolean;
  onClose?: () => void;
}

/**
 * Onboarding overlay shown before the first recording. The masjid use case
 * (phone capturing PA-speaker audio in a reverberant room) lives or dies by
 * mic positioning, so we want every first-time user to see this advice once.
 *
 * Acknowledgement is tracked in localStorage. The user can re-open the tips
 * from the idle screen via the tips button.
 */
export function PositioningTips({
  forceOpen = false,
  onClose,
}: PositioningTipsProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      return;
    }
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(ACK_KEY)) {
      setOpen(true);
    }
  }, [forceOpen]);

  const handleClose = (next: boolean) => {
    if (!next) {
      try {
        localStorage.setItem(ACK_KEY, "1");
      } catch {
        /* private mode */
      }
      onClose?.();
    }
    setOpen(next);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{
            // Light dim only — leave the heavy blur to the sheet so the
            // sheet's backdrop-filter has interesting content to refract.
            background: "rgba(6, 11, 24, 0.4)",
          }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-[calc(100%-32px)] max-w-[440px] max-h-[85vh] overflow-auto outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200 ease-out"
          style={{
            // Liquid glass: translucent tint over a heavy frosted backdrop.
            background: "rgba(20, 28, 46, 0.6)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            borderRadius: 24,
            border: "1px solid rgba(255, 255, 255, 0.1)",
            // Centered bubble: all-around drop shadow with top catch-light and
            // bottom shade for glass depth (matches PromptDialog/ConfirmDialog).
            boxShadow:
              "0 24px 60px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.25)",
          }}
        >
          <div className="p-6">
            <div
              className="w-12 h-12 rounded-2xl grid place-items-center mb-4"
              style={{
                background: COLORS.accentSoft,
                border: `1px solid ${COLORS.accent}30`,
              }}
            >
              <Icon name="mic" size={22} color={COLORS.accent} />
            </div>
            <Dialog.Title
              className="text-lg font-bold mb-1"
              style={{ color: COLORS.w }}
            >
              For best results
            </Dialog.Title>
            <Dialog.Description
              className="text-[13px] leading-relaxed mb-4"
              style={{ color: COLORS.t3 }}
            >
              Tarjuman captures audio from speakers in halls and masjids
              — a few seconds of setup makes a big difference.
            </Dialog.Description>

            <ul className="flex flex-col gap-3 mb-5">
              {TIPS.map((tip) => (
                <li key={tip.title} className="flex gap-3">
                  <div
                    className="w-7 h-7 rounded-lg grid place-items-center flex-shrink-0 mt-[2px]"
                    style={{
                      background: COLORS.surfaceLight,
                      border: `1px solid ${COLORS.borderLight}`,
                    }}
                  >
                    <span
                      className="text-[13px] font-bold"
                      style={{ color: COLORS.accent }}
                    >
                      {tip.icon}
                    </span>
                  </div>
                  <div className="flex-1">
                    <div
                      className="text-[14px] font-semibold mb-[2px]"
                      style={{ color: COLORS.w }}
                    >
                      {tip.title}
                    </div>
                    <div
                      className="text-[12px] leading-[1.5]"
                      style={{ color: COLORS.t3 }}
                    >
                      {tip.body}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div
              className="px-3 py-2 rounded-lg text-[12px] mb-4 flex items-start gap-2"
              style={{
                background: COLORS.amberSoft,
                border: `1px solid ${COLORS.amber}40`,
                color: COLORS.t2,
              }}
            >
              <span aria-hidden style={{ color: COLORS.amber }}>
                ●
              </span>
              <span>
                Watch the audio meter while recording. If it stays low for more
                than a couple of seconds, move closer to the speaker.
              </span>
            </div>

            <button
              type="button"
              onClick={() => handleClose(false)}
              className="w-full h-12 rounded-xl font-bold text-sm cursor-pointer transition-transform active:scale-[0.98]"
              style={{
                background: COLORS.accent,
                color: "#0A0F1C",
                boxShadow: `0 0 24px ${COLORS.accent}35`,
              }}
            >
              Got it
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const TIPS: { icon: string; title: string; body: string }[] = [
  {
    icon: "1",
    title: "Get close to the speaker",
    body: "1–2 metres is ideal. The further away, the more the room itself ends up in the recording.",
  },
  {
    icon: "2",
    title: "Point the bottom of your phone at the sound",
    body: "Most mics are at the bottom edge. Aiming them at the source picks up speech more clearly.",
  },
  {
    icon: "3",
    title: "Don't cover the mic",
    body: "A hand or a thick case over the bottom edge muffles everything.",
  },
  {
    icon: "4",
    title: "Quieter rooms = better transcripts",
    body: "Crowd noise, AC hum, and echo all reduce accuracy. We filter what we can — the rest is physics.",
  },
];

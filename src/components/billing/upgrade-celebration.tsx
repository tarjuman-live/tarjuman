"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { PLAN_META, type Plan } from "../../../convex/billingLimits";

/**
 * "You just unlocked…" celebration shown once, right after a successful upgrade
 * (see UpgradeWatcher). Same liquid-glass sheet as the positioning tips, listing
 * everything the new tier unlocks (straight from PLAN_META so it never drifts).
 */
export function UpgradeCelebration({
  open,
  plan,
  onClose,
}: {
  open: boolean;
  plan: Plan;
  onClose: () => void;
}) {
  const meta = PLAN_META[plan];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{ background: "rgba(6, 11, 24, 0.4)" }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-[calc(100%-32px)] max-w-[440px] max-h-[85vh] overflow-auto outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200 ease-out"
          style={{
            background: "rgba(20, 28, 46, 0.6)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            borderRadius: 24,
            border: "1px solid rgba(255, 255, 255, 0.1)",
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
                boxShadow: `0 0 28px ${COLORS.accent}30`,
              }}
            >
              <Icon name="sparkle" size={22} color={COLORS.accent} />
            </div>
            <Dialog.Title
              className="text-lg font-bold mb-1"
              style={{ color: COLORS.w }}
            >
              You&apos;re on Tarjuman {meta.name} 🎉
            </Dialog.Title>
            <p
              className="text-[13px] leading-relaxed mb-4"
              style={{ color: COLORS.t3 }}
            >
              Here&apos;s everything you just unlocked.
            </p>

            <ul className="flex flex-col gap-2.5 mb-5">
              {meta.highlights.map((h) => (
                <li key={h} className="flex items-center gap-3">
                  <div
                    className="w-6 h-6 rounded-lg grid place-items-center flex-shrink-0"
                    style={{
                      background: COLORS.accentSoft,
                      border: `1px solid ${COLORS.accent}30`,
                    }}
                  >
                    <Icon name="check" size={13} color={COLORS.accent} />
                  </div>
                  <span
                    className="text-[14px] font-medium"
                    style={{ color: COLORS.w }}
                  >
                    {h}
                  </span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={onClose}
              className="w-full h-12 rounded-xl font-bold text-sm cursor-pointer transition-transform active:scale-[0.98]"
              style={{
                background: COLORS.accent,
                color: "#0A0F1C",
                boxShadow: `0 0 24px ${COLORS.accent}35`,
              }}
            >
              Let&apos;s go
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

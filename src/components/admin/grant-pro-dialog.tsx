"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COLORS } from "@/lib/constants";
import { useNow } from "./admin-context";
import { errorMessage, fullDate } from "./format";
import { Notice, PrimaryButton, Segmented } from "./ui";

type Preset = "1m" | "3m" | "1y" | "none";

const PRESETS: { value: Preset; label: string; days: number | null }[] = [
  { value: "1m", label: "1 month", days: 30 },
  { value: "3m", label: "3 months", days: 90 },
  { value: "1y", label: "1 year", days: 365 },
  { value: "none", label: "No expiry", days: null },
];

const DAY_MS = 86_400_000;
/** Mirrors the server's `note.slice(0, 500)` in adminPanel.grantPro. */
const NOTE_MAX = 500;

export interface GrantProDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: Id<"users">;
  /** Email or name — shown so the operator can see who they're comping. */
  userLabel: string;
  /** An active comp exists → this grant supersedes (revokes) it server-side. */
  hasActiveComp: boolean;
  billingEnabled: boolean;
}

/**
 * Grant complimentary Pro (planGrants row). Glass card + animate-in/out like
 * ConfirmDialog/PromptDialog. The form lives in a child of Dialog.Content, so
 * Radix unmounting the content after its exit animation is what resets the
 * preset/note/error for the next open — no reset-in-effect needed.
 */
export function GrantProDialog(props: GrantProDialogProps) {
  const { open, onOpenChange } = props;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-200 motion-reduce:animate-none!"
          style={{ background: "rgba(6, 11, 24, 0.4)" }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-[calc(100%-32px)] max-w-[440px] max-h-[calc(100dvh-32px)] overflow-y-auto outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200 motion-reduce:animate-none!"
          style={{
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
          <GrantForm {...props} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function GrantForm({
  onOpenChange,
  userId,
  userLabel,
  hasActiveComp,
  billingEnabled,
}: GrantProDialogProps) {
  const grantPro = useMutation(api.adminPanel.grantPro);
  // Display-only clock for the "until …" preview (never Date.now() in render).
  const now = useNow();
  const [preset, setPreset] = useState<Preset>("1m");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = PRESETS.find((p) => p.value === preset)?.days ?? null;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Computed at submit time, not render time.
      const expiresAt = days === null ? undefined : Date.now() + days * DAY_MS;
      const trimmed = note.trim();
      await grantPro({
        userId,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(trimmed ? { note: trimmed } : {}),
      });
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, "Couldn't grant Pro. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Dialog.Title className="text-[16px] font-bold mb-1.5" style={{ color: COLORS.w }}>
        {hasActiveComp ? "Extend / replace comp" : "Grant complimentary Pro"}
      </Dialog.Title>
      <Dialog.Description
        className="text-[13px] leading-relaxed mb-5 break-words"
        style={{ color: COLORS.t2 }}
      >
        Pro for <span style={{ color: COLORS.w }}>{userLabel}</span>
        {hasActiveComp
          ? ". This replaces the active comp — it's marked revoked and the new one starts now."
          : ", on the house. Logged to the admin audit trail."}
      </Dialog.Description>

      <div className="section-label mb-2">Duration</div>
      {/* Tighter button padding on narrow phones so four presets fit one row. */}
      <div className="[&>div]:w-full [&_button]:px-1.5 sm:[&_button]:px-3 [&_button]:truncate">
        <Segmented
          ariaLabel="Comp duration"
          options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
          value={preset}
          onChange={setPreset}
        />
      </div>
      <p
        key={preset}
        className="text-[12px] mt-2 tabular-nums animate-in fade-in duration-200 motion-reduce:animate-none"
        style={{ color: COLORS.t3 }}
      >
        {days === null
          ? "Pro until you revoke it."
          : `Pro until about ${fullDate(now + days * DAY_MS)}, then back to Free automatically.`}
      </p>

      <div className="flex items-baseline justify-between mt-5 mb-2">
        <label htmlFor="grant-pro-note" className="section-label">
          Note (optional)
        </label>
        <span className="text-[11px] tabular-nums" style={{ color: COLORS.t4 }}>
          {note.length}/{NOTE_MAX}
        </span>
      </div>
      <textarea
        id="grant-pro-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={NOTE_MAX}
        rows={3}
        placeholder="Why? e.g. field tester, partner masjid"
        className="w-full px-3 py-2.5 rounded-lg text-[13.5px] leading-snug outline-none resize-none transition-colors duration-200"
        style={{
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

      {!billingEnabled && (
        <div className="mt-4">
          <Notice tone="blue">
            Billing is OFF, so a comp currently only changes the Pro badge +
            celebration on web and unlocks the AI tools card on iOS.
          </Notice>
        </div>
      )}

      {error && (
        <div
          className="text-[12px] mt-4 px-3 py-2 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
          role="alert"
          style={{ color: COLORS.red, background: `${COLORS.red}14` }}
        >
          {error}
        </div>
      )}

      <div className="flex gap-2 justify-end mt-5">
        <Dialog.Close asChild>
          <button
            type="button"
            className="h-10 px-4 rounded-xl text-[13px] font-semibold cursor-pointer transition-colors duration-200 hover:bg-white/[0.04]"
            style={{
              background: "transparent",
              border: `1px solid ${COLORS.borderLight}`,
              color: COLORS.t2,
            }}
          >
            Cancel
          </button>
        </Dialog.Close>
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Granting…" : hasActiveComp ? "Replace comp" : "Grant Pro"}
        </PrimaryButton>
      </div>
    </form>
  );
}

"use client";

import { useRef, useState, type RefObject } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COLORS } from "@/lib/constants";
import { errorMessage } from "./format";
import { PrimaryButton } from "./ui";

export interface DeleteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: Id<"users">;
  /** The confirmation token. Null → the operator types the user id instead. */
  email: string | null;
  /** Called after the server confirms the delete (before the dialog closes). */
  onDeleted: () => void;
}

/**
 * Typed-confirmation delete. An AlertDialog (no outside-click dismiss) because
 * this is irreversible. The submit stays disabled until the typed text matches
 * the user's email — the same trimmed, case-insensitive rule deleteUser
 * enforces server-side, so the button never enables for a value the server
 * would reject on mismatch.
 */
export function DeleteUserDialog(props: DeleteUserDialogProps) {
  const { open, onOpenChange } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className="fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-200 motion-reduce:animate-none!"
          style={{ background: "rgba(6, 11, 24, 0.4)" }}
        />
        <AlertDialog.Content
          // Focus the confirmation field instead of Radix's default (Cancel).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
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
          {/* Child of Content → unmounts after the exit animation, so the
              typed text / error reset on every open. */}
          <DeleteForm {...props} inputRef={inputRef} />
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function DeleteForm({
  onOpenChange,
  userId,
  email,
  onDeleted,
  inputRef,
}: DeleteUserDialogProps & { inputRef: RefObject<HTMLInputElement | null> }) {
  const deleteUser = useMutation(api.adminPanel.deleteUser);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = email ?? userId;
  const matches = typed.trim().toLowerCase() === token.trim().toLowerCase();

  const submit = async () => {
    if (busy || !matches) return;
    setBusy(true);
    setError(null);
    try {
      await deleteUser({ userId, confirmEmail: typed.trim() });
      onDeleted();
      onOpenChange(false);
    } catch (e) {
      // e.g. "This user has a live Stripe subscription — cancel it in Stripe first."
      setError(errorMessage(e, "Couldn't delete this user. Try again."));
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
      <AlertDialog.Title className="text-[16px] font-bold mb-2" style={{ color: COLORS.w }}>
        Delete this user?
      </AlertDialog.Title>
      <AlertDialog.Description
        className="text-[13px] leading-relaxed mb-4"
        style={{ color: COLORS.t2 }}
      >
        Permanently deletes the account, every session and transcript (purged in
        the background), and its billing and sign-in records.{" "}
        <span style={{ color: COLORS.w }}>This cannot be undone.</span>
      </AlertDialog.Description>

      <label
        htmlFor="delete-user-confirm"
        className="block text-[12px] mb-2 leading-snug"
        style={{ color: COLORS.t3 }}
      >
        Type{" "}
        <span
          className="font-mono select-all px-1.5 py-0.5 rounded-md break-all"
          style={{ color: COLORS.w, background: "rgba(255,255,255,0.06)" }}
        >
          {token}
        </span>{" "}
        to confirm.
      </label>
      <input
        ref={inputRef}
        id="delete-user-confirm"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={email ? "user@example.com" : "user id"}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-full h-10 px-3 rounded-lg text-[14px] outline-none"
        style={{
          background: "rgba(10, 16, 30, 0.7)",
          border: `1px solid ${matches ? COLORS.red : COLORS.borderLight}`,
          color: COLORS.w,
          transition: "border-color 200ms ease",
        }}
      />

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
        <AlertDialog.Cancel asChild>
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
        </AlertDialog.Cancel>
        <PrimaryButton type="submit" danger disabled={!matches || busy}>
          {busy ? "Deleting…" : "Delete permanently"}
        </PrimaryButton>
      </div>
    </form>
  );
}

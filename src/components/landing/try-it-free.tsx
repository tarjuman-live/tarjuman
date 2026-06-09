"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { AuthModal } from "@/components/auth/auth-modal";

/**
 * Landing-page CTA. Opens the sign-up/sign-in popup instead of navigating to a
 * full auth page. If the visitor is already signed in, it skips the modal and
 * goes straight to the recorder. Client island so the landing page stays a
 * server component.
 */
export function TryItFree() {
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleClick = () => {
    if (isAuthenticated) router.push("/record");
    else setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="mt-2 px-6 py-3 rounded-xl bg-[var(--color-accent)] text-[#0A0F1C] font-bold shadow-[0_0_24px_rgba(46,204,113,0.35)] hover:brightness-110 transition cursor-pointer"
      >
        Try it free
      </button>
      <AuthModal open={open} onOpenChange={setOpen} initialMode="signUp" />
    </>
  );
}

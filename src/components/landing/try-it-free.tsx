"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";

// Code-split the auth popup (AuthForm + Convex-auth client + Radix Dialog) out
// of the landing's initial bundle — it only loads when the visitor intends to
// sign up, keeping the most-visited page's JS small for faster interactivity.
const AuthModal = dynamic(
  () => import("@/components/auth/auth-modal").then((m) => m.AuthModal),
  { ssr: false }
);

/**
 * Landing-page CTA. Opens the sign-up/sign-in popup instead of navigating to a
 * full auth page. Already-signed-in visitors skip straight to the recorder.
 * The modal chunk is preloaded on hover/focus so the first open is instant.
 */
export function TryItFree() {
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Mounting AuthModal triggers its dynamic import. Preload on intent so the
  // first click opens immediately.
  const preload = () => setMounted(true);

  const handleClick = () => {
    if (isAuthenticated) {
      router.push("/record");
      return;
    }
    setMounted(true);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onPointerEnter={preload}
        onFocus={preload}
        className="mt-2 px-6 py-3 rounded-xl border border-[var(--color-accent)] bg-[var(--color-accent)] text-[#0A0F1C] font-bold shadow-[0_0_24px_rgba(46,204,113,0.35)] transition-colors duration-200 cursor-pointer hover:bg-[#0A0F1C] hover:text-[var(--color-accent)]"
      >
        Try it free
      </button>
      {mounted && (
        <AuthModal open={open} onOpenChange={setOpen} initialMode="signUp" />
      )}
    </>
  );
}

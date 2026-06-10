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
  const [hovered, setHovered] = useState(false);

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
        onPointerEnter={() => {
          preload();
          setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => {
          preload();
          setHovered(true);
        }}
        onBlur={() => setHovered(false)}
        className="mt-2 px-6 py-3 rounded-xl font-bold cursor-pointer"
        style={{
          // Hover inverts: green→dark bg, dark→green text. Green border stays
          // so the button keeps its size and is visible once the bg goes dark.
          border: "1px solid var(--color-accent)",
          backgroundColor: hovered ? "#0A0F1C" : "var(--color-accent)",
          color: hovered ? "var(--color-accent)" : "#0A0F1C",
          boxShadow: "0 0 24px rgba(46,204,113,0.35)",
          transition: "background-color 200ms ease, color 200ms ease",
        }}
      >
        Try it free
      </button>
      {mounted && (
        <AuthModal open={open} onOpenChange={setOpen} initialMode="signUp" />
      )}
    </>
  );
}

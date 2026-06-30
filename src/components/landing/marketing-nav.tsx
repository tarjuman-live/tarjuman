"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { SITE_NAME } from "@/lib/site";
import { useLocale } from "@/lib/i18n/locale-context";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import type { MessageKey } from "@/lib/i18n/messages";

// Same code-split pattern as the hero CTA — the auth popup (AuthForm + Convex
// auth client + Radix Dialog) only loads when a visitor signals intent to sign
// in, keeping the landing's initial JS small.
const AuthModal = dynamic(
  () => import("@/components/auth/auth-modal").then((m) => m.AuthModal),
  { ssr: false }
);

const LINKS: { href: string; key: MessageKey }[] = [
  { href: "#try", key: "lp.tryIt" },
  { href: "#features", key: "lp.features" },
  { href: "#use-cases", key: "lp.useCases" },
  { href: "#pricing", key: "lp.pricing" },
  { href: "#faq", key: "lp.faq" },
];

/**
 * Sticky marketing top-nav for the landing page. Logo + section anchors +
 * auth-aware actions. Signed-out visitors get "Sign in" (ghost) and "Get
 * started" (primary), both opening the in-place auth popup; signed-in visitors
 * get a single "Open recorder". The bar is transparent at the top of the page
 * and gains a frosted background + border once scrolled, so it never fights the
 * hero on load.
 */
export function MarketingNav() {
  const { isAuthenticated } = useConvexAuth();
  const { t } = useLocale();
  const router = useRouter();

  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"signIn" | "signUp">("signUp");
  // Bumped on each open so the modal remounts with the freshly-chosen mode
  // (AuthModal only reads initialMode on mount). The prior closed instance has
  // already animated out, so this doesn't interrupt any transition.
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Mounting AuthModal triggers its dynamic import; preload on hover/focus so
  // the first open is instant.
  const preload = () => setMounted(true);

  const openAuth = (next: "signIn" | "signUp") => {
    if (isAuthenticated) {
      router.push("/record");
      return;
    }
    setMode(next);
    setSeq((s) => s + 1);
    setMounted(true);
    setOpen(true);
  };

  return (
    // Floating "island" tile — translucent glass, detached from the edges. The
    // outer header is just a sticky, click-through spacer; the tile itself is
    // the interactive surface.
    <header className="sticky top-0 z-50 px-3 pt-3 pointer-events-none">
      <nav
        className="pointer-events-auto mx-auto max-w-5xl rounded-2xl px-3.5 sm:px-5 h-14 flex items-center justify-between gap-4 transition-all duration-300"
        style={{
          background: scrolled ? "rgba(14,21,37,0.7)" : "rgba(14,21,37,0.42)",
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: scrolled
            ? "var(--color-border-light)"
            : "var(--color-border-faint)",
          boxShadow: scrolled
            ? "0 12px 34px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)"
            : "0 6px 20px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          <span className="w-9 h-9 rounded-xl bg-[var(--color-accent)] grid place-items-center shadow-[0_0_24px_rgba(46,204,113,0.4)] transition-transform group-hover:scale-105">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0A0F1C"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0014 0" />
              <line x1="12" y1="20" x2="12" y2="24" />
            </svg>
          </span>
          <span className="font-bold text-[var(--color-text-1)]">
            {SITE_NAME}
          </span>
        </Link>

        {/* Section anchors — desktop only */}
        <div className="hidden md:flex items-center gap-7 text-sm text-[var(--color-text-2)]">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="hover:text-[var(--color-accent)] transition-colors"
            >
              {t(l.key)}
            </a>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* App-language picker (top corner) */}
          <LocaleSwitcher compact />
          {isAuthenticated ? (
            <button
              type="button"
              onClick={() => router.push("/record")}
              className="px-4 py-2 rounded-xl text-sm font-bold cursor-pointer transition-all duration-200 active:scale-95 bg-[var(--color-accent)] text-[#0A0F1C] hover:brightness-110 hover:-translate-y-0.5 shadow-[0_0_20px_rgba(46,204,113,0.3)] hover:shadow-[0_0_30px_rgba(46,204,113,0.6)]"
            >
              {t("lp.openRecorder")}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => openAuth("signIn")}
                onPointerEnter={preload}
                onFocus={preload}
                className="hidden sm:inline-block px-3 py-2 rounded-xl text-sm font-semibold text-[var(--color-text-2)] hover:text-[var(--color-accent)] cursor-pointer transition-colors"
              >
                {t("lp.signIn")}
              </button>
              <button
                type="button"
                onClick={() => openAuth("signUp")}
                onPointerEnter={preload}
                onFocus={preload}
                className="px-4 py-2 rounded-xl text-sm font-bold cursor-pointer transition-all duration-200 active:scale-95 bg-[var(--color-accent)] text-[#0A0F1C] hover:brightness-110 hover:-translate-y-0.5 shadow-[0_0_20px_rgba(46,204,113,0.3)] hover:shadow-[0_0_30px_rgba(46,204,113,0.6)]"
              >
                {t("lp.getStarted")}
              </button>
            </>
          )}
        </div>
      </nav>

      {mounted && (
        <AuthModal key={seq} open={open} onOpenChange={setOpen} initialMode={mode} />
      )}
    </header>
  );
}

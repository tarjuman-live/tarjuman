"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { SITE_NAME } from "@/lib/site";
import { useLocale } from "@/lib/i18n/locale-context";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { SHOW_PRICING } from "@/lib/constants";
import type { MessageKey } from "@/lib/i18n/messages";

// Same code-split pattern as the hero CTA — the auth popup (AuthForm + Convex
// auth client + Radix Dialog) only loads when a visitor signals intent to sign
// in, keeping the landing's initial JS small.
const AuthModal = dynamic(
  () => import("@/components/auth/auth-modal").then((m) => m.AuthModal),
  { ssr: false }
);
const WaitlistModal = dynamic(
  () => import("./waitlist-modal").then((m) => m.WaitlistModal),
  { ssr: false }
);

const LINKS: { href: string; key: MessageKey }[] = [
  { href: "#features", key: "lp.features" },
  { href: "#use-cases", key: "lp.useCases" },
  { href: "#pricing", key: "lp.pricing" },
  { href: "#faq", key: "lp.faq" },
];

/**
 * Sticky marketing top-nav for the landing page. Logo + section anchors +
 * auth-aware actions. Pre-launch, signed-out visitors get a single "Join the
 * waitlist" (no public Sign in / Get started); signed-in visitors get "Open
 * recorder". Sign-in itself still works via the /?auth=signin deep link —
 * that's where the (app) guard sends anyone who opens /record or /admin while
 * signed out, so operators can always get in. At the top of the page there is
 * no bar at all — the brand, links and buttons float over the hero — and the
 * frosted glass tile fades in behind them once the visitor starts scrolling.
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

  // Deep-link / guard redirect: /?auth=signin|signup opens the popup straight
  // into the right mode. This is where the (app) auth-guard now sends signed-out
  // visitors (the standalone /login and /signup pages were removed) — the popup
  // is the only sign-in surface. Strip the param afterward so a refresh or
  // back-nav doesn't reopen it.
  useEffect(() => {
    const auth = new URLSearchParams(window.location.search).get("auth");
    if (auth !== "signin" && auth !== "signup") return;
    // Legitimate on-mount browser-state read (same pattern as locale-context):
    // open the popup once based on the URL. Not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(auth === "signup" ? "signUp" : "signIn");
    setSeq((s) => s + 1);
    setMounted(true);
    setOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("auth");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, []);

  // The waitlist popup: mounting triggers its dynamic import, so preload on
  // hover/focus and the first open is instant.
  const [waitlistMounted, setWaitlistMounted] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const preloadWaitlist = () => setWaitlistMounted(true);

  return (
    // Floating "island" nav, detached from the edges. The outer header is just a
    // sticky, click-through spacer; the nav itself is the interactive surface.
    <header className="sticky top-0 z-50 px-3 pt-3 pointer-events-none">
      <nav className="pointer-events-auto relative isolate mx-auto max-w-5xl rounded-2xl px-3.5 sm:px-5 h-14 flex items-center justify-between gap-4">
        {/* The glass tile — invisible at the top of the page, fades in once
            scrolled. Its own layer so only opacity/scale animate; transitioning
            the backdrop blur itself is janky. `isolate` on the nav keeps -z-10
            behind the contents but inside the header. */}
        <span
          aria-hidden="true"
          className={`absolute inset-0 -z-10 rounded-2xl pointer-events-none transition-[opacity,scale] duration-300 ease-out motion-reduce:scale-100 ${
            scrolled ? "opacity-100 scale-100" : "opacity-0 scale-[0.98]"
          }`}
          style={{
            background: "rgba(14,21,37,0.7)",
            backdropFilter: "blur(18px) saturate(160%)",
            WebkitBackdropFilter: "blur(18px) saturate(160%)",
            border: "1px solid var(--color-border-light)",
            boxShadow:
              "0 12px 34px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        />

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
          {LINKS.filter(
            (l) => SHOW_PRICING || l.href !== "#pricing"
          ).map((l) => (
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
            <button
              type="button"
              onClick={() => {
                setWaitlistMounted(true);
                setWaitlistOpen(true);
              }}
              onPointerEnter={preloadWaitlist}
              onFocus={preloadWaitlist}
              className="px-3.5 sm:px-4 py-2 rounded-xl text-[13px] sm:text-sm font-bold whitespace-nowrap cursor-pointer transition-all duration-200 active:scale-95 bg-[var(--color-accent)] text-[#0A0F1C] hover:brightness-110 hover:-translate-y-0.5 shadow-[0_0_20px_rgba(46,204,113,0.3)] hover:shadow-[0_0_30px_rgba(46,204,113,0.6)]"
            >
              {/* Short label below lg — the full phrase overflows the bar on
                  phones (e.g. French) and on tablets, where the section links
                  share it (e.g. Swedish, Finnish). */}
              <span className="lg:hidden">{t("lp.waitlistShort")}</span>
              <span className="hidden lg:inline">{t("lp.joinWaitlist")}</span>
            </button>
          )}
        </div>
      </nav>

      {mounted && (
        <AuthModal key={seq} open={open} onOpenChange={setOpen} initialMode={mode} />
      )}
      {waitlistMounted && (
        <WaitlistModal open={waitlistOpen} onOpenChange={setWaitlistOpen} />
      )}
    </header>
  );
}

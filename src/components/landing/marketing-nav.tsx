"use client";

import { useEffect, useRef, useState } from "react";
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

const LINKS: { href: string; key: MessageKey }[] = [
  { href: "#features", key: "lp.features" },
  { href: "#use-cases", key: "lp.useCases" },
  { href: "#pricing", key: "lp.pricing" },
  { href: "#faq", key: "lp.faq" },
];

// Space between the three groups (brand · links · actions) once they've
// gathered into the island. The island is sized to exactly this. Keep it above
// the nav's gap-4 (16px): that slack is what stops a snug island from ever
// squeezing the links into wrapping.
const ISLAND_GAP = 40;

/**
 * Sticky marketing top-nav for the landing page. Logo + section anchors +
 * auth-aware actions. Signed-out visitors get "Sign in" (ghost) and "Get
 * started" (primary), both opening the in-place auth popup; signed-in visitors
 * get a single "Open recorder".
 *
 * Two states. At the top of the page there is no bar: the groups sit directly
 * on the page, spread to the hero column's edges. Once scrolled they slide in
 * toward each other and a frosted glass island forms around them, sized to fit
 * its contents. Scrolling back to the top reverses it. Both directions are plain
 * CSS transitions on one `scrolled` flag, so a reversal mid-flight glides from
 * wherever it is rather than restarting.
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

  // The island's width is measured, not a fixed max-w: the nav carries 31
  // locales, and a fixed width that looks snug in English overflows in
  // Ukrainian or Greek. The observer re-measures whenever a group resizes —
  // locale switch, the signed-in button swap, web-font load — and when the nav
  // itself does (a breakpoint changes the padding and hides the links, which
  // then report 0 and drop out of the sum).
  const navRef = useRef<HTMLElement>(null);
  const brandRef = useRef<HTMLAnchorElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [islandWidth, setIslandWidth] = useState<number | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    const groups = [brandRef.current, linksRef.current, actionsRef.current].filter(
      (el): el is HTMLAnchorElement | HTMLDivElement => el !== null
    );
    if (!nav) return;
    const sm = window.matchMedia("(min-width: 640px)");
    const measure = () => {
      const shown = groups.filter((el) => el.offsetWidth > 0);
      const content = shown.reduce(
        (sum, el) => sum + el.getBoundingClientRect().width,
        0
      );
      // The island's own padding (px-3.5 / sm:px-5) and its 1px border.
      const pad = sm.matches ? 20 : 14;
      setIslandWidth(
        Math.ceil(content + ISLAND_GAP * (shown.length - 1) + pad * 2 + 2)
      );
    };
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    groups.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
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

  // Mounting AuthModal triggers its dynamic import; preload on hover/focus so
  // the first open is instant.
  const preload = () => setMounted(true);

  const openAuth = (next: "signIn" | "signUp") => {
    // Already signed in (e.g. the popup raced a session restore): treat it as
    // a sign-in — /start routes operators to /admin, everyone else to /record.
    if (isAuthenticated) {
      router.push("/start");
      return;
    }
    setMode(next);
    setSeq((s) => s + 1);
    setMounted(true);
    setOpen(true);
  };

  return (
    // The outer header is just a sticky, click-through spacer; the nav is the
    // interactive surface. Its height never changes between the two states, so
    // nothing below it shifts while it morphs.
    <header className="sticky top-0 z-50 px-3 pt-3 pointer-events-none">
      {/* Caps the spread state so, with the nav's px-3, the groups line up
          with the hero's max-w-6xl column (73.5rem − 2 × 0.75rem = 72rem).
          Capping here rather than in the nav keeps the transitioned value a
          plain 100% → px, which every browser tweens. */}
      <div className="mx-auto max-w-[73.5rem]">
        <nav
          ref={navRef}
          className={`pointer-events-auto mx-auto rounded-2xl h-14 flex items-center justify-between gap-4 transition-[max-width,padding,background-color,border-color,box-shadow,backdrop-filter,-webkit-backdrop-filter] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
            scrolled ? "px-3.5 sm:px-5" : "px-3"
          }`}
          style={{
            maxWidth: scrolled
              ? islandWidth
                ? `${islandWidth}px`
                : "64rem"
              : "100%",
            backgroundColor: scrolled
              ? "rgba(14,21,37,0.7)"
              : "rgba(14,21,37,0)",
            backdropFilter: scrolled
              ? "blur(18px) saturate(160%)"
              : "blur(0px) saturate(100%)",
            WebkitBackdropFilter: scrolled
              ? "blur(18px) saturate(160%)"
              : "blur(0px) saturate(100%)",
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: scrolled ? "var(--color-border-light)" : "transparent",
            // Same two layers in both states, only the alpha changes — that is
            // what lets the shadow tween instead of snapping.
            boxShadow: scrolled
              ? "0 12px 34px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)"
              : "0 12px 34px rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0)",
          }}
        >
          {/* Brand */}
          <Link
            ref={brandRef}
            href="/"
            className="flex items-center gap-2.5 shrink-0 group"
          >
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
          <div
            ref={linksRef}
            className="hidden md:flex items-center gap-7 text-sm text-[var(--color-text-2)]"
          >
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
          <div
            ref={actionsRef}
            className="flex items-center gap-2 sm:gap-3 shrink-0"
          >
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
      </div>

      {mounted && (
        <AuthModal key={seq} open={open} onOpenChange={setOpen} initialMode={mode} />
      )}
    </header>
  );
}

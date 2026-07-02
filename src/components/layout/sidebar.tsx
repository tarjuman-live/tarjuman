"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, IconName } from "@/components/shared/icon";
import { COLORS } from "@/lib/constants";
import { SITE_NAME } from "@/lib/site";
import { useLocale } from "@/lib/i18n/locale-context";
import type { MessageKey } from "@/lib/i18n/messages";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { AccountMenu } from "@/components/auth/account-menu";

/**
 * Desktop-only left navigation rail (≥ lg). Mobile keeps the floating
 * BottomNav — this rail is `hidden lg:flex`, so the phone layout is untouched.
 *
 * Consolidates what the phone layout splits between the per-page top header
 * (brand + account + language) and the bottom tab bar (Record/History): brand
 * at the top, the nav items in the middle, language + account pinned at the
 * bottom — the standard Mac-app shell.
 */
const NAV: {
  icon: IconName;
  labelKey: MessageKey;
  href: string;
  matches: (p: string) => boolean;
}[] = [
  { icon: "mic", labelKey: "nav.record", href: "/record", matches: (p) => p === "/record" },
  {
    icon: "history",
    labelKey: "nav.history",
    href: "/history",
    matches: (p) => p === "/history" || p.startsWith("/session/"),
  },
  {
    icon: "settings",
    labelKey: "settings.title",
    href: "/settings",
    matches: (p) => p === "/settings",
  },
];

// Item height (h-11 = 44px) + gap (gap-1 = 4px) → the sliding pill's per-item
// vertical offset.
const NAV_ITEM_PITCH = 48;

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useLocale();
  const activeIndex = NAV.findIndex((n) => n.matches(pathname));

  return (
    <aside
      // A floating "island" tile: the rail is detached from the screen edges
      // (lg:p-3 gutter) into a rounded, bordered panel with a soft shadow —
      // same island language as the landing nav. z-30 lifts its stacking context
      // above the opaque main column so the footer's language/account menus
      // (which open upward) float over the content instead of being clipped.
      className="hidden lg:block lg:sticky lg:top-0 lg:h-[100dvh] shrink-0 lg:z-30 lg:p-3"
    >
      <div
        className="flex flex-col h-full w-60 rounded-2xl"
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.borderLight}`,
          boxShadow:
            "0 12px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
      {/* Brand — links home to the recorder */}
      <Link
        href="/record"
        className="flex items-center gap-2.5 px-5 h-16 shrink-0 group"
      >
        <span
          className="w-9 h-9 rounded-xl grid place-items-center transition-transform group-hover:scale-105"
          style={{
            background: COLORS.accent,
            boxShadow: `0 0 20px ${COLORS.accent}40`,
          }}
        >
          <Icon name="mic" size={18} color="#0A0F1C" />
        </span>
        <span className="font-bold text-[17px]" style={{ color: COLORS.w }}>
          {SITE_NAME}
        </span>
      </Link>

      {/* Primary nav — a single active pill glides between items (fluid),
          with the icon/label color crossfading in sync. */}
      <div className="px-3 mt-2">
        <nav className="relative">
          {activeIndex >= 0 && (
            <div
              aria-hidden
              className="sidebar-nav-pill absolute inset-x-0 top-0 h-11 rounded-xl"
              style={{
                transform: `translateY(${activeIndex * NAV_ITEM_PITCH}px)`,
                background: COLORS.accentSoft,
                // The active item's green outline + glow — stays put (glides
                // with the pill) so the current page reads as selected.
                border: `1px solid ${COLORS.accent}`,
                boxShadow: `0 0 16px ${COLORS.accent}40`,
              }}
            />
          )}
          <div className="relative flex flex-col gap-1">
            {NAV.map((item) => {
              const active = item.matches(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  // border-transparent keeps the box size stable; inactive items
                  // light up with the same green outline + glow on hover (the
                  // active item's outline is drawn by the pill behind it).
                  className={`relative z-10 flex items-center gap-3 h-11 px-3 rounded-xl text-sm font-semibold border border-transparent transition-all duration-200 ${
                    active
                      ? ""
                      : "hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] hover:shadow-[0_0_16px_rgba(46,204,113,0.35)]"
                  }`}
                  style={{ color: active ? COLORS.accent : COLORS.t2 }}
                >
                  <Icon
                    name={item.icon}
                    size={20}
                    color={active ? COLORS.accent : COLORS.t2}
                    className="transition-colors"
                  />
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      <div className="flex-1" />

      {/* Language + account, pinned to the bottom */}
      <div
        className="flex items-center gap-2 px-4 py-4"
        style={{ borderTop: `1px solid ${COLORS.border}` }}
      >
        <LocaleSwitcher compact dropUp />
        <AccountMenu dropUp />
      </div>
      </div>
    </aside>
  );
}

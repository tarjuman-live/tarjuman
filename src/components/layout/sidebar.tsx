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
      className="hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-[100dvh] lg:w-60 shrink-0"
      style={{
        background: COLORS.surface,
        borderRight: `1px solid ${COLORS.border}`,
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
                  className="relative z-10 flex items-center gap-3 h-11 px-3 rounded-xl text-sm font-semibold transition-colors"
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
    </aside>
  );
}

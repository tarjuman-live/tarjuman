"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { useAdmin, useNow } from "./admin-context";
import { GhostButton, Notice } from "./ui";
import { timeAgo } from "./format";

const TABS = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/usage", label: "AI & costs" },
  { href: "/admin/system", label: "System" },
] as const;

function isActive(pathname: string, tab: (typeof TABS)[number]): boolean {
  if ("exact" in tab && tab.exact) return pathname === tab.href;
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

/**
 * Frame for every /admin page: title, snapshot freshness + Refresh, active
 * alerts, and the tab bar (a sliding pill that glides between tabs).
 *
 * English-only and forced LTR: the app's LocaleProvider flips <html dir> to
 * rtl for Arabic/Urdu/Hebrew UI, which would mirror tables and charts here.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { computedAt, refreshing, refresh, refreshError, alerts } = useAdmin();
  const now = useNow(15_000);

  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const activeIndex = TABS.findIndex((t) => isActive(pathname, t));

  useLayoutEffect(() => {
    const measure = () => {
      const el = tabRefs.current[activeIndex];
      setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeIndex]);

  return (
    <div
      dir="ltr"
      className="flex flex-col flex-1 w-full px-4 sm:px-5 pt-5 pb-[calc(env(safe-area-inset-bottom,0px)+96px)] lg:px-8 lg:pt-10 lg:pb-12 lg:max-w-6xl lg:mx-auto"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-10 h-10 rounded-xl grid place-items-center shrink-0"
            style={{ background: COLORS.accentSoft, border: `1px solid ${COLORS.accent}40` }}
          >
            <Icon name="shield" size={20} color={COLORS.accent} />
          </span>
          <div className="min-w-0">
            <div className="section-label">Operator</div>
            <h1 className="text-2xl font-bold leading-tight" style={{ color: COLORS.w }}>
              Admin
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="hidden sm:inline text-[11.5px]" style={{ color: COLORS.t3 }}>
            {refreshing
              ? "Recomputing…"
              : computedAt
                ? `Updated ${timeAgo(computedAt, now)}`
                : "Not computed yet"}
          </span>
          <GhostButton onClick={refresh} disabled={refreshing}>
            <span
              className={refreshing ? "animate-spin motion-reduce:animate-none" : ""}
              style={{ display: "inline-flex" }}
            >
              <Icon name="history" size={14} color="currentColor" />
            </span>
            Refresh
          </GhostButton>
        </div>
      </header>

      <div
        className="h-[3px] mt-4 rounded-full transition-opacity duration-300"
        style={{ opacity: refreshing ? 1 : 0 }}
        aria-hidden
      >
        <div className="summary-shimmer-bar h-full w-full" />
      </div>

      {refreshError && (
        <div className="mt-2">
          <Notice tone="amber">{refreshError}</Notice>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {alerts.map((a) => (
            <Notice key={a.kind} tone="red">
              <span className="font-semibold" style={{ color: COLORS.red }}>
                Alert ·{" "}
              </span>
              {a.message}
              <span className="ml-1" style={{ color: COLORS.t4 }}>
                (since {timeAgo(a.since, now)})
              </span>
            </Notice>
          ))}
        </div>
      )}

      <nav
        aria-label="Admin sections"
        className="mt-3 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          className="relative inline-flex gap-1 p-1 rounded-2xl"
          style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
        >
          {pill && (
            <span
              aria-hidden
              className="absolute top-1 bottom-1 left-0 rounded-xl transition-[transform,width] duration-300 ease-[cubic-bezier(0.3,0.9,0.4,1)] motion-reduce:transition-none"
              style={{
                width: pill.width,
                transform: `translateX(${pill.left}px)`,
                background: COLORS.accentSoft,
                boxShadow: `inset 0 0 0 1px ${COLORS.accent}55`,
              }}
            />
          )}
          {TABS.map((t, i) => {
            const active = i === activeIndex;
            return (
              <Link
                key={t.href}
                href={t.href}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                aria-current={active ? "page" : undefined}
                className="relative z-10 h-9 px-3.5 inline-flex items-center rounded-xl text-[13px] font-semibold whitespace-nowrap transition-colors duration-200"
                style={{ color: active ? COLORS.accent : COLORS.t2 }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mt-5 flex flex-col">{children}</div>
    </div>
  );
}

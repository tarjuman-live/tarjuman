"use client";

import { useState, type ReactNode } from "react";
import { COLORS } from "@/lib/constants";
import { Sparkline } from "./charts";
import { change, percent } from "./format";

/**
 * Admin UI primitives — the app's settings-card idiom (surface card, hairline
 * border, 2xl radius, DM Sans scale) applied to a dashboard. Colors are set
 * inline from COLORS like the rest of the app; interactive pieces follow the
 * house motion rules (fluid transitions, green outline-glow on hover).
 */

export const cardStyle = {
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
} as const;

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`rounded-2xl min-w-0 ${className}`} style={cardStyle}>
      {(title || action) && (
        <header className="px-4 pt-4 pb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h3 className="text-[13px] font-semibold" style={{ color: COLORS.w }}>
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: COLORS.t3 }}>
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={padded ? "p-4 pt-3" : ""}>{children}</div>
    </section>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label mb-2 mt-8 first:mt-0">{children}</div>;
}

export type Tone = "accent" | "amber" | "red" | "blue" | "muted";

const TONES: Record<Tone, { bg: string; fg: string }> = {
  accent: { bg: COLORS.accentSoft, fg: COLORS.accent },
  amber: { bg: COLORS.amberSoft, fg: COLORS.amber },
  red: { bg: COLORS.redSoft, fg: COLORS.red },
  blue: { bg: COLORS.blueSoft, fg: COLORS.blue },
  muted: { bg: COLORS.surfaceLight, fg: COLORS.t3 },
};

export function Badge({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <span
      className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider px-[6px] py-[2px] rounded-md whitespace-nowrap"
      style={{ background: t.bg, color: t.fg }}
    >
      {children}
    </span>
  );
}

export function PlanPill({
  plan,
  source,
}: {
  plan: "free" | "pro";
  source?: "stripe" | "grant" | "none";
}) {
  if (plan === "pro") {
    return <Badge tone={source === "grant" ? "amber" : "accent"}>{source === "grant" ? "✦ Pro · comp" : "✦ Pro"}</Badge>;
  }
  return <Badge>Free</Badge>;
}

export function ProviderBadges({ providers }: { providers: string[] }) {
  if (providers.length === 0) return <Badge>no sign-in</Badge>;
  return (
    <span className="inline-flex gap-1">
      {providers.map((p) => (
        <Badge key={p} tone={p === "google" ? "blue" : "muted"}>
          {p === "google" ? "Google" : p === "password" ? "Password" : p}
        </Badge>
      ))}
    </span>
  );
}

export function Avatar({
  image,
  name,
  email,
  size = 32,
}: {
  image?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
}) {
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote avatar URLs (Google / Convex storage); next/image would need every host allow-listed
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="rounded-full shrink-0 object-cover"
        style={{ width: size, height: size, background: COLORS.surfaceLight }}
      />
    );
  }
  return (
    <span
      className="rounded-full shrink-0 grid place-items-center font-bold"
      style={{
        width: size,
        height: size,
        background: COLORS.surfaceLight,
        color: COLORS.t2,
        fontSize: size * 0.42,
      }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

/**
 * Segmented control with a sliding selection pill (the plans-page idiom).
 * Options are equal-width so the pill moves by a whole-slot translate.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="relative inline-grid p-1 rounded-xl"
      style={{
        ...cardStyle,
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-1 rounded-lg transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          width: `calc((100% - 8px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
          background: COLORS.surfaceLight,
          boxShadow: `inset 0 0 0 1px ${COLORS.borderLight}`,
        }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className="relative z-10 h-8 px-3 text-[12px] font-semibold rounded-lg cursor-pointer whitespace-nowrap transition-colors duration-200"
            style={{ color: active ? COLORS.w : COLORS.t3 }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Compact switch with an inline label. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 h-10 px-3 rounded-xl cursor-pointer text-[12px] font-semibold transition-colors duration-200 hover:bg-black/10"
      style={{ ...cardStyle, color: checked ? COLORS.w : COLORS.t3 }}
    >
      <span
        className="relative rounded-full transition-colors duration-200"
        style={{
          width: 30,
          height: 18,
          background: checked ? COLORS.accent : COLORS.surfaceLight,
          border: `1px solid ${checked ? COLORS.accent : COLORS.borderLight}`,
        }}
      >
        <span
          className="absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-200"
          style={{
            width: 12,
            height: 12,
            left: checked ? 15 : 2,
            background: checked ? "#0A0F1C" : COLORS.t3,
          }}
        />
      </span>
      {label}
    </button>
  );
}

/** Ghost button used across admin chrome. Green outline-glow on hover. */
export function GhostButton({
  children,
  onClick,
  disabled,
  tone = "default",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "accent";
  type?: "button" | "submit";
}) {
  const [hover, setHover] = useState(false);
  const color =
    tone === "danger" ? COLORS.red : tone === "accent" ? COLORS.accent : COLORS.t2;
  const lit = hover && !disabled;
  const glow = tone === "danger" ? COLORS.red : COLORS.accent;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl text-[12.5px] font-semibold cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-default"
      style={{
        background: COLORS.surface,
        color,
        border: `1px solid ${lit ? glow : COLORS.borderLight}`,
        boxShadow: lit ? `0 0 0 1px ${glow}, 0 0 16px ${glow}55` : "0 0 0 transparent",
        transition: "border-color 200ms ease, box-shadow 200ms ease, transform 150ms ease",
      }}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  danger,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl text-[13px] font-bold cursor-pointer transition-all duration-200 active:scale-[0.98] hover:brightness-110 disabled:opacity-50 disabled:cursor-default"
      style={
        danger
          ? { background: COLORS.red, color: "#fff" }
          : {
              background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
              color: "#0A0F1C",
            }
      }
    >
      {children}
    </button>
  );
}

/**
 * KPI tile: label · value · signed delta vs. the previous period · optional
 * sparkline (de-emphasised trend, current point in the accent).
 */
export function StatTile({
  label,
  value,
  current,
  previous,
  periodLabel,
  goodWhenUp = true,
  spark,
  hint,
}: {
  label: string;
  value: string;
  /** Raw numbers for the delta chip (omit both to hide it). */
  current?: number;
  previous?: number;
  periodLabel?: string;
  goodWhenUp?: boolean;
  spark?: number[];
  hint?: ReactNode;
}) {
  const showDelta = current !== undefined && previous !== undefined;
  const d = showDelta ? change(current, previous) : null;
  const good = d ? (d.dir === "up") === goodWhenUp : true;
  const deltaColor =
    !d || d.dir === "flat" ? COLORS.t3 : good ? COLORS.accent : COLORS.red;
  return (
    <div className="rounded-2xl p-4 min-w-0 flex flex-col" style={cardStyle}>
      <div className="text-[12px] font-medium truncate" style={{ color: COLORS.t3 }}>
        {label}
      </div>
      <div
        className="text-[26px] leading-tight font-bold mt-1 truncate"
        style={{ color: COLORS.w }}
      >
        {value}
      </div>
      {d && (
        <div className="text-[11px] mt-0.5 flex items-center gap-1 min-w-0">
          <span className="font-semibold shrink-0" style={{ color: deltaColor }}>
            {d.dir === "flat"
              ? "No change"
              : `${d.dir === "up" ? "▲" : "▼"} ${d.ratio === null ? "new" : percent(Math.abs(d.ratio))}`}
          </span>
          {periodLabel && (
            <span className="truncate" style={{ color: COLORS.t4 }}>
              {periodLabel}
            </span>
          )}
        </div>
      )}
      {hint && (
        <div className="text-[11px] mt-0.5 truncate" style={{ color: COLORS.t4 }}>
          {hint}
        </div>
      )}
      {spark && spark.length > 1 && (
        <div className="mt-auto pt-3">
          <Sparkline values={spark} />
        </div>
      )}
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="py-8 text-center text-[12.5px]" style={{ color: COLORS.t3 }}>
      {children}
    </div>
  );
}

/** Inline error/info strip. */
export function Notice({
  tone = "amber",
  children,
}: {
  tone?: "amber" | "red" | "blue";
  children: ReactNode;
}) {
  const map = {
    amber: [COLORS.amberSoft, COLORS.amber],
    red: [COLORS.redSoft, COLORS.red],
    blue: [COLORS.blueSoft, COLORS.blue],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <div
      className="rounded-xl px-3.5 py-2.5 text-[12.5px] leading-snug animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
      style={{ background: bg, border: `1px solid ${fg}40`, color: COLORS.t2 }}
    >
      {children}
    </div>
  );
}

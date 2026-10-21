"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { COLORS } from "@/lib/constants";
import { dayLabel } from "./format";

/**
 * Hand-rolled SVG/HTML charts for /admin — no chart library (none is
 * installed, and these are small). Specs follow the dataviz method:
 *  - bars ≤ 24px, 4px rounded data-end, square at the baseline, 2px surface
 *    gap between touching marks; lines 2px; area wash ~10%; hairline grid;
 *  - text always in text tokens, never the series colour;
 *  - every plot has a hover layer (crosshair on lines, per-mark on bars and
 *    cells); tooltips fade/slide IN and OUT (kept mounted while fading);
 *  - marks grow in on mount; all motion is disabled under reduced-motion.
 *
 * Categorical colours: the validated dark-mode categorical order (blue,
 * orange, aqua, yellow, magenta, violet — checked with the dataviz validator
 * against the #0E1525 card surface: CVD ΔE ≥ 8.4, normal-vision ΔE ≥ 19.3,
 * contrast ≥ 3:1). Assign in this fixed order, never cycled or re-ranked.
 */
export const SERIES_COLORS = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#9085e9",
] as const;

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const GAP = 2;

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** False on the first frame, then true — drives grow-in transitions. */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * Hover state that remembers the last target while the tooltip fades out, so
 * the tooltip animates OUT instead of vanishing.
 */
function useHover<T>() {
  const [hover, setHover] = useState<T | null>(null);
  const [last, setLast] = useState<T | null>(null);
  const set = (v: T | null) => {
    setHover(v);
    if (v !== null) setLast(v);
  };
  return { hover, last, set };
}

// ─── Scales ─────────────────────────────────────────────────────────────────

/** Round a max up to a clean 1 / 2 / 2.5 / 5 × 10^k (never below 1). */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (v <= m * base) return m * base;
  }
  return 10 * base;
}

function roundedTopRect(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h}`,
    "Z",
  ].join(" ");
}

// ─── Tooltip ────────────────────────────────────────────────────────────────

function Tooltip({
  visible,
  x,
  y,
  containerWidth,
  children,
}: {
  visible: boolean;
  x: number;
  y: number;
  containerWidth: number;
  children: ReactNode;
}) {
  // Keep inside the card: anchor left/right near the edges.
  const anchor =
    x < 90 ? "left" : x > containerWidth - 90 ? "right" : "center";
  const translateX =
    anchor === "left" ? "0%" : anchor === "right" ? "-100%" : "-50%";
  return (
    <div
      role="tooltip"
      className="absolute z-20 pointer-events-none rounded-xl px-3 py-2 text-[11.5px] min-w-[120px]"
      style={{
        left: x,
        top: y,
        transform: `translate(${translateX}, calc(-100% - ${visible ? 10 : 4}px))`,
        opacity: visible ? 1 : 0,
        background: "rgba(20,28,46,0.92)",
        backdropFilter: "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
        border: `1px solid ${COLORS.borderLight}`,
        boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        transition: `opacity 160ms ease, transform 200ms ${EASE}`,
      }}
    >
      {children}
    </div>
  );
}

function TooltipRow({
  color,
  label,
  value,
}: {
  color?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 mt-1 first:mt-0">
      {color && (
        <span
          aria-hidden
          className="inline-block rounded-full shrink-0"
          style={{ width: 12, height: 2, background: color }}
        />
      )}
      <span className="font-bold tabular-nums" style={{ color: COLORS.w }}>
        {value}
      </span>
      <span className="truncate" style={{ color: COLORS.t3 }}>
        {label}
      </span>
    </div>
  );
}

export function Legend({
  items,
}: {
  items: { label: string; color: string; shape?: "rect" | "line" }[];
}) {
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 mb-2">
      {items.map((it) => (
        <span
          key={it.label}
          className="inline-flex items-center gap-1.5 text-[11.5px]"
          style={{ color: COLORS.t2 }}
        >
          <span
            aria-hidden
            className="inline-block shrink-0"
            style={
              it.shape === "line"
                ? { width: 12, height: 2, borderRadius: 2, background: it.color }
                : { width: 10, height: 10, borderRadius: 3, background: it.color }
            }
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

/** De-emphasised trend line; the current (last) point in the accent. */
export function Sparkline({
  values,
  height = 28,
}: {
  values: number[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => ({
    x: values.length === 1 ? width / 2 : 3 + (i / (values.length - 1)) * (width - 6),
    y: 3 + (1 - v / max) * (height - 6),
  }));
  const last = pts[pts.length - 1];
  return (
    <div ref={ref} style={{ height }} aria-hidden>
      {width > 0 && (
        <svg width={width} height={height}>
          <polyline
            points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={COLORS.t4}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {last && (
            <circle
              cx={last.x}
              cy={last.y}
              r={3}
              fill={COLORS.accent}
              stroke={COLORS.surface}
              strokeWidth={2}
            />
          )}
        </svg>
      )}
    </div>
  );
}

// ─── Column series (optionally stacked) ─────────────────────────────────────

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export function BarSeries({
  days,
  series,
  height = 180,
  format,
  ariaLabel,
}: {
  days: string[];
  series: Series[];
  height?: number;
  format: (v: number) => string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const mounted = useMounted();
  const reduced = usePrefersReducedMotion();
  const { hover, last, set } = useHover<number>();

  const padL = 40;
  const padR = 4;
  const padT = 8;
  const padB = 20;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const n = days.length;
  const band = n ? plotW / n : 0;
  const barW = Math.max(1, Math.min(24, band - GAP));
  const totals = days.map((_, i) =>
    series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0),
  );
  const max = niceMax(Math.max(0, ...totals));
  const baseline = padT + plotH;
  const ticks = [0, max / 2, max];
  const xLabelIdx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [...days.keys()];

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    set(Math.max(0, Math.min(n - 1, i)));
  };

  const tipIdx = hover ?? last;
  const tipX = tipIdx !== null ? padL + tipIdx * band + band / 2 : 0;
  const tipTop =
    tipIdx !== null
      ? baseline - (totals[tipIdx] / max) * plotH
      : 0;

  return (
    <div>
      {series.length > 1 && (
        <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      )}
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel}>
            {ticks.map((t) => {
              const y = baseline - (t / max) * plotH;
              return (
                <g key={t}>
                  <line
                    x1={padL}
                    x2={width - padR}
                    y1={y}
                    y2={y}
                    stroke={t === 0 ? COLORS.borderLight : COLORS.border}
                    strokeWidth={1}
                  />
                  <text
                    x={padL - 8}
                    y={y}
                    dy="0.32em"
                    textAnchor="end"
                    fontSize={10.5}
                    fill={COLORS.t4}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {format(t)}
                  </text>
                </g>
              );
            })}
            <g
              style={{
                transformBox: "view-box",
                transformOrigin: `0px ${baseline}px`,
                transform: mounted || reduced ? "scaleY(1)" : "scaleY(0)",
                transition: reduced ? "none" : `transform 700ms ${EASE}`,
              }}
            >
              {days.map((d, i) => {
                const x = padL + i * band + (band - barW) / 2;
                let y = baseline;
                const segs: ReactNode[] = [];
                const nonZero = series.filter((s) => (s.values[i] ?? 0) > 0);
                nonZero.forEach((s, j) => {
                  const v = s.values[i] ?? 0;
                  let h = (v / max) * plotH;
                  if (j > 0) {
                    y -= GAP;
                    h = Math.max(0, h - GAP);
                  }
                  const top = y - h;
                  const isTop = j === nonZero.length - 1;
                  segs.push(
                    isTop ? (
                      <path
                        key={s.key}
                        d={roundedTopRect(x, top, barW, h, 4)}
                        fill={s.color}
                      />
                    ) : (
                      <rect key={s.key} x={x} y={top} width={barW} height={h} fill={s.color} />
                    ),
                  );
                  y = top;
                });
                return (
                  <g
                    key={d}
                    style={{
                      opacity: hover === null || hover === i ? 1 : 0.45,
                      transition: "opacity 160ms ease",
                    }}
                  >
                    {segs}
                  </g>
                );
              })}
            </g>
            {xLabelIdx.map((i) => (
              <text
                key={i}
                x={padL + i * band + band / 2}
                y={height - 4}
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                fontSize={10.5}
                fill={COLORS.t4}
              >
                {dayLabel(days[i])}
              </text>
            ))}
            <rect
              x={padL}
              y={padT}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => set(null)}
            />
          </svg>
        )}
        {tipIdx !== null && (
          <Tooltip
            visible={hover !== null}
            x={tipX}
            y={Math.max(padT + 4, tipTop)}
            containerWidth={width}
          >
            <div className="mb-1" style={{ color: COLORS.t3 }}>
              {dayLabel(days[tipIdx])}
            </div>
            {series.length > 1 && (
              <TooltipRow label="Total" value={format(totals[tipIdx])} />
            )}
            {series.map((s) => (
              <TooltipRow
                key={s.key}
                color={s.color}
                label={s.label}
                value={format(s.values[tipIdx] ?? 0)}
              />
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// ─── Line series (single) ───────────────────────────────────────────────────

export function LineSeries({
  days,
  values,
  label,
  height = 180,
  format,
  color = COLORS.accent,
}: {
  days: string[];
  values: number[];
  label: string;
  height?: number;
  format: (v: number) => string;
  color?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const mounted = useMounted();
  const reduced = usePrefersReducedMotion();
  const { hover, last, set } = useHover<number>();
  const clipId = `clip-${useId().replace(/:/g, "")}`;

  const padL = 40;
  const padR = 8;
  const padT = 10;
  const padB = 20;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const n = values.length;
  const max = niceMax(Math.max(0, ...values));
  const baseline = padT + plotH;
  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => baseline - (v / max) * plotH;
  const line = values.map((v, i) => `${i ? "L" : "M"}${xAt(i)},${yAt(v)}`).join(" ");
  const area = n
    ? `${line} L${xAt(n - 1)},${baseline} L${xAt(0)},${baseline} Z`
    : "";
  const ticks = [0, max / 2, max];

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - rect.left) / rect.width;
    set(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))));
  };
  const tipIdx = hover ?? last;

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <defs>
            <clipPath id={clipId}>
              <rect
                x={0}
                y={0}
                width={width}
                height={height}
                style={{
                  transformBox: "view-box",
                  transformOrigin: "0px 0px",
                  transform: mounted || reduced ? "scaleX(1)" : "scaleX(0)",
                  transition: reduced ? "none" : `transform 900ms ${EASE}`,
                }}
              />
            </clipPath>
          </defs>
          {ticks.map((t) => {
            const y = yAt(t);
            return (
              <g key={t}>
                <line
                  x1={padL}
                  x2={width - padR}
                  y1={y}
                  y2={y}
                  stroke={t === 0 ? COLORS.borderLight : COLORS.border}
                  strokeWidth={1}
                />
                <text
                  x={padL - 8}
                  y={y}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={10.5}
                  fill={COLORS.t4}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {format(t)}
                </text>
              </g>
            );
          })}
          <g clipPath={`url(#${clipId})`}>
            <path d={area} fill={color} opacity={0.1} />
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {n > 0 && (
              <circle
                cx={xAt(n - 1)}
                cy={yAt(values[n - 1])}
                r={4}
                fill={color}
                stroke={COLORS.surface}
                strokeWidth={2}
              />
            )}
          </g>
          {[0, Math.floor((n - 1) / 2), n - 1]
            .filter((i, k, arr) => i >= 0 && arr.indexOf(i) === k)
            .map((i) => (
              <text
                key={i}
                x={xAt(i)}
                y={height - 4}
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                fontSize={10.5}
                fill={COLORS.t4}
              >
                {dayLabel(days[i])}
              </text>
            ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line
                x1={xAt(hover)}
                x2={xAt(hover)}
                y1={padT}
                y2={baseline}
                stroke={COLORS.borderLight}
                strokeWidth={1}
              />
              <circle
                cx={xAt(hover)}
                cy={yAt(values[hover])}
                r={4.5}
                fill={color}
                stroke={COLORS.surface}
                strokeWidth={2}
              />
            </g>
          )}
          <rect
            x={padL}
            y={padT}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => set(null)}
          />
        </svg>
      )}
      {tipIdx !== null && n > 0 && (
        <Tooltip
          visible={hover !== null}
          x={xAt(tipIdx)}
          y={Math.max(padT + 4, yAt(values[tipIdx]))}
          containerWidth={width}
        >
          <div className="mb-1" style={{ color: COLORS.t3 }}>
            {dayLabel(days[tipIdx])}
          </div>
          <TooltipRow color={color} label={label} value={format(values[tipIdx])} />
        </Tooltip>
      )}
    </div>
  );
}

// ─── Horizontal bar list ────────────────────────────────────────────────────

export function HBarList({
  items,
  format,
  emptyText = "No data yet",
}: {
  items: { key: string; label: string; value: number; detail?: string }[];
  format: (v: number) => string;
  emptyText?: string;
}) {
  const mounted = useMounted();
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) {
    return (
      <div className="py-6 text-center text-[12px]" style={{ color: COLORS.t3 }}>
        {emptyText}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((it) => (
        <li key={it.key} className="group">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="truncate" style={{ color: COLORS.t2 }}>
              {it.label}
            </span>
            <span className="shrink-0 flex items-baseline gap-2">
              {it.detail && (
                <span className="text-[11px]" style={{ color: COLORS.t4 }}>
                  {it.detail}
                </span>
              )}
              <span className="font-semibold tabular-nums" style={{ color: COLORS.w }}>
                {format(it.value)}
              </span>
            </span>
          </div>
          <div
            className="mt-1.5 h-[6px] rounded-full overflow-hidden"
            style={{ background: COLORS.surfaceLight }}
          >
            <div
              className="h-full rounded-full transition-[width,filter] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:brightness-125 motion-reduce:transition-none"
              style={{
                width: mounted ? `${(it.value / max) * 100}%` : "0%",
                background: COLORS.accent,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Part-to-whole bar ──────────────────────────────────────────────────────

export function ShareBar({
  parts,
  format,
}: {
  parts: { key: string; label: string; value: number; color: string }[];
  format: (v: number) => string;
}) {
  const mounted = useMounted();
  const total = parts.reduce((s, p) => s + p.value, 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div
        className="flex h-[10px] rounded-full overflow-hidden"
        style={{ gap: GAP, background: total ? "transparent" : COLORS.surfaceLight }}
        role="img"
        aria-label={parts.map((p) => `${p.label} ${format(p.value)}`).join(", ")}
      >
        {visible.map((p) => (
          <div
            key={p.key}
            className="h-full transition-[flex-grow] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{
              flexGrow: mounted ? p.value : 0.0001,
              flexBasis: 0,
              background: p.color,
            }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="inline-flex items-center gap-2 min-w-0" style={{ color: COLORS.t2 }}>
              <span
                aria-hidden
                className="shrink-0"
                style={{ width: 10, height: 10, borderRadius: 3, background: p.color }}
              />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold" style={{ color: COLORS.w }}>
                {format(p.value)}
              </span>
              <span className="ml-2 text-[11px]" style={{ color: COLORS.t4 }}>
                {total ? `${Math.round((p.value / total) * 100)}%` : "—"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Heatmap (weekday × hour) ───────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

/** Sequential one-hue ramp: empty = surface step, then accent by magnitude. */
export function Heatmap({
  grid,
  unit = "sessions",
}: {
  grid: number[][];
  unit?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { hover, last, set } = useHover<{
    d: number;
    h: number;
    x: number;
    y: number;
    /** Container width at hover time (for tooltip edge clamping). */
    cw: number;
  }>();
  const max = Math.max(1, ...grid.flat());
  const cellColor = (v: number) =>
    v === 0
      ? COLORS.surfaceLight
      : `rgba(46,204,113,${(0.18 + 0.82 * Math.sqrt(v / max)).toFixed(3)})`;
  const tip = hover ?? last;
  return (
    <div ref={containerRef} className="relative">
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: "28px repeat(24, minmax(0, 1fr))" }}
        onPointerLeave={() => set(null)}
      >
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <div
              className="text-[10.5px] self-center"
              style={{ color: COLORS.t4 }}
            >
              {WEEKDAYS[d]}
            </div>
            {row.map((v, h) => (
              <div
                key={h}
                className="aspect-square rounded-[3px] transition-[outline-color] duration-150"
                style={{
                  background: cellColor(v),
                  outline: `1px solid ${hover && hover.d === d && hover.h === h ? COLORS.w : "transparent"}`,
                  outlineOffset: 1,
                }}
                onPointerEnter={(e) => {
                  const box = containerRef.current?.getBoundingClientRect();
                  const cell = e.currentTarget.getBoundingClientRect();
                  if (!box) return;
                  set({
                    d,
                    h,
                    x: cell.left - box.left + cell.width / 2,
                    y: cell.top - box.top,
                    cw: box.width,
                  });
                }}
              />
            ))}
          </div>
        ))}
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            className="text-[10px] text-center mt-1"
            style={{ color: COLORS.t4 }}
          >
            {h % 6 === 0 ? hourLabel(h) : ""}
          </div>
        ))}
      </div>
      {tip && (
        <Tooltip
          visible={hover !== null}
          x={tip.x}
          y={tip.y}
          containerWidth={tip.cw}
        >
          <div className="mb-1" style={{ color: COLORS.t3 }}>
            {WEEKDAYS[tip.d]} · {hourLabel(tip.h)}–{hourLabel((tip.h + 1) % 24)}
          </div>
          <TooltipRow label={unit} value={String(grid[tip.d][tip.h])} />
        </Tooltip>
      )}
    </div>
  );
}

// ─── Funnel ─────────────────────────────────────────────────────────────────

export function Funnel({
  steps,
}: {
  steps: { key: string; label: string; value: number }[];
}) {
  const mounted = useMounted();
  const first = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const conv = prev ? s.value / prev : null;
        return (
          <li key={s.key}>
            <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span style={{ color: COLORS.t2 }}>{s.label}</span>
              <span className="tabular-nums shrink-0">
                <span className="font-semibold" style={{ color: COLORS.w }}>
                  {s.value.toLocaleString("en-US")}
                </span>
                <span className="ml-2 text-[11px]" style={{ color: COLORS.t4 }}>
                  {i === 0
                    ? "100%"
                    : `${Math.round((s.value / first) * 100)}% · ${conv === null ? "—" : `${Math.round(conv * 100)}% of prev`}`}
                </span>
              </span>
            </div>
            <div
              className="mt-1.5 h-[10px] rounded-full overflow-hidden"
              style={{ background: COLORS.surfaceLight }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{
                  width: mounted ? `${(s.value / first) * 100}%` : "0%",
                  background: COLORS.accent,
                  opacity: 1 - i * 0.12,
                  transitionDelay: `${i * 60}ms`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

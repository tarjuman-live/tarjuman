"use client";

import Link from "next/link";
import { useMemo, useState, type FocusEvent } from "react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { api } from "../../../../../convex/_generated/api";
import { COLORS } from "@/lib/constants";
import { Skeleton } from "@/components/shared/skeleton";
import { useNow } from "@/components/admin/admin-context";
import {
  Avatar,
  Badge,
  EmptyHint,
  GhostButton,
  Segmented,
  Switch,
} from "@/components/admin/ui";
import {
  dateTime,
  duration,
  int,
  pairName,
  timeAgo,
} from "@/components/admin/format";

/**
 * /admin/sessions — every session across every user, newest first.
 *
 * Rows are transcript-free (listSessions never returns text); opening one goes
 * through the audited openSessionForAdmin mutation on the detail page.
 */

type StatusFilter = "all" | "recording" | "paused" | "completed";
type SessionRow = FunctionReturnType<
  typeof api.adminPanel.listSessions
>["page"][number];

const PAGE_SIZE = 30;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "recording", label: "Live" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

/** Desktop column template — shared by the header row and every data row. */
const GRID_COLS =
  "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_64px_52px_88px_112px]";

export default function AdminSessionsPage() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [hideEmpty, setHideEmpty] = useState(true);
  const now = useNow();
  const [listRef] = useAutoAnimate<HTMLDivElement>({
    duration: 220,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });

  const { results, status, loadMore } = usePaginatedQuery(
    api.adminPanel.listSessions,
    filter === "all" ? {} : { status: filter },
    { initialNumItems: PAGE_SIZE },
  );

  const rows = useMemo(
    () => (hideEmpty ? results.filter((r) => r.segmentCount > 0) : results),
    [results, hideEmpty],
  );
  const hiddenCount = results.length - rows.length;
  const firstLoad = status === "LoadingFirstPage";
  const canLoadMore = status === "CanLoadMore" || status === "LoadingMore";

  return (
    <div className="flex flex-col animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          options={STATUS_OPTIONS}
          value={filter}
          onChange={setFilter}
          ariaLabel="Session status"
        />
        <Switch checked={hideEmpty} onChange={setHideEmpty} label="Hide empty" />
        <span
          className="ml-auto text-[11.5px] tabular-nums transition-opacity duration-200"
          style={{ color: COLORS.t3, opacity: firstLoad ? 0.6 : 1 }}
        >
          {firstLoad
            ? "Loading…"
            : `${int(rows.length)} shown${status === "Exhausted" ? "" : " · more available"}`}
        </span>
      </div>

      <p className="mt-2 text-[11.5px] leading-snug" style={{ color: COLORS.t4 }}>
        Empty rows are /record tabs that opened the mic but never transcribed —
        the hourly sweep deletes them after 6h.
        {hideEmpty && hiddenCount > 0
          ? ` ${int(hiddenCount)} hidden in the loaded rows.`
          : ""}
        {filter !== "all" ? " Filtered views are ordered by last save." : ""}
      </p>

      {/* Desktop column header (rows carry a 1px border; header pads to match). */}
      <div
        className={`hidden md:grid ${GRID_COLS} md:gap-3 mt-4 px-[15px] pb-2 text-[10.5px] font-bold uppercase tracking-wider`}
        style={{ color: COLORS.t4 }}
        aria-hidden
      >
        <span>Session</span>
        <span>Owner</span>
        <span className="text-right">Length</span>
        <span className="text-right">Segs</span>
        <span>Status</span>
        <span className="text-right">Created</span>
      </div>

      <div ref={listRef} className="mt-3 md:mt-0 flex flex-col gap-1.5">
        {firstLoad &&
          Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={`sk-${i}`} style={{ height: 62 }} rounded={12} />
          ))}

        {!firstLoad &&
          rows.map((row) => <SessionRowLink key={row.id} row={row} now={now} />)}

        {!firstLoad && rows.length === 0 && (
          <div key="empty" className="rounded-2xl" style={{ border: `1px dashed ${COLORS.borderLight}` }}>
            <EmptyHint>
              {results.length > 0
                ? canLoadMore
                  ? "Only empty sessions in the loaded rows — load more to keep looking."
                  : "Only empty sessions here. Turn off “Hide empty” to see them."
                : filter === "recording"
                  ? "Nobody is recording right now."
                  : filter === "paused"
                    ? "No paused sessions."
                    : "No sessions yet."}
            </EmptyHint>
          </div>
        )}
      </div>

      {canLoadMore && (
        <div className="mt-4 flex justify-center animate-in fade-in duration-200 motion-reduce:animate-none">
          <GhostButton
            onClick={() => loadMore(PAGE_SIZE)}
            disabled={status === "LoadingMore"}
          >
            {status === "LoadingMore" ? "Loading…" : "Load more"}
          </GhostButton>
        </div>
      )}
    </div>
  );
}

/** Hover / keyboard-focus "lit" state for the house green outline-glow. */
function useLit() {
  const [lit, setLit] = useState(false);
  return [
    lit,
    {
      onPointerEnter: () => setLit(true),
      onPointerLeave: () => setLit(false),
      onFocus: (e: FocusEvent<HTMLElement>) => {
        if (e.currentTarget.matches(":focus-visible")) setLit(true);
      },
      onBlur: () => setLit(false),
    },
  ] as const;
}

function SessionRowLink({ row, now }: { row: SessionRow; now: number }) {
  const [lit, litHandlers] = useLit();
  const title = row.title?.trim() || "Untitled";
  const pair = pairName(`${row.sourceLanguage}→${row.targetLanguage}`);

  return (
    <Link
      href={`/admin/sessions/${row.id}`}
      {...litHandlers}
      className={`block md:grid ${GRID_COLS} md:items-center md:gap-3 rounded-xl px-3.5 py-3 outline-none`}
      style={{
        background: lit ? COLORS.surfaceLight : COLORS.surface,
        border: `1px solid ${lit ? `${COLORS.accent}66` : COLORS.border}`,
        boxShadow: lit ? `0 0 16px ${COLORS.accent}1f` : "0 0 0 transparent",
        transition:
          "background-color 200ms ease, border-color 200ms ease, box-shadow 200ms ease",
      }}
    >
      {/* ── Mobile: stacked card ─────────────────────────────────────── */}
      <div className="md:hidden flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span
            className="truncate text-[14px] font-semibold"
            style={{ color: row.title ? COLORS.w : COLORS.t3 }}
          >
            {title}
          </span>
          <StatusBadge status={row.status} />
        </div>
        <OwnerLine row={row} />
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] tabular-nums"
          style={{ color: COLORS.t3 }}
        >
          <span>{pair}</span>
          <Dot />
          <span>{duration(row.seconds)}</span>
          <Dot />
          <span>{int(row.segmentCount)} segs</span>
          <ExtraBadges row={row} />
        </div>
        <div className="text-[11.5px] tabular-nums" style={{ color: COLORS.t4 }}>
          {dateTime(row.createdAt)} · {timeAgo(row.createdAt, now)}
        </div>
      </div>

      {/* ── Desktop: one table-like line ─────────────────────────────── */}
      <div className="hidden md:flex flex-col gap-0.5 min-w-0">
        <span
          className="truncate text-[13.5px] font-semibold"
          style={{ color: row.title ? COLORS.w : COLORS.t3 }}
        >
          {title}
        </span>
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-[11.5px]" style={{ color: COLORS.t3 }}>
            {pair}
          </span>
          <ExtraBadges row={row} />
        </span>
      </div>
      <div className="hidden md:flex min-w-0">
        <OwnerLine row={row} />
      </div>
      <div
        className="hidden md:block text-right text-[12.5px] tabular-nums"
        style={{ color: COLORS.t2 }}
      >
        {duration(row.seconds)}
      </div>
      <div
        className="hidden md:block text-right text-[12.5px] tabular-nums"
        style={{ color: row.segmentCount > 0 ? COLORS.t2 : COLORS.t4 }}
      >
        {int(row.segmentCount)}
      </div>
      <div className="hidden md:flex">
        <StatusBadge status={row.status} />
      </div>
      <div className="hidden md:flex flex-col items-end min-w-0">
        <span className="text-[12px] tabular-nums whitespace-nowrap" style={{ color: COLORS.t2 }}>
          {dateTime(row.createdAt)}
        </span>
        <span className="text-[11px] tabular-nums" style={{ color: COLORS.t4 }}>
          {timeAgo(row.createdAt, now)}
        </span>
      </div>
    </Link>
  );
}

function OwnerLine({ row }: { row: SessionRow }) {
  if (!row.owner) {
    return (
      <span className="text-[12px] italic" style={{ color: COLORS.t4 }}>
        {row.userId ? "deleted user" : "no owner"}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 min-w-0">
      <Avatar
        size={24}
        image={row.owner.image}
        name={row.owner.name}
        email={row.owner.email}
      />
      <span className="truncate text-[12.5px]" style={{ color: COLORS.t2 }}>
        {row.owner.email ?? row.owner.name ?? row.owner.id}
      </span>
    </span>
  );
}

function StatusBadge({ status }: { status: SessionRow["status"] }) {
  if (status === "recording") {
    return (
      <Badge tone="red">
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse motion-reduce:animate-none"
          style={{ background: COLORS.red }}
        />
        Live
      </Badge>
    );
  }
  if (status === "paused") return <Badge tone="amber">Paused</Badge>;
  return <Badge>Completed</Badge>;
}

function ExtraBadges({ row }: { row: SessionRow }) {
  return (
    <>
      {row.hasSummary && <Badge tone="accent">Summary</Badge>}
      {row.platform && (
        <Badge tone={row.platform === "ios" ? "blue" : "muted"}>
          {row.platform === "ios" ? "iOS" : "Web"}
        </Badge>
      )}
    </>
  );
}

function Dot() {
  return (
    <span aria-hidden style={{ color: COLORS.t4 }}>
      ·
    </span>
  );
}

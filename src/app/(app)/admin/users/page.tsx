"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { api } from "../../../../../convex/_generated/api";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { Skeleton } from "@/components/shared/skeleton";
import { useNow } from "@/components/admin/admin-context";
import {
  Avatar,
  Badge,
  EmptyHint,
  GhostButton,
  PlanPill,
  ProviderBadges,
  Segmented,
} from "@/components/admin/ui";
import { hours, int, shortDate, timeAgo } from "@/components/admin/format";

type Sort = "newest" | "most_active" | "recent";
type UserRow = FunctionReturnType<typeof api.adminPanel.listUsers>["page"][number];

const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "most_active", label: "Most active" },
  { value: "recent", label: "Recently active" },
];

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Desktop column template, shared by the header row and every data row so the
 * columns line up: user · sessions · recorded · joined · active. Below `md`
 * each row stacks as a card instead.
 */
const COLS = "md:grid-cols-[minmax(0,1fr)_72px_84px_80px_92px]";

export default function AdminUsersPage() {
  const now = useNow();
  const [sort, setSort] = useState<Sort>("newest");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const searching = debounced.length > 0;

  const { results, status, loadMore } = usePaginatedQuery(
    api.adminPanel.listUsers,
    { sort, search: debounced || undefined },
    { initialNumItems: PAGE_SIZE },
  );

  // House convention for filtered lists: FLIP add/remove/reorder.
  const [listRef] = useAutoAnimate<HTMLDivElement>({
    duration: 220,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });

  const loadingFirst = status === "LoadingFirstPage";
  const empty = !loadingFirst && results.length === 0;

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2.5">
        <div
          className="flex items-center gap-2 px-4 h-11 rounded-2xl flex-1 min-w-0"
          style={{ background: COLORS.surface, border: `1px solid ${COLORS.borderLight}` }}
        >
          <Icon name="search" size={14} color={COLORS.t4} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or user ID"
            aria-label="Search users"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-text-4)] [&::-webkit-search-cancel-button]:hidden"
            style={{ color: COLORS.w }}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setDebounced("");
              }}
              aria-label="Clear search"
              className="grid place-items-center w-5 h-5 rounded-full cursor-pointer animate-in fade-in zoom-in-75 duration-150 motion-reduce:animate-none"
              style={{ background: COLORS.surfaceLight }}
            >
              <Icon name="close" size={10} color={COLORS.t3} />
            </button>
          )}
        </div>
        {/* Search ignores sort server-side — dim + disable to say so. */}
        <div
          inert={searching}
          aria-disabled={searching}
          title={searching ? "Sort doesn't apply while searching" : undefined}
          className="transition-opacity duration-200 motion-reduce:transition-none [&>div]:w-full md:[&>div]:w-auto [&_button]:px-1.5 sm:[&_button]:px-3 [&_button]:truncate"
          style={{ opacity: searching ? 0.4 : 1 }}
        >
          <Segmented ariaLabel="Sort users" options={SORTS} value={sort} onChange={setSort} />
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3 mt-2.5 mb-4">
        <p
          key={searching ? "search" : "sort"}
          className="text-[11.5px] leading-snug animate-in fade-in duration-200 motion-reduce:animate-none"
          style={{ color: COLORS.t4 }}
        >
          {searching
            ? "Search scans the newest 5,000 accounts and shows the first 50 matches — sort doesn't apply."
            : "Activity sorts use stats computed at the last dashboard refresh, and only list users who have recorded."}
        </p>
        {!loadingFirst && results.length > 0 && (
          <span
            className="text-[11.5px] tabular-nums shrink-0 animate-in fade-in duration-200 motion-reduce:animate-none"
            style={{ color: COLORS.t3 }}
          >
            {int(results.length)}
            {status === "CanLoadMore" ? "+" : ""} {searching ? "matches" : "users"}
          </span>
        )}
      </div>

      {/* Desktop column header */}
      {!empty && (
        <div
          className={`hidden md:grid ${COLS} gap-x-4 px-3.5 pb-2 border border-transparent text-[10.5px] font-bold uppercase tracking-wider`}
          style={{ color: COLORS.t4 }}
        >
          <span>User</span>
          <HeaderCell active={false}>Sessions</HeaderCell>
          <HeaderCell active={!searching && sort === "most_active"}>Recorded</HeaderCell>
          <HeaderCell active={!searching && sort === "newest"}>Joined</HeaderCell>
          <HeaderCell active={!searching && sort === "recent"}>Active</HeaderCell>
        </div>
      )}

      {loadingFirst && (
        <div className="flex flex-col gap-2 animate-in fade-in duration-200 motion-reduce:animate-none">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} style={{ height: 66 }} rounded={12} />
          ))}
        </div>
      )}

      <div ref={listRef} className="flex flex-col gap-2">
        {results.map((u) => (
          <UserRowLink key={u.id} u={u} now={now} />
        ))}
      </div>

      {empty && (
        <div
          className="rounded-2xl animate-in fade-in duration-200 motion-reduce:animate-none"
          style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
        >
          <EmptyHint>
            {searching ? (
              <>
                No users match &ldquo;{debounced}&rdquo;.
                <div className="mt-3">
                  <GhostButton
                    onClick={() => {
                      setQuery("");
                      setDebounced("");
                    }}
                  >
                    Clear search
                  </GhostButton>
                </div>
              </>
            ) : sort === "newest" ? (
              "No users yet."
            ) : (
              "No activity stats yet — hit Refresh to compute them."
            )}
          </EmptyHint>
        </div>
      )}

      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <div className="flex justify-center mt-4">
          <GhostButton onClick={() => loadMore(PAGE_SIZE)} disabled={status === "LoadingMore"}>
            {status === "LoadingMore" ? "Loading…" : "Load more"}
          </GhostButton>
        </div>
      )}
    </div>
  );
}

/** Column label; the column the current sort keys on reads a step brighter. */
function HeaderCell({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className="text-right transition-colors duration-200"
      style={{ color: active ? COLORS.t2 : COLORS.t4 }}
    >
      {children}
      {active && <span aria-hidden> ↓</span>}
    </span>
  );
}

function UserRowLink({ u, now }: { u: UserRow; now: number }) {
  const [lit, setLit] = useState(false);
  const s = u.stats;
  const active = s?.lastRecordedAt ? timeAgo(s.lastRecordedAt, now) : s ? "never" : "—";
  return (
    <Link
      href={`/admin/users/${u.id}`}
      onPointerEnter={() => setLit(true)}
      onPointerLeave={() => setLit(false)}
      onFocus={() => setLit(true)}
      onBlur={() => setLit(false)}
      className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLS} items-center gap-x-4 gap-y-1.5 px-3.5 py-3 rounded-xl outline-none`}
      style={{
        background: COLORS.surface,
        border: `1px solid ${lit ? COLORS.accent : COLORS.border}`,
        boxShadow: lit
          ? `0 0 0 1px ${COLORS.accent}, 0 0 16px rgba(46,204,113,0.4)`
          : "0 0 0 0 transparent",
        transition: "border-color 200ms ease, box-shadow 200ms ease",
      }}
    >
      {/* Identity */}
      <div className="flex items-center gap-3 min-w-0">
        <Avatar image={u.image} name={u.name} email={u.email} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-1.5 gap-y-1 flex-wrap md:flex-nowrap min-w-0">
            <span
              className="text-[13.5px] font-semibold truncate min-w-0"
              style={{ color: u.name ? COLORS.w : COLORS.t3 }}
            >
              {u.name ?? "—"}
            </span>
            <span className="inline-flex items-center gap-1 flex-wrap md:flex-nowrap md:shrink-0">
              <PlanPill plan={u.plan} source={u.planSource} />
              <ProviderBadges providers={u.providers} />
              {u.isAdmin && <Badge tone="blue">Admin</Badge>}
              {u.isTest && <Badge>Test</Badge>}
              {!u.verified && <Badge tone="amber">Unverified</Badge>}
            </span>
          </div>
          <div className="text-[12px] truncate mt-0.5" style={{ color: COLORS.t3 }}>
            {u.email ?? "No email"}
          </div>
        </div>
      </div>

      {/* Mobile: compact activity on the right */}
      <div className="md:hidden text-right tabular-nums self-start pt-0.5">
        <div className="text-[13px] font-semibold" style={{ color: s ? COLORS.w : COLORS.t4 }}>
          {s ? int(s.sessions) : "—"}
          <span className="text-[11px] font-medium ml-1" style={{ color: COLORS.t3 }}>
            {s?.sessions === 1 ? "session" : "sessions"}
          </span>
        </div>
        <div className="text-[11.5px]" style={{ color: COLORS.t3 }}>
          {s ? hours(s.recordingSeconds) : "—"}
        </div>
      </div>

      {/* Desktop cells */}
      <Cell strong={Boolean(s)}>{s ? int(s.sessions) : "—"}</Cell>
      <Cell strong={Boolean(s)}>{s ? hours(s.recordingSeconds) : "—"}</Cell>
      <Cell>{shortDate(u.createdAt)}</Cell>
      <Cell>{active}</Cell>

      {/* Mobile: dates line under the identity block */}
      <div
        className="md:hidden col-span-2 pl-12 text-[11px] tabular-nums"
        style={{ color: COLORS.t4 }}
      >
        Joined {shortDate(u.createdAt)} · Active {active}
      </div>
    </Link>
  );
}

function Cell({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <div
      className="hidden md:block text-right text-[12.5px] tabular-nums truncate"
      style={{ color: strong ? COLORS.w : COLORS.t3 }}
    >
      {children}
    </div>
  );
}

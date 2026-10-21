"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type {
  DashboardData,
  DashboardView,
} from "../../../convex/adminMetrics";

/**
 * Shared state for every /admin tab: the precomputed dashboard snapshot, the
 * refresh lifecycle, and the two filters (range, team exclusion) that scope
 * every chart below them.
 *
 * Refresh model (see convex/adminStats.ts): there is no recurring full scan.
 * Opening /admin on a snapshot older than STALE_MS — or one written by an older
 * code version (schemaVersion mismatch) — triggers ONE recompute; the header's
 * Refresh button triggers another. The server leases + throttles, so several
 * open tabs can't stampede it.
 */

export type RangeDays = 7 | 30 | 90;
export type ViewKey = "everyone" | "external";

export interface TopSpender {
  userId: string;
  email: string | null;
  name: string | null;
  calls: number;
  costMicroUsd: number;
}

export type Snapshot = DashboardData & { topSpenders: TopSpender[] };

export interface ActiveAlert {
  kind: string;
  message: string;
  since: number;
}

const STALE_MS = 15 * 60 * 1000;
/** A server lease older than this is presumed crashed (matches adminStats). */
const LEASE_TTL_MS = 5 * 60 * 1000;

interface AdminCtx {
  data: Snapshot | null;
  /** True until the first snapshot query resolves. */
  loading: boolean;
  computedAt: number | null;
  durationMs: number | null;
  refreshing: boolean;
  refreshError: string | null;
  refresh: () => void;
  range: RangeDays;
  setRange: (r: RangeDays) => void;
  viewKey: ViewKey;
  setViewKey: (v: ViewKey) => void;
  view: DashboardView | null;
  alerts: ActiveAlert[];
}

const Ctx = createContext<AdminCtx | null>(null);

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const res = useQuery(api.adminPanel.getSnapshot);
  const refreshNow = useAction(api.adminStats.refreshNow);
  const [pending, setPending] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeDays>(30);
  const [viewKey, setViewKey] = useState<ViewKey>("everyone");
  const autoTriggered = useRef(false);

  const refresh = useCallback(() => {
    setPending(true);
    setRefreshError(null);
    refreshNow({})
      .then((r) => {
        if (!r.started) {
          setRefreshError("A refresh ran moments ago — try again in a minute.");
        }
      })
      .catch((e: unknown) =>
        setRefreshError(e instanceof Error ? e.message : "Refresh failed"),
      )
      .finally(() => setPending(false));
  }, [refreshNow]);

  const snap = res?.snapshot ?? null;
  const fresh =
    snap !== null && res !== undefined && snap.schemaVersion === res.currentSchemaVersion;

  // One automatic recompute per visit when the snapshot is missing, stale, or
  // from an older code version.
  useEffect(() => {
    if (res === undefined || autoTriggered.current) return;
    const stale =
      !snap ||
      snap.schemaVersion !== res.currentSchemaVersion ||
      Date.now() - snap.computedAt > STALE_MS;
    if (!stale) return;
    // Deferred a tick so the refresh's own state updates don't run inside the
    // effect body; the ref is set when it actually fires (StrictMode-safe).
    const id = setTimeout(() => {
      autoTriggered.current = true;
      refresh();
    }, 0);
    return () => clearTimeout(id);
  }, [res, snap, refresh]);

  const serverRefreshing = useMemo(() => {
    if (!res?.refreshStartedAt) return false;
    const finished = res.refreshFinishedAt ?? 0;
    return (
      finished < res.refreshStartedAt &&
      // eslint-disable-next-line react-hooks/purity -- lease age check; re-evaluated whenever the lease row changes
      Date.now() - res.refreshStartedAt < LEASE_TTL_MS
    );
  }, [res?.refreshStartedAt, res?.refreshFinishedAt]);

  const data = fresh ? (snap.data as Snapshot) : null;

  const value: AdminCtx = {
    data,
    loading: res === undefined,
    computedAt: snap?.computedAt ?? null,
    durationMs: snap?.durationMs ?? null,
    refreshing: pending || serverRefreshing,
    refreshError,
    refresh,
    range,
    setRange,
    viewKey,
    setViewKey,
    view: data ? data[viewKey] : null,
    alerts: (res?.alerts ?? []) as ActiveAlert[],
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminDataProvider>");
  return ctx;
}

/** Wall clock that ticks every `ms` — for "3m ago" labels without impure renders. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

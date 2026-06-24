"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Reactive plan + this-month usage for the signed-in user. Backs the record and
 * summary gates and the Settings usage line. Mirrors the loading model of the
 * other Convex hooks: `undefined` while loading OR unauthenticated (the query
 * returns null then), the usage object once resolved.
 *
 * `sessionsLimit` / `summariesLimit` are `null` when unlimited (Pro/Scholar).
 */
export interface PlanUsage {
  plan: "free" | "pro";
  sessionsUsed: number;
  summariesUsed: number;
  sessionsLimit: number | null;
  summariesLimit: number | null;
  canStartSession: boolean;
  canSummarize: boolean;
}

export function usePlan(): PlanUsage | undefined {
  const usage = useQuery(api.subscriptions.getMyUsageThisMonth, {});
  return usage ?? undefined;
}

export function useIsPro(): boolean | undefined {
  const plan = usePlan();
  if (plan === undefined) return undefined;
  return plan.plan === "pro";
}

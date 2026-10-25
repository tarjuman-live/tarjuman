"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { PlanUsageWire } from "../../convex/billingLimits";

/**
 * Reactive plan + this-month usage for the signed-in user. Backs the record and
 * summary gates and the Settings usage line. Mirrors the loading model of the
 * other Convex hooks: `undefined` while loading OR unauthenticated (the query
 * returns null then), the usage object once resolved.
 *
 * Limits are `null` when unlimited — and ALL of them are null while billing is
 * off. `recordingSecondsRemaining` excludes the in-progress recording (it only
 * reaches the ledger on completion), so the record page compares it straight
 * against its live timer.
 */
export type PlanUsage = PlanUsageWire;

export function usePlan(): PlanUsage | undefined {
  const usage = useQuery(api.subscriptions.getMyUsageThisMonth, {});
  return usage ?? undefined;
}

export function useIsPro(): boolean | undefined {
  const plan = usePlan();
  if (plan === undefined) return undefined;
  return plan.plan === "pro";
}

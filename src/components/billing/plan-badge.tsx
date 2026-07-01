"use client";

import { usePlan } from "@/hooks/use-plan";
import { COLORS } from "@/lib/constants";

/**
 * Small tier symbol shown once a user is on a paid plan (Pro / Scholar).
 * Renders nothing for free or while loading — so it's invisible until someone
 * actually upgrades, and never shows on the live site while everyone is free.
 */
const TIER: Record<string, { label: string; color: string; soft: string }> = {
  pro: { label: "Pro", color: COLORS.accent, soft: COLORS.accentSoft },
  scholar: { label: "Scholar", color: COLORS.amber, soft: COLORS.amberSoft },
};

export function PlanBadge({ className = "" }: { className?: string }) {
  const plan = usePlan();
  const meta = plan ? TIER[plan.plan] : undefined;
  if (!meta) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-[6px] py-[2px] rounded-md ${className}`}
      style={{ background: meta.soft, color: meta.color }}
    >
      ✦ {meta.label}
    </span>
  );
}

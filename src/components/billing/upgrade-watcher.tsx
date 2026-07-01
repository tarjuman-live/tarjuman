"use client";

import { useEffect, useState } from "react";
import { usePlan } from "@/hooks/use-plan";
import { SHOW_PRICING } from "@/lib/constants";
import { UpgradeCelebration } from "./upgrade-celebration";
import type { Plan } from "../../../convex/billingLimits";

/**
 * Fires the one-time upgrade-celebration popup when the user's plan flips to a
 * paid tier. Mounted once in the app shell so it catches the transition even
 * across the post-checkout redirect (which is a fresh page load) via a
 * localStorage marker.
 *
 * Gated behind SHOW_PRICING (localhost-only) so the whole upgrade surface stays
 * dormant on the live site until billing launches — flip SHOW_PRICING (and
 * BILLING_ENABLED) at go-live to activate it everywhere.
 */
const CELEBRATED_KEY = "tarjuman:celebrated-plan";

export function UpgradeWatcher() {
  const plan = usePlan();
  const [celebrate, setCelebrate] = useState<Plan | null>(null);

  useEffect(() => {
    if (!SHOW_PRICING || !plan) return;
    const current = plan.plan; // "free" | "pro"

    let last: string | null = null;
    try {
      last = localStorage.getItem(CELEBRATED_KEY);
    } catch {
      /* private mode */
    }

    if (current === "free") {
      // Reset so a future upgrade celebrates again.
      if (last) {
        try {
          localStorage.removeItem(CELEBRATED_KEY);
        } catch {
          /* ignore */
        }
      }
      return;
    }

    // Paid tier — celebrate once per upgrade (persisted across the checkout
    // redirect so it doesn't re-fire on every later load).
    if (last !== current) {
      try {
        localStorage.setItem(CELEBRATED_KEY, current);
      } catch {
        /* ignore */
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCelebrate(current as Plan);
    }
  }, [plan]);

  if (!celebrate) return null;
  return (
    <UpgradeCelebration
      open
      plan={celebrate}
      onClose={() => setCelebrate(null)}
    />
  );
}

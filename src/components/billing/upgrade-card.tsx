"use client";

import Link from "next/link";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

/**
 * Shown when a free user hits a monthly limit (record sessions / summaries).
 * A calm, on-brand nudge — restrained, not a hard paywall wall — that routes to
 * Settings where Checkout lives. Reused by the record page + SessionBody.
 */
export function UpgradeCard({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.accent}30`,
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon name="sparkle" size={15} color={COLORS.accent} />
        <span className="text-[14px] font-bold" style={{ color: COLORS.w }}>
          {title}
        </span>
      </div>
      <p
        className="text-[12.5px] leading-relaxed mb-3"
        style={{ color: COLORS.t3 }}
      >
        {message}
      </p>
      <Link
        href="/plans"
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-bold transition-transform active:scale-[0.98]"
        style={{
          background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
          color: "#0A0F1C",
        }}
      >
        Upgrade
        <Icon name="chevron" size={14} color="#0A0F1C" />
      </Link>
    </div>
  );
}

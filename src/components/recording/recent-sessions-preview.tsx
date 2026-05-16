"use client";

import Link from "next/link";
import { COLORS } from "@/lib/constants";
import { formatDate, formatDuration, getLangName } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { useRecentSessions } from "@/hooks/use-sessions";

export function RecentSessionsPreview() {
  const sessions = useRecentSessions(3);

  // Loading (server / pre-hydration): render nothing — this preview is
  // optional, keep the idle screen quiet.
  if (sessions === undefined) return null;

  // Empty: don't show the section header at all on a fresh install.
  if (sessions.length === 0) return null;

  return (
    <div>
      <div className="section-label mb-3">Recent</div>
      {sessions.map((s) => {
        const title = s.title ?? "Untitled session";
        return (
          <Link
            key={s._id}
            href={`/session/${s._id}`}
            className="w-full flex items-center gap-3 px-5 py-4 rounded-[20px] mb-[10px] cursor-pointer transition-colors"
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div
              className="w-10 h-10 rounded-2xl grid place-items-center flex-shrink-0"
              style={{
                background: COLORS.surfaceLight,
                border: `1px solid ${COLORS.borderLight}`,
              }}
            >
              <Icon name="doc" size={16} color={COLORS.t3} />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="text-[14px] font-semibold truncate mb-0.5"
                style={{ color: COLORS.w }}
              >
                {title}
              </div>
              <div className="text-[11px]" style={{ color: COLORS.t4 }}>
                {getLangName(s.sourceLanguage)} →{" "}
                {getLangName(s.targetLanguage)} · {formatDate(s.createdAt)}
              </div>
            </div>
            <span
              className="text-xs tabular-nums"
              style={{ color: COLORS.t3 }}
            >
              {formatDuration(s.duration)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

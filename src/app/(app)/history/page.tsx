"use client";

import { useMemo, useState } from "react";
import { COLORS } from "@/lib/constants";
import { getLangName } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { SessionCard } from "@/components/session/session-card";
import { useAllSessions } from "@/hooks/use-sessions";

export default function HistoryPage() {
  const sessions = useAllSessions();
  const [query, setQuery] = useState("");

  // Filter by title text + language names + summary text. Simple
  // case-insensitive substring match — fine until you have hundreds of
  // sessions.
  const filtered = useMemo(() => {
    if (!sessions) return undefined;
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const haystack = [
        s.title ?? "",
        getLangName(s.sourceLanguage),
        getLangName(s.targetLanguage),
        s.summary ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sessions, query]);

  const total = sessions?.length ?? 0;
  const visible = filtered?.length ?? 0;

  return (
    <div className="flex flex-col flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+84px)]">
      <div
        className="px-5 py-5"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <div className="section-label mb-1">History</div>
        <div className="flex items-baseline justify-between mb-4">
          <div className="text-2xl font-bold" style={{ color: COLORS.w }}>
            Your sessions
          </div>
          <div className="text-[12px]" style={{ color: COLORS.t3 }}>
            {sessions === undefined
              ? "Loading…"
              : query.trim()
                ? `${visible} of ${total}`
                : total === 1
                  ? "1 session"
                  : `${total} sessions`}
          </div>
        </div>

        {total > 0 && (
          <div
            className="flex items-center gap-2 px-4 h-11 rounded-2xl"
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.borderLight}`,
            }}
          >
            <Icon name="globe" size={14} color={COLORS.t4} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, language, or summary…"
              className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-text-4)]"
              style={{ color: COLORS.w }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="grid place-items-center w-5 h-5 rounded-full"
                style={{ background: COLORS.surfaceLight }}
              >
                <Icon name="close" size={10} color={COLORS.t3} />
              </button>
            )}
          </div>
        )}
      </div>

      {sessions !== undefined && total === 0 && (
        <div className="flex-1 grid place-items-center px-8 text-center">
          <div>
            <div className="text-sm" style={{ color: COLORS.t3 }}>
              Your recorded sessions will appear here.
            </div>
            <div className="text-xs mt-1" style={{ color: COLORS.t4 }}>
              Tap the mic to start your first one.
            </div>
          </div>
        </div>
      )}

      {sessions !== undefined && total > 0 && visible === 0 && (
        <div className="flex-1 grid place-items-center px-8 text-center">
          <div>
            <div className="text-sm" style={{ color: COLORS.t3 }}>
              No sessions match &ldquo;{query}&rdquo;.
            </div>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-2 text-xs font-semibold underline"
              style={{ color: COLORS.accent }}
            >
              Clear search
            </button>
          </div>
        </div>
      )}

      {filtered !== undefined && filtered.length > 0 && (
        <div className="flex-1 overflow-auto px-5 py-4">
          {filtered.map((s) => (
            <SessionCard key={s._id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

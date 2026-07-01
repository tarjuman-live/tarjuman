"use client";

import { useMemo, useState } from "react";
import { COLORS } from "@/lib/constants";
import { getLangName } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { Skeleton } from "@/components/shared/skeleton";
import { SessionCard } from "@/components/session/session-card";
import { useAllSessions } from "@/hooks/use-sessions";
import { useLocale } from "@/lib/i18n/locale-context";

export default function HistoryPage() {
  const sessions = useAllSessions();
  const { t } = useLocale();
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
    <div className="flex flex-col flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+84px)] lg:pb-8 lg:max-w-4xl lg:mx-auto lg:w-full">
      <div
        className="px-5 py-5"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <div className="section-label mb-1">{t("nav.history")}</div>
        <div className="flex items-baseline justify-between mb-4">
          <div className="text-2xl font-bold" style={{ color: COLORS.w }}>
            {t("history.title")}
          </div>
          <div className="text-[12px]" style={{ color: COLORS.t3 }}>
            {sessions === undefined
              ? t("history.loading")
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
              placeholder={t("history.searchPlaceholder")}
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

      {sessions === undefined && (
        <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ width: "100%", height: 84 }} rounded={16} />
          ))}
        </div>
      )}

      {sessions !== undefined && total === 0 && (
        <div className="flex-1 grid place-items-center px-8 text-center">
          <div>
            <div className="text-sm" style={{ color: COLORS.t3 }}>
              {t("history.emptyTitle")}
            </div>
            <div className="text-xs mt-1" style={{ color: COLORS.t4 }}>
              {t("history.emptySub")}
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
              {t("history.clearSearch")}
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

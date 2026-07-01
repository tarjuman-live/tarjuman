"use client";

import { useEffect, useRef, useState } from "react";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { UI_LOCALES } from "@/lib/i18n/locales";
import { useLocale } from "@/lib/i18n/locale-context";

/**
 * App-language picker (globe). `compact` shows just the globe (for the record
 * header); otherwise it shows the current language's native name (for Settings).
 */
export function LocaleSwitcher({
  compact = false,
  dropUp = false,
}: {
  compact?: boolean;
  dropUp?: boolean;
}) {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = UI_LOCALES.find((l) => l.code === locale);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="App language"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors ${
          compact ? "w-9 h-9 justify-center" : "h-9 px-3"
        }`}
        style={{
          // Reads as a tile (rounded-xl on a raised surface) rather than a
          // hairline button — matches the app's tile language.
          background: compact ? COLORS.surfaceLight : COLORS.surface,
          border: `1px solid ${open ? COLORS.accent : COLORS.borderLight}`,
          color: COLORS.w,
        }}
      >
        <Icon name="globe" size={16} color={open ? COLORS.accent : COLORS.t2} />
        {!compact && (
          <span className="text-[13px] font-semibold">{current?.native}</span>
        )}
        {!compact && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute z-50 max-h-[60vh] overflow-auto min-w-[180px] rounded-xl py-1 animate-in fade-in duration-150 ${
            dropUp
              ? "start-0 bottom-full mb-1.5 slide-in-from-bottom-1"
              : "end-0 mt-1.5 slide-in-from-top-1"
          }`}
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.borderLight}`,
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
          }}
        >
          {UI_LOCALES.map((l) => {
            const selected = l.code === locale;
            return (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setLocale(l.code);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left text-[13px] font-semibold cursor-pointer transition-colors hover:bg-[var(--color-surface-light)]"
                style={{ color: selected ? COLORS.accent : COLORS.t2 }}
              >
                <span className="flex items-center gap-2">
                  <span>{l.native}</span>
                  <span className="text-[11px]" style={{ color: COLORS.t4 }}>
                    {l.label}
                  </span>
                </span>
                {selected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={COLORS.accent}
                    strokeWidth="3"
                    aria-hidden
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

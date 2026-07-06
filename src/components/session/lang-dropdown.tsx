"use client";

import { useEffect, useRef, useState } from "react";
import { COLORS, LANGUAGES } from "@/lib/constants";
import { getLangName } from "@/lib/utils";

/**
 * Compact target-language picker for the AI tools (summary language, transcript
 * translation). Same dark + green-hover style as the app-language switcher.
 */
export function LangDropdown({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="h-9 px-3 rounded-xl flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer transition-colors disabled:opacity-50"
        style={{
          background: COLORS.surfaceLight,
          border: `1px solid ${open ? COLORS.accent : COLORS.borderLight}`,
          color: COLORS.w,
        }}
      >
        {getLangName(value)}
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
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute end-0 mt-1.5 z-50 max-h-[50vh] overflow-auto min-w-[200px] rounded-xl py-1 animate-in fade-in slide-in-from-top-1 duration-150"
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.borderLight}`,
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
          }}
        >
          <div className="px-1 pb-1 flex flex-col gap-0.5">
            {LANGUAGES.map((l) => {
              const selected = l.code === value;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(l.code);
                    setOpen(false);
                  }}
                  className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left text-[13px] font-semibold cursor-pointer rounded-lg border transition-all duration-150 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] hover:shadow-[0_0_16px_rgba(46,204,113,0.35)]"
                  style={{
                    ...(selected
                      ? { borderColor: COLORS.accent, background: COLORS.accentSoft }
                      : { borderColor: "transparent" }),
                    color: selected ? COLORS.accent : COLORS.t2,
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span>{l.native}</span>
                    <span className="text-[11px]" style={{ color: COLORS.t4 }}>
                      {l.name}
                    </span>
                  </span>
                  {selected && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="3" aria-hidden>
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

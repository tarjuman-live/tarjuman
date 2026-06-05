"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { LANGUAGES } from "@/lib/constants";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

interface LanguagePickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "source" | "target";
  selected: string;
  onSelect: (code: string) => void;
}

// Strip diacritics so searching "francais" matches "Français", etc.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function LanguagePickerSheet({
  open,
  onOpenChange,
  type,
  selected,
  onSelect,
}: LanguagePickerSheetProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // When the sheet opens, clear stale search text and focus the input
  // after the open animation. Deferring the setQuery into the same timeout
  // as the focus avoids the cascading-render that comes from setting state
  // synchronously in an effect body.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setQuery("");
      inputRef.current?.focus();
    }, 150);
    return () => clearTimeout(t);
  }, [open]);

  const q = normalize(query.trim());
  const filtered = q
    ? LANGUAGES.filter((lang) => {
        return (
          normalize(lang.name).includes(q) ||
          normalize(lang.native).includes(q) ||
          lang.code.toLowerCase().includes(q)
        );
      })
    : LANGUAGES;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{
            // Light dim only — leave the heavy blur to the sheet so the
            // sheet's backdrop-filter has interesting content to refract.
            background: "rgba(6, 11, 24, 0.4)",
          }}
        />
        <Dialog.Content
          className="fixed left-1/2 -translate-x-1/2 bottom-0 z-[201] w-full max-w-[480px] max-h-[70vh] flex flex-col pt-6 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom duration-200"
          style={{
            // Liquid glass: translucent tint over a heavy frosted backdrop.
            background: "rgba(20, 28, 46, 0.6)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            borderRadius: "24px 24px 0 0",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderBottom: "none",
            // Bottom-sheet shadow rises upward; keep the top inset highlight
            // for the glass catch-light.
            boxShadow:
              "0 -24px 60px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
          }}
        >
          {/* Header */}
          <div
            className="px-6 pb-4"
            style={{ borderBottom: `1px solid ${COLORS.border}` }}
          >
            <Dialog.Title
              className="text-base font-bold"
              style={{ color: COLORS.w }}
            >
              {type === "source" ? "Source Language" : "Target Language"}
            </Dialog.Title>
            <Dialog.Description
              className="text-[13px] mt-0.5"
              style={{ color: COLORS.t3 }}
            >
              {type === "source"
                ? "Language being spoken"
                : "Language you want to read"}
            </Dialog.Description>
          </div>

          {/* Search bar */}
          <div className="px-3 pt-3 pb-2">
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-[10px]"
              style={{
                // Translucent so it reads as part of the glass material, not
                // an opaque patch (matches the prompt-dialog input).
                background: "rgba(10, 16, 30, 0.7)",
                border: `1px solid ${COLORS.borderLight}`,
              }}
            >
              <Icon name="search" size={16} color={COLORS.t3} />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search languages..."
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: COLORS.w }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  className="p-0.5 rounded hover:opacity-70 cursor-pointer"
                  aria-label="Clear search"
                >
                  <Icon name="close" size={14} color={COLORS.t3} />
                </button>
              )}
            </div>
          </div>

          {/* Scrollable language list */}
          <div className="flex-1 overflow-auto p-2 px-3">
            {filtered.length === 0 ? (
              <div
                className="text-center py-8 text-sm"
                style={{ color: COLORS.t3 }}
              >
                No languages found
              </div>
            ) : (
              filtered.map((lang) => {
                const isSelected = selected === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      onSelect(lang.code);
                      onOpenChange(false);
                    }}
                    className="w-full flex items-center justify-between px-4 py-[14px] rounded-[10px] border-0 cursor-pointer transition-colors"
                    style={{
                      background: isSelected
                        ? COLORS.accentSoft
                        : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background = COLORS.surfaceLight;
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="text-sm font-semibold"
                        style={{
                          color: isSelected ? COLORS.accent : COLORS.w,
                        }}
                      >
                        {lang.name}
                      </span>
                      <span
                        className="text-[13px]"
                        style={{ color: COLORS.t3 }}
                        dir={lang.rtl ? "rtl" : "ltr"}
                      >
                        {lang.native}
                      </span>
                    </div>
                    {isSelected && (
                      <div
                        className="w-5 h-5 rounded-full grid place-items-center"
                        style={{ background: COLORS.accent }}
                      >
                        <Icon name="check" size={12} color="#fff" />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
"use client";

import { useState } from "react";
import { COLORS } from "@/lib/constants";
import { getLangName } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { LanguagePickerSheet } from "./language-picker-sheet";

interface LanguageSelectorProps {
  sourceLang: string;
  targetLang: string;
  onChange: (next: { sourceLang: string; targetLang: string }) => void;
}

export function LanguageSelector({
  sourceLang,
  targetLang,
  onChange,
}: LanguageSelectorProps) {
  const [pickerOpen, setPickerOpen] = useState<"source" | "target" | null>(null);

  const handleSwap = () => {
    onChange({ sourceLang: targetLang, targetLang: sourceLang });
  };

  return (
    <div
      className="rounded-[24px] p-6 flex items-center gap-3"
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
      }}
    >
      {/* Source */}
      <button
        type="button"
        onClick={() => setPickerOpen("source")}
        className="flex-1 px-4 py-4 rounded-2xl text-left cursor-pointer transition-colors"
        style={{
          background: COLORS.surfaceLight,
          border: `1px solid ${COLORS.borderLight}`,
        }}
      >
        <div className="section-label mb-1">Listening to</div>
        <div className="text-[15px] font-bold" style={{ color: COLORS.w }}>
          {getLangName(sourceLang)}
        </div>
      </button>

      {/* Swap */}
      <button
        type="button"
        onClick={handleSwap}
        aria-label="Swap source and target languages"
        className="w-10 h-10 rounded-2xl grid place-items-center cursor-pointer flex-shrink-0 transition-transform active:scale-95"
        style={{
          background: COLORS.accentSoft,
          border: `1px solid ${COLORS.accent}30`,
        }}
      >
        <Icon name="swap" size={16} color={COLORS.accent} />
      </button>

      {/* Target */}
      <button
        type="button"
        onClick={() => setPickerOpen("target")}
        className="flex-1 px-4 py-4 rounded-2xl text-left cursor-pointer transition-colors"
        style={{
          background: COLORS.surfaceLight,
          border: `1px solid ${COLORS.borderLight}`,
        }}
      >
        <div className="section-label mb-1">Translate to</div>
        <div className="text-[15px] font-bold" style={{ color: COLORS.w }}>
          {getLangName(targetLang)}
        </div>
      </button>

      <LanguagePickerSheet
        open={pickerOpen !== null}
        onOpenChange={(o) => !o && setPickerOpen(null)}
        type={pickerOpen ?? "source"}
        selected={pickerOpen === "source" ? sourceLang : targetLang}
        onSelect={(code) => {
          if (pickerOpen === "source") {
            // If user picks the current target as the new source, swap instead
            if (code === targetLang) {
              onChange({ sourceLang: code, targetLang: sourceLang });
            } else {
              onChange({ sourceLang: code, targetLang });
            }
          } else if (pickerOpen === "target") {
            if (code === sourceLang) {
              onChange({ sourceLang: targetLang, targetLang: code });
            } else {
              onChange({ sourceLang, targetLang: code });
            }
          }
        }}
      />
    </div>
  );
}

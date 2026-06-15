"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A single FAQ row that opens/closes fluidly. Uses the grid-template-rows
 * 0fr ↔ 1fr technique to animate to the content's natural height (works across
 * modern browsers incl. iOS Safari) instead of the native <details> snap.
 * Accessible disclosure: a button with aria-expanded + aria-controls; the
 * answer stays in the DOM (collapsed via overflow-hidden), so it remains
 * crawlable and matches the FAQPage JSON-LD.
 */
export function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div
      className={`rounded-2xl border transition duration-300 hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-light)] hover:shadow-[0_10px_30px_rgba(46,204,113,0.18)] ${
        open
          ? "border-[var(--color-accent)] bg-[var(--color-surface-light)] shadow-[0_10px_30px_rgba(46,204,113,0.18)]"
          : "border-[var(--color-border-light)] bg-[var(--color-surface)]"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 text-left cursor-pointer px-5 py-4"
      >
        <h3 className="text-base font-medium">{q}</h3>
        <ChevronDown
          aria-hidden
          className="w-5 h-5 shrink-0 text-[var(--color-text-3)] transition-transform duration-300 motion-reduce:transition-none"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>
      <div
        id={panelId}
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-[var(--color-text-2)] text-sm leading-relaxed">
            {a}
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

/**
 * Back control for the legal pages — goes to the previous page when there's
 * history (e.g. arrived from the footer), otherwise home. Has a hover state so
 * it reads as interactive.
 */
export function LegalBack() {
  const router = useRouter();
  const onBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/");
  };
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label="Back"
      className="w-9 h-9 rounded-lg grid place-items-center cursor-pointer transition-colors hover:bg-white/10"
      style={{ background: COLORS.surface }}
    >
      <Icon name="back" size={18} color={COLORS.t2} />
    </button>
  );
}

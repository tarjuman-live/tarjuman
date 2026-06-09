import { ReactNode } from "react";
import Link from "next/link";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-full mx-auto relative flex flex-col"
      style={{
        maxWidth: 720,
        minHeight: "100dvh",
        background: COLORS.bg,
      }}
    >
      <div
        className="px-6 py-4 flex items-center gap-3"
        style={{ borderBottom: `1px solid ${COLORS.border}` }}
      >
        <Link
          href="/"
          className="w-9 h-9 rounded-lg grid place-items-center"
          aria-label="Home"
          style={{ background: COLORS.surface }}
        >
          <Icon name="back" size={18} color={COLORS.t2} />
        </Link>
        <span className="text-base font-bold" style={{ color: COLORS.w }}>
          Tarjuman
        </span>
      </div>
      <article className="flex-1 px-6 py-8 max-w-[640px] w-full mx-auto">
        {children}
      </article>
      <footer
        className="px-6 py-6 text-[12px] flex gap-4"
        style={{ color: COLORS.t4, borderTop: `1px solid ${COLORS.border}` }}
      >
        <Link href="/privacy" style={{ color: COLORS.t3 }}>
          Privacy
        </Link>
        <Link href="/terms" style={{ color: COLORS.t3 }}>
          Terms
        </Link>
      </footer>
    </div>
  );
}

import Link from "next/link";
import { SITE_NAME, SITE_NAME_AR } from "@/lib/site";
import { Reveal } from "./reveal";

export function Footer() {
  return (
    <footer className="w-full border-t border-[var(--color-border-light)] bg-[var(--color-surface)]">
      <Reveal>
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 text-[var(--color-text-2)]">
            <span className="font-bold text-[var(--color-text-1)]">{SITE_NAME}</span>
            <span className="text-[var(--color-text-3)]" lang="ar" dir="rtl">
              {SITE_NAME_AR}
            </span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-[var(--color-text-2)]">
            <Link href="/record" className="hover:text-[var(--color-text-1)] transition">
              Record
            </Link>
            <Link href="/privacy" className="hover:text-[var(--color-text-1)] transition">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[var(--color-text-1)] transition">
              Terms
            </Link>
          </nav>
        </div>
      </Reveal>
    </footer>
  );
}

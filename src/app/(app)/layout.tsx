"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";
import { BottomNav } from "@/components/layout/bottom-nav";
import { NavVisibilityProvider } from "@/components/layout/nav-visibility";
import { Icon } from "@/components/shared/icon";
import { COLORS } from "@/lib/constants";
import { LocaleProvider } from "@/lib/i18n/locale-context";

/**
 * Auth-guarded shell. Three states:
 *  - loading: render a tiny spinner until Convex Auth hands us a verdict.
 *    Without this, the app shell would flash for unauthed users on first
 *    paint before redirecting.
 *  - unauthenticated: redirect to /login.
 *  - authenticated: render the app + bottom nav.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const pathname = usePathname();
  // The app is a 420px phone column everywhere — except the pricing page, which
  // is a comparison grid that needs room to lay the tiers out side by side on
  // desktop (it stays a stacked single column on mobile).
  const wide = pathname === "/plans";

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  // Dead-identity guard: a still-valid JWT whose user row was deleted leaves
  // isAuthenticated=true but me=null. Don't render a broken shell — sign out.
  // (me === undefined = still loading; only act on a resolved null.)
  useEffect(() => {
    if (isAuthenticated && me === null) {
      void signOut().then(() => router.replace("/login"));
    }
  }, [isAuthenticated, me, signOut, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div
        className="w-full mx-auto relative overflow-hidden flex flex-col items-center justify-center"
        style={{
          maxWidth: 420,
          minHeight: "100dvh",
          background: COLORS.bg,
        }}
      >
        {/* Branded gate while Convex Auth resolves — gentle pulse, not a bare
            spinner, so the app reads as "loading" on-brand. */}
        <div
          className="w-12 h-12 rounded-2xl grid place-items-center animate-pulse"
          style={{
            background: COLORS.accent,
            boxShadow: `0 0 30px ${COLORS.accent}40`,
          }}
        >
          <Icon name="mic" size={22} color="#0A0F1C" />
        </div>
      </div>
    );
  }

  return (
    <LocaleProvider>
      <NavVisibilityProvider>
        <div
          className={`w-full mx-auto relative overflow-hidden flex flex-col max-w-[420px] ${
            wide ? "md:max-w-4xl" : ""
          }`}
          style={{
            minHeight: "100dvh",
            background: COLORS.bg,
          }}
        >
          {children}
          <BottomNav />
        </div>
      </NavVisibilityProvider>
    </LocaleProvider>
  );
}

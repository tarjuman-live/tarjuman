"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { BottomNav } from "@/components/layout/bottom-nav";
import { NavVisibilityProvider } from "@/components/layout/nav-visibility";
import { COLORS } from "@/lib/constants";

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
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

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
        <div
          className="w-5 h-5 rounded-full border-2 animate-spin"
          style={{
            borderColor: `${COLORS.accent} transparent ${COLORS.accent} ${COLORS.accent}`,
          }}
        />
      </div>
    );
  }

  return (
    <NavVisibilityProvider>
      <div
        className="w-full mx-auto relative overflow-hidden flex flex-col"
        style={{
          maxWidth: 420,
          minHeight: "100dvh",
          background: COLORS.bg,
        }}
      >
        {children}
        <BottomNav />
      </div>
    </NavVisibilityProvider>
  );
}

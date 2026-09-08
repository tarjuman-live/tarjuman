"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ReactNode, useMemo } from "react";

/**
 * Wraps the app in the Convex client + Convex Auth provider.
 *
 * `ConvexAuthProvider` (from @convex-dev/auth/react) is the SPA-style auth
 * provider. It's correct for our setup: every consumer page is a client
 * component, the auth flows happen entirely in the browser (sign-in form
 * posts → cookie set → auth state propagates over WS).
 *
 * For server-side rendered auth state (rare in our app — only the marketing
 * landing page is fully static, and it doesn't need auth), Convex also ships
 * `ConvexAuthNextjsProvider` which we'd swap to if/when we add SSR pages
 * that need to know who the user is.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      if (typeof window !== "undefined") {
        console.warn(
          "NEXT_PUBLIC_CONVEX_URL is not set. Run `bunx convex dev` to populate it."
        );
      }
      return null;
    }
    return new ConvexReactClient(url);
  }, []);

  if (!client) return <>{children}</>;
  return <ConvexAuthProvider client={client}>{children}</ConvexAuthProvider>;
}

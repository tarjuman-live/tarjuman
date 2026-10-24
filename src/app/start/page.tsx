"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { AppGate } from "@/components/shared/app-gate";

/**
 * /start — where every sign-in and every landing-page "open the app" CTA
 * lands. Decides the destination once the user is known:
 *  - operators (Convex ADMIN_USER_IDS, surfaced as `me.isAdmin`) → /admin
 *  - everyone else → /record
 *
 * Lives OUTSIDE the (app) group on purpose: the app shell (sidebar, bottom
 * nav) would otherwise flash for a frame before the redirect. Shows the same
 * branded gate as the (app) auth guard, so the hand-off is seamless.
 *
 * Google OAuth returns here too (`redirectTo: "/start"`); ConvexAuthProvider
 * exchanges the ?code= client-side while `isLoading` is true.
 */
export default function StartPage() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  // Skip until authed — an unauthenticated `me` is just null and would race
  // the code exchange into a wrong /record redirect.
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace("/?auth=signin");
      return;
    }
    if (me === undefined) return; // still loading
    // me === null (dead identity) → /record, where the (app) guard signs out.
    router.replace(me?.isAdmin ? "/admin" : "/record");
  }, [isLoading, isAuthenticated, me, router]);

  return <AppGate />;
}

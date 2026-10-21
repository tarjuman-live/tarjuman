"use client";

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { AdminDataProvider } from "@/components/admin/admin-context";
import { AdminShell } from "@/components/admin/admin-shell";
import { Skeleton } from "@/components/shared/skeleton";

/**
 * /admin — operator dashboard. Visible only to users in the Convex
 * ADMIN_USER_IDS allowlist (surfaced to the client as `me.isAdmin`).
 *
 * This gate is COSMETIC: it 404s the route for everyone else so it isn't
 * advertised. The real lock is server-side — every function in
 * convex/adminPanel.ts and convex/adminStats.ts calls requireAdmin, so a
 * non-admin calling them directly from the console gets "Not authorized".
 * Admin queries mount only after this check passes.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const me = useQuery(api.users.me);

  if (me === undefined) {
    return (
      <div className="flex flex-col gap-3 w-full px-5 pt-8 lg:px-8 lg:pt-10 lg:max-w-6xl lg:mx-auto">
        <Skeleton style={{ width: 160, height: 28 }} />
        <Skeleton style={{ width: "100%", height: 44 }} rounded={16} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} style={{ height: 116 }} rounded={16} />
          ))}
        </div>
      </div>
    );
  }
  if (!me?.isAdmin) notFound();

  return (
    <AdminDataProvider>
      <AdminShell>{children}</AdminShell>
    </AdminDataProvider>
  );
}

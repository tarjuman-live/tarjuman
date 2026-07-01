"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { COLORS } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { PlanBadge } from "@/components/billing/plan-badge";

/**
 * Compact circular avatar in the top-right of the idle record screen.
 * Tap → opens a popover with the user's identity, a link to Settings, and
 * Sign out. Account management (edit name, delete account, preferences) lives
 * on the /settings page reached from here.
 *
 * IMPORTANT: this control is the ONLY way to reach Settings / Sign out, so it
 * must never disappear. It is always rendered inside the auth-guarded app
 * shell (the layout blocks unauthed users), which means we can safely keep the
 * button on screen even while `api.users.me` is still loading OR resolves to
 * null — e.g. a slow query, a transient token hiccup, or a deleted/missing
 * user row. Earlier this component returned null in those cases, which made
 * the avatar vanish and stranded the user with no way to sign out. Sign out
 * works regardless of `me`, so it's always available.
 */
export function AccountMenu({ dropUp = false }: { dropUp?: boolean } = {}) {
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // OAuth profile images (Google, etc.) sometimes fail to load — expired
  // tokens, hotlink blocks, or offline. Without this, the browser renders
  // its default broken-image landscape icon, which looks awful in a 32px
  // circular avatar. On error we fall back to the initial.
  const [imageBroken, setImageBroken] = useState(false);

  const loading = me === undefined;
  const showImage = Boolean(me?.image) && !imageBroken;
  // While loading we show no glyph (a faint pulsing disc); once resolved, the
  // user's initial, falling back to "?" if we somehow have no name/email.
  const initial = (me?.name?.[0] ?? me?.email?.[0] ?? "?").toUpperCase();

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    router.replace("/");
  };

  const goToSettings = () => {
    setOpen(false);
    router.push("/settings");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-busy={loading}
        className={`w-8 h-8 rounded-full grid place-items-center text-[12px] font-bold cursor-pointer transition-transform active:scale-95 overflow-hidden${
          loading ? " animate-pulse" : ""
        }`}
        style={{
          background: showImage ? "transparent" : COLORS.accentSoft,
          border: `1px solid ${COLORS.accent}40`,
          color: COLORS.accent,
        }}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={me!.image!}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImageBroken(true)}
            referrerPolicy="no-referrer"
          />
        ) : loading ? null : (
          initial
        )}
      </button>

      {open && (
        <>
          {/* Click-outside backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            className={`absolute z-50 w-56 rounded-xl overflow-hidden ${
              dropUp ? "left-0 bottom-full mb-2" : "right-0 top-10"
            }`}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.borderLight}`,
              boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div
              className="px-4 py-3"
              style={{ borderBottom: `1px solid ${COLORS.border}` }}
            >
              <div className="flex items-center gap-2 min-w-0">
                {me?.name && (
                  <span
                    className="text-[13px] font-semibold truncate"
                    style={{ color: COLORS.w }}
                  >
                    {me.name}
                  </span>
                )}
                {/* Pro/Scholar symbol — renders nothing for free users. */}
                <PlanBadge />
              </div>
              <div
                className="text-[12px] truncate"
                style={{ color: COLORS.t3 }}
              >
                {me?.email ?? (loading ? "Loading…" : "Signed in")}
              </div>
            </div>
            <button
              type="button"
              onClick={goToSettings}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left text-[13px] font-semibold cursor-pointer hover:bg-black/20 transition-colors"
              style={{ color: COLORS.t2 }}
            >
              <span className="flex items-center gap-2">
                <Icon name="settings" size={14} color={COLORS.t3} />
                Settings
              </span>
              <Icon name="chevron" size={14} color={COLORS.t4} />
            </button>
            <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full px-4 py-3 flex items-center gap-2 text-left text-[13px] font-semibold cursor-pointer hover:bg-black/20 transition-colors"
              style={{ color: COLORS.t2 }}
            >
              <Icon name="close" size={14} color={COLORS.t3} />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

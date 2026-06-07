import { ReactNode } from "react";

/**
 * Remounts on every (app) route change, replaying a short enter animation
 * (fade + 8px rise) so tab switches read as one fluid gesture instead of a
 * hard content swap. Nests INSIDE the (app) layout, so BottomNav — rendered
 * by the layout — never re-animates.
 *
 * `flex flex-col flex-1` is load-bearing: every page roots with
 * `flex flex-col flex-1` and relies on this chain reaching the layout's
 * min-h-dvh flex column.
 *
 * Caveat for future code: while the 200ms enter plays, this wrapper has a
 * transform, which makes it the containing block for `position: fixed`
 * descendants. All current overlays are portaled (Radix Portal) so they
 * escape; an in-page fixed element would be mispositioned for 200ms.
 */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col flex-1 animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
      {children}
    </div>
  );
}

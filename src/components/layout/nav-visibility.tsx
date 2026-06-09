"use client";

import { createContext, useContext, useMemo, useState, ReactNode } from "react";

/**
 * Lets a page hide the floating bottom nav (e.g. the record screen while a
 * session is active, so the nav doesn't crowd the pause/stop controls). The
 * nav lives in the (app) layout while the recording state lives in the page,
 * so this small context bridges them.
 */
interface NavVisibility {
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

const NavVisibilityContext = createContext<NavVisibility>({
  hidden: false,
  setHidden: () => {},
});

export function NavVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  // setHidden is stable; memoizing keeps the value identity steady except when
  // `hidden` actually flips.
  const value = useMemo(() => ({ hidden, setHidden }), [hidden]);
  return (
    <NavVisibilityContext.Provider value={value}>
      {children}
    </NavVisibilityContext.Provider>
  );
}

export function useNavVisibility() {
  return useContext(NavVisibilityContext);
}

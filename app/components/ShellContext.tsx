"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * What the frame around every signed-in page needs to know about who's
 * looking: for now, whether they run the site. Set once by the dashboard
 * layout, so no page has to thread it through.
 */
const ShellContext = createContext<{ admin: boolean }>({ admin: false });

export function ShellProvider({ admin, children }: { admin: boolean; children: ReactNode }) {
  return <ShellContext.Provider value={{ admin }}>{children}</ShellContext.Provider>;
}

export function useShellInfo() {
  return useContext(ShellContext);
}

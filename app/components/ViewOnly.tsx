"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * True when the signed-in account can change nothing anywhere (every LLC it
 * belongs to has it as a viewer). Screens use it to leave out buttons and
 * forms whose requests would only be refused. Nothing on screen should ever
 * say why: no "read-only" banner, no role name, no disabled-with-tooltip —
 * the controls simply aren't there.
 */
const ViewOnlyContext = createContext(false);

export function ViewOnlyProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <ViewOnlyContext.Provider value={value}>{children}</ViewOnlyContext.Provider>;
}

export function useViewOnly(): boolean {
  return useContext(ViewOnlyContext);
}

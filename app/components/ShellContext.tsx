"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * What the frame around every signed-in page needs to know about who's
 * looking: whether they run the site (for the Admin link), and their name
 * and email for the account menu. Set once by the dashboard layout, so no
 * page has to thread it through.
 */
type ShellInfo = { admin: boolean; name: string | null; email: string | null };

const ShellContext = createContext<ShellInfo>({ admin: false, name: null, email: null });

export function ShellProvider({
  admin,
  name = null,
  email = null,
  children,
}: {
  admin: boolean;
  name?: string | null;
  email?: string | null;
  children: ReactNode;
}) {
  return <ShellContext.Provider value={{ admin, name, email }}>{children}</ShellContext.Provider>;
}

export function useShellInfo() {
  return useContext(ShellContext);
}

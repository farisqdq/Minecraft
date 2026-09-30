"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_APPEARANCE, htmlAttributes, type Appearance } from "@/lib/appearance";

/**
 * The signed-in person's appearance (layout, mode, accent). Set from their
 * saved choice by the server, applied to <html> as data-* attributes that all
 * the CSS keys off, and changed in place by Settings > Appearance: `update`
 * applies the change at once (no reload) and saves it to the account.
 */
type AppearanceState = {
  appearance: Appearance;
  /** Applies a change immediately and saves it; resolves false if saving failed. */
  update: (patch: Partial<Appearance>) => Promise<boolean>;
};

const Ctx = createContext<AppearanceState>({
  appearance: DEFAULT_APPEARANCE,
  update: async () => false,
});

export function useAppearance() {
  return useContext(Ctx);
}

/** Puts the choice on <html>, removing attributes a previous choice set. */
export function applyToDocument(a: Appearance) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const attrs = htmlAttributes(a);
  for (const name of ["data-layout", "data-theme", "data-accent"]) {
    if (attrs[name]) root.setAttribute(name, attrs[name]);
    else root.removeAttribute(name);
  }
}

export function AppearanceProvider({
  initial,
  endpoint,
  children,
}: {
  initial: Appearance;
  /** Where changes are saved: the landlord, tenant or owner account's own endpoint. */
  endpoint: string;
  children: ReactNode;
}) {
  const [appearance, setAppearance] = useState<Appearance>(initial);
  const latest = useRef(appearance);
  latest.current = appearance;

  useEffect(() => {
    applyToDocument(appearance);
  }, [appearance]);

  const update = useCallback(
    async (patch: Partial<Appearance>) => {
      const before = latest.current;
      const next = { ...before, ...patch };
      setAppearance(next);
      applyToDocument(next);
      try {
        const res = await fetch(endpoint, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [endpoint]
  );

  const value = useMemo(() => ({ appearance, update }), [appearance, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

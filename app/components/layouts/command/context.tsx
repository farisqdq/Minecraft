"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

/**
 * What the Command Center's shell and its dashboard share.
 *
 * The LLC selection lives in the URL on the dashboard (?llc=<companyId>, so a
 * link or a reload keeps it) and in localStorage everywhere, so the switcher
 * at the top of the sidebar shows the same choice on every page. Other pages
 * don't filter by it; picking an LLC there takes you to the dashboard.
 *
 * The dashboard also hands the shell its companies and its "+ Record
 * payment" handler through CommandPageContext, so the header button opens
 * the record sheet in place instead of navigating.
 */

export type ShellCompany = { id: string; name: string };

const KEY = "rr-command-llc";
const EVENT = "rentroll:command-llc";

function readSelection(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("llc");
    if (fromUrl) return fromUrl;
    return window.localStorage.getItem(KEY) || "all";
  } catch {
    return "all";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** The stored LLC choice: a company id or "all" (validate it against the list you have). */
export function useLlcSelection(): string {
  return useSyncExternalStore(subscribe, readSelection, () => "all");
}

/** Pick an LLC. On the dashboard the URL follows, so reload and back keep it. */
export function setLlcSelection(id: string) {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Private mode: the choice lasts as long as the URL does.
  }
  try {
    const url = new URL(window.location.href);
    if (url.pathname === "/dashboard") {
      if (id === "all") url.searchParams.delete("llc");
      else url.searchParams.set("llc", id);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  } catch {
    // Leave the URL alone.
  }
  window.dispatchEvent(new Event(EVENT));
}

type PageInfo = {
  companies?: ShellCompany[];
  /** Opens the record-payment sheet on this page. */
  onRecord?: () => void;
};

const CommandPageContext = createContext<PageInfo>({});

export const CommandPageProvider = CommandPageContext.Provider;

export function useCommandPage() {
  return useContext(CommandPageContext);
}

// Pages other than the dashboard don't pass companies; one fetch per visit
// is plenty for a switcher that only shows names.
let companiesCache: ShellCompany[] | null = null;

/** The LLCs for the switcher: the dashboard's own list, or fetched once elsewhere. */
export function useShellCompanies(): ShellCompany[] {
  const page = useCommandPage();
  const [fetched, setFetched] = useState<ShellCompany[]>(companiesCache ?? []);
  useEffect(() => {
    if (page.companies) {
      companiesCache = page.companies;
      return;
    }
    if (companiesCache) return;
    let live = true;
    fetch("/api/companies", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!live || !Array.isArray(data)) return;
        companiesCache = data.map((c: ShellCompany) => ({ id: c.id, name: c.name }));
        setFetched(companiesCache);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [page.companies]);
  return page.companies ?? fetched;
}

"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./shell.module.css";

type Hit = {
  id: string;
  name: string;
  address: string;
  company: string;
  units: string[];
  tenants: string[];
};

const MAX_RESULTS = 7;

// How long a fetched index stays good. Long enough that opening the box twice
// in a row doesn't hit the network twice, short enough that a property added a
// minute ago is findable.
const STALE_AFTER = 30_000;

function IconSearch(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.4 15.4 4.1 4.1" />
    </svg>
  );
}

/**
 * The one line under each hit that says *why* it turned up — otherwise a row
 * that matched on its LLC or its tenant looks like it appeared out of nowhere.
 * The order here mirrors the ranking below so the two never disagree.
 */
function reasonFor(hit: Hit, q: string): string {
  if (!hit.name.toLowerCase().includes(q)) {
    const tenant = hit.tenants.find((t) => t.toLowerCase().includes(q));
    if (tenant) return tenant;
    if (hit.address.toLowerCase().includes(q)) return hit.address;
    const unit = hit.units.find((u) => u.toLowerCase().includes(q));
    if (unit) return `${unit} · ${hit.company}`;
    if (hit.company.toLowerCase().includes(q)) return hit.company;
  }
  return hit.address || hit.company;
}

/**
 * Jump to a property from anywhere. It sits in the top bar rather than in the
 * dashboard grid so it works from Team, Backup and Export too, and it takes
 * you to the place rather than filtering cards you may not be looking at.
 */
export default function PropertySearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const fetchedAt = useRef(0);
  const listId = useId();

  const load = useCallback(async () => {
    if (Date.now() - fetchedAt.current < STALE_AFTER) return;
    setLoading(true);
    try {
      const res = await fetch("/api/search");
      if (!res.ok) return;
      const data = (await res.json()) as Hit[];
      if (Array.isArray(data)) {
        setItems(data);
        fetchedAt.current = Date.now();
      }
    } catch {
      // Offline or signed out — the box just stays empty rather than shouting.
    } finally {
      setLoading(false);
    }
  }, []);

  const needle = q.trim().toLowerCase();

  const hits = useMemo(() => {
    if (!needle) return [];
    // Rank by how directly the word matches: a property whose name starts with
    // what you typed should never sit below one that merely shares an LLC.
    const scored: { hit: Hit; score: number }[] = [];
    for (const hit of items) {
      const name = hit.name.toLowerCase();
      let score = -1;
      if (name.startsWith(needle)) score = 0;
      else if (name.split(/\s+/).some((w) => w.startsWith(needle))) score = 1;
      else if (name.includes(needle)) score = 2;
      else if (hit.tenants.some((t) => t.toLowerCase().includes(needle))) score = 3;
      else if (hit.address.toLowerCase().includes(needle)) score = 4;
      else if (hit.units.some((u) => u.toLowerCase().includes(needle))) score = 5;
      else if (hit.company.toLowerCase().includes(needle)) score = 6;
      if (score >= 0) scored.push({ hit, score });
    }
    scored.sort((a, b) => a.score - b.score || a.hit.name.localeCompare(b.hit.name));
    return scored.slice(0, MAX_RESULTS).map((s) => s.hit);
  }, [items, needle]);

  useEffect(() => setActive(0), [needle]);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
  }, []);

  const go = useCallback(
    (id: string) => {
      close();
      input.current?.blur();
      router.push(`/dashboard/properties/${id}`);
    },
    [close, router]
  );

  // Click anywhere else and the box packs itself away.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  // ⌘K / Ctrl-K from anywhere, and "/" when you aren't already typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        el?.isContentEditable === true;
      const shortcut = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      if (shortcut || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        setOpen(true);
        void load();
        requestAnimationFrame(() => input.current?.focus());
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [load]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      input.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[Math.min(active, hits.length - 1)].id);
    }
  }

  const showList = open && needle.length > 0;

  return (
    <>
      {/* On a phone the bar has no room for a field, so it starts as an icon
          and takes the whole bar over once you tap it. */}
      <button
        type="button"
        className={styles.searchBtn}
        aria-label="Search properties"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          void load();
          requestAnimationFrame(() => input.current?.focus());
        }}
      >
        <IconSearch className={styles.searchBtnIcon} />
      </button>

      <div ref={box} className={`${styles.search} ${open ? styles.searchOpen : ""}`}>
        <div className={styles.searchField}>
          <IconSearch className={styles.searchIcon} />
          <input
            ref={input}
            type="text"
            className={styles.searchInput}
            value={q}
            placeholder="Search properties"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label="Search properties by name, address, unit, tenant or LLC"
            aria-activedescendant={showList && hits.length ? `${listId}-${active}` : undefined}
            onFocus={() => {
              setOpen(true);
              void load();
            }}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {q ? (
            <button
              type="button"
              className={styles.searchClear}
              aria-label="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQ("");
                input.current?.focus();
              }}
            >
              ×
            </button>
          ) : (
            <span className={styles.searchHint} aria-hidden="true">
              /
            </span>
          )}
        </div>

        <button type="button" className={styles.searchCancel} onClick={close}>
          Cancel
        </button>

        {showList && (
          <ul className={styles.results} id={listId} role="listbox">
            {hits.map((hit, i) => (
              <li key={hit.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={`${styles.result} ${i === active ? styles.resultOn : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(hit.id)}
                >
                  <span className={styles.resultName}>{hit.name}</span>
                  <span className={styles.resultWhy}>{reasonFor(hit, needle)}</span>
                </button>
              </li>
            ))}
            {!hits.length && (
              <li className={styles.noResult}>
                {loading ? "Looking…" : `Nothing matches “${q.trim()}”.`}
              </li>
            )}
          </ul>
        )}
      </div>
    </>
  );
}

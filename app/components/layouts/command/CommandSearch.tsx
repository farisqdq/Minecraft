"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconBuilding, IconSearch, IconChevronRight } from "../../icons";
import { hitReason, rankHits, type SearchHit } from "@/lib/layouts/command-search";
import styles from "./shell.module.css";

// A fetched index stays good this long — same as the Classic search box.
const STALE_AFTER = 30_000;

export type JumpTo = { href: string; label: string };

/**
 * ⌘K: find a property by name, address, unit, tenant or LLC, or jump to a
 * section. The same /api/search index and ranking as the Classic top-bar
 * search, shown as a palette instead of an inline box.
 */
export default function CommandSearch({ jumps, compact = false }: { jumps: JumpTo[]; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(true);
  const fetchedAt = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const listId = useId();

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  const load = useCallback(async () => {
    if (Date.now() - fetchedAt.current < STALE_AFTER) return;
    setLoading(true);
    try {
      const res = await fetch("/api/search");
      if (!res.ok) return;
      const data = (await res.json()) as SearchHit[];
      if (Array.isArray(data)) {
        setItems(data);
        fetchedAt.current = Date.now();
      }
    } catch {
      // Offline: the palette just finds nothing.
    } finally {
      setLoading(false);
    }
  }, []);

  const show = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    void load();
  }, [load]);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    opener.current?.focus?.();
  }, []);

  // ⌘K / Ctrl-K from anywhere, "/" when not typing.
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
        show();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  const needle = q.trim();
  const results = useMemo(() => {
    if (!needle) return jumps.map((j) => ({ key: j.href, href: j.href, title: j.label, sub: "", kind: "jump" as const }));
    const jumpHits = jumps
      .filter((j) => j.label.toLowerCase().includes(needle.toLowerCase()))
      .map((j) => ({ key: j.href, href: j.href, title: j.label, sub: "Go to", kind: "jump" as const }));
    const props = rankHits(items, needle).map((h) => ({
      key: h.id,
      href: `/dashboard/properties/${h.id}`,
      title: h.name,
      sub: hitReason(h, needle),
      kind: "property" as const,
    }));
    return [...props, ...jumpHits];
  }, [needle, items, jumps]);

  useEffect(() => setActive(0), [needle]);

  function go(href: string) {
    setOpen(false);
    setQ("");
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && results.length) {
      e.preventDefault();
      go(results[Math.min(active, results.length - 1)].href);
    }
  }

  return (
    <>
      {compact ? (
        <button type="button" className={styles.iconBtn} aria-label="Search" onClick={show}>
          <IconSearch size={20} />
        </button>
      ) : (
        <button type="button" className={styles.searchTrigger} onClick={show} aria-label="Search properties">
          <IconSearch size={16} />
          <span className={styles.searchTriggerText}>Search…</span>
          <kbd className={styles.kbd}>{mac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
      )}

      {open && (
        <div className={styles.paletteScrim} onMouseDown={close}>
          <div
            className={styles.palette}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={styles.paletteField}>
              <IconSearch size={18} />
              <input
                ref={input}
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search properties, tenants, addresses…"
                autoComplete="off"
                spellCheck={false}
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls={listId}
                aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
                aria-label="Search properties by name, address, unit, tenant or LLC"
              />
              <button type="button" className={styles.paletteEsc} onClick={close}>
                Esc
              </button>
            </div>
            <ul className={styles.paletteList} id={listId} role="listbox">
              {!needle && <li className={styles.paletteGroup}>Go to</li>}
              {results.map((r, i) => (
                <li key={`${r.kind}-${r.key}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={`${styles.paletteItem} ${i === active ? styles.paletteOn : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.href)}
                  >
                    <span className={styles.paletteIcon} aria-hidden="true">
                      {r.kind === "property" ? <IconBuilding size={16} /> : <IconChevronRight size={16} />}
                    </span>
                    <span className={styles.paletteText}>
                      <span className={styles.paletteTitle}>{r.title}</span>
                      {r.sub && <span className={styles.paletteSub}>{r.sub}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {needle && results.length === 0 && (
                <li className={styles.paletteEmpty}>{loading ? "Looking…" : `Nothing matches “${needle}”.`}</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

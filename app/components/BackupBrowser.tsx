"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SensitiveImg from "./SensitiveImg";

/**
 * Browses one phone's backup as a photo/video gallery with folders. Used both
 * on the admin Gallery page and on the restore page a staff member opens from
 * a link — they differ only in which URLs they read from, passed in here.
 *
 *  - listUrl(dir)  → JSON { dir, entries: [{name,path,dir,size,mtime,count}] }
 *  - fileUrl(path, download) → a URL that shows (or downloads) that file
 */
export type BrowserUrls = {
  listUrl: (dir: string) => string;
  fileUrl: (path: string, download: boolean) => string;
  /** Optional small preview for grid tiles. */
  thumbUrl?: (path: string) => string;
  /**
   * Optional search by what's in the photos: ?q= gives the best matches
   * ({ results: [{ p, s }], status }), no q gives how far indexing has got.
   */
  searchUrl?: (q: string) => string;
};

type SearchStatus = { indexed: number; total: number; running: boolean; perMinute?: number; error?: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthYear(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function timeLeft(sec: number) {
  if (sec < 60) return "under a minute left";
  const m = Math.round(sec / 60);
  if (m < 60) return `about ${m} min left`;
  return `about ${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""} left`;
}

type Entry = { name: string; path: string; dir: boolean; size: number; mtime: string; count?: number };

const IMAGE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i;
const VIDEO = /\.(mp4|mov|m4v|3gp|mkv|webm|avi)$/i;
const SHOWABLE_IMG = /\.(jpe?g|png|gif|webp|bmp|avif)$/i; // browsers can't show heic/heif

function human(n: number) {
  if (!n || n < 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, b = n;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export default function BackupBrowser({ urls, startDir = "" }: { urls: BrowserUrls; startDir?: string }) {
  const [dir, setDir] = useState(startDir);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [err, setErr] = useState("");
  const [lightbox, setLightbox] = useState<Entry | null>(null);
  // Search by description.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const searchSeq = useRef(0);
  // Month label while scrolling, and the jump-to-date picker.
  const gridRef = useRef<HTMLDivElement>(null);
  const [when, setWhen] = useState("");
  const [whenOn, setWhenOn] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);

  const load = useCallback(async (d: string) => {
    setErr(""); setEntries(null);
    try {
      const res = await fetch(urls.listUrl(d), { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) { setErr(body?.error || "Couldn't open that folder."); setEntries([]); return; }
      setDir(body.dir === "." ? "" : body.dir);
      setEntries(body.entries || []);
    } catch { setErr("Couldn't reach the server."); setEntries([]); }
  }, [urls]);

  useEffect(() => { load(startDir); }, [load, startDir]);

  const folders = (entries || []).filter((e) => e.dir);
  const media = (entries || []).filter((e) => !e.dir && (IMAGE.test(e.name) || VIDEO.test(e.name)));
  const others = (entries || []).filter((e) => !e.dir && !IMAGE.test(e.name) && !VIDEO.test(e.name));

  const crumbs = dir ? dir.split("/") : [];

  // How far the backup server has got learning the photos, checked again
  // every 30 s while it's still going.
  useEffect(() => {
    if (!urls.searchUrl) return;
    let stop = false, t: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const res = await fetch(urls.searchUrl!(""), { cache: "no-store" });
        const body = await res.json();
        if (stop || !res.ok) return;
        setStatus(body.status);
        if (body.status?.total && body.status.indexed < body.status.total) t = setTimeout(check, 30000);
      } catch { /* the search line just stays as it was */ }
    };
    check();
    return () => { stop = true; clearTimeout(t); };
  }, [urls]);

  // Search as you type, a moment after you stop.
  useEffect(() => {
    if (!urls.searchUrl) return;
    const q = query.trim();
    if (q.length < 2) { setResults(null); setSearching(false); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(urls.searchUrl!(q), { cache: "no-store" });
        const body = await res.json();
        if (seq !== searchSeq.current) return;
        if (!res.ok) { setResults([]); setErr(body?.error || "Search isn't available yet."); return; }
        setErr("");
        if (body.status) setStatus(body.status);
        setResults((body.results || []).map((r: { p: string }) => ({ name: r.p.split("/").pop() || r.p, path: r.p, dir: false, size: 0, mtime: "" })));
      } catch {
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query, urls]);

  // While scrolling a folder, say which month the photos at the top of the
  // screen are from; it fades a moment after scrolling stops.
  useEffect(() => {
    let raf = 0, hide: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const g = gridRef.current;
        if (!g) return;
        const r = g.getBoundingClientRect();
        const y = Math.max(r.top + 10, 90);
        if (r.bottom < y || r.top > window.innerHeight / 2) { setWhenOn(false); return; }
        // The last tile in the top row: rows run newest to oldest.
        const el = document.elementFromPoint(r.right - 20, y) ?? document.elementFromPoint(r.left + 20, y);
        const tile = (el as HTMLElement | null)?.closest?.("[data-i]") as HTMLElement | null;
        const m = tile ? media[Number(tile.dataset.i)] : undefined;
        const label = m ? monthYear(m.mtime) : "";
        if (!label) return;
        setWhen(label);
        setWhenOn(true);
        clearTimeout(hide);
        hide = setTimeout(() => setWhenOn(false), 1200);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); clearTimeout(hide); };
  }, [media]);

  const jumpTo = (i: number) => {
    setJumpOpen(false);
    const tile = gridRef.current?.querySelector(`[data-i="${i}"]`);
    if (tile) window.scrollTo({ top: tile.getBoundingClientRect().top + window.scrollY - 90 });
  };

  const tile = (m: Entry, i?: number) => {
    const isVideo = VIDEO.test(m.name);
    const heic = /\.(hei[cf])$/i.test(m.name);
    const canShow = isVideo || SHOWABLE_IMG.test(m.name) || heic;
    return (
      <button key={m.path} data-i={i} onClick={() => setLightbox(m)} style={mediaTile} title={m.name}>
        {isVideo && urls.thumbUrl ? (
          <VideoThumb src={urls.thumbUrl(m.path)} name={m.name} />
        ) : !isVideo && canShow ? (
          <SensitiveImg src={heic ? `${urls.fileUrl(m.path, false)}&thumb=1&w=1600` : urls.fileUrl(m.path, false)} thumb={urls.thumbUrl?.(m.path)} alt={m.name} fill compact />
        ) : (
          <div style={tilePlaceholder}>
            <span style={{ fontSize: 30 }}>{isVideo ? "▶" : "🖼"}</span>
            <span style={{ fontSize: 11, color: "#eee", padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", textAlign: "center" }}>{m.name}</span>
          </div>
        )}
        {isVideo && <span style={playBadge}>▶</span>}
      </button>
    );
  };

  const statusLine = (() => {
    if (!status) return "";
    if (status.error) return "Searching by description isn't available yet.";
    if (!status.total) return ""; // not reported yet (e.g. the server just restarted)
    if (status.indexed >= status.total) return "";
    const left = status.perMinute && status.perMinute > 0 ? `, ${timeLeft(((status.total - status.indexed) / status.perMinute) * 60)}` : "";
    return `Still learning the photos: ${status.indexed.toLocaleString()} of ${status.total.toLocaleString()}${left}. Newest first.`;
  })();

  const searchingNow = results !== null || (searching && query.trim().length >= 2);

  return (
    <div>
      {urls.searchUrl && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search what's in the photos — try “beach”, “dog”, “receipt”"
              aria-label="Search photos by description"
              style={{ flex: 1, minWidth: 0, font: "inherit", padding: "10px 14px", borderRadius: 999, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit" }}
            />
            {query && <button style={crumbBtn} onClick={() => setQuery("")}>Clear</button>}
          </div>
          {statusLine && <div style={{ fontSize: 12.5, opacity: 0.7, margin: "6px 0 0 6px" }}>{statusLine}</div>}
        </div>
      )}

      {searchingNow ? (
        <div>
          <p style={{ margin: "0 0 10px", fontSize: 14, opacity: 0.8 }}>
            {searching ? "Searching…" : results && results.length ? `${results.length} best match${results.length === 1 ? "" : "es"} for “${query.trim()}”, best first` : `Nothing found for “${query.trim()}”.`}
          </p>
          {err && <p style={{ color: "#B23A3A" }}>{err}</p>}
          {results && results.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginBottom: 18 }}>
              {results.map((m) => tile(m))}
            </div>
          )}
        </div>
      ) : (<>
      {/* breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12, fontSize: 14 }}>
        <button style={crumbBtn} onClick={() => load("")}>All</button>
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#9AA093" }}>/</span>
            <button style={crumbBtn} onClick={() => load(crumbs.slice(0, i + 1).join("/"))}>{c}</button>
          </span>
        ))}
      </div>

      {err && <p style={{ color: "#B23A3A" }}>{err}</p>}
      {entries === null && !err && <p style={{ color: "#6B7169" }}>Loading…</p>}

      {/* folders */}
      {folders.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginBottom: 18 }}>
          {folders.map((f) => (
            <button key={f.path} onClick={() => load(f.path)} style={folderTile}>
              <span style={{ fontSize: 26 }}>📁</span>
              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>{f.name}</span>
              <span style={{ opacity: .65, fontSize: 12 }}>{f.count ?? 0} item{f.count === 1 ? "" : "s"}</span>
            </button>
          ))}
        </div>
      )}

      {/* photos & videos grid */}
      {media.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", margin: "-4px 0 8px" }}>
          <button style={crumbBtn} onClick={() => setJumpOpen(true)}>Jump to date</button>
        </div>
      )}
      {media.length > 0 && (
        <div ref={gridRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginBottom: 18 }}>
          {media.map((m, i) => tile(m, i))}
        </div>
      )}

      {/* other files */}
      {others.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {others.map((o) => (
            <div key={o.path} style={fileRow}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {o.name}</span>
              <span style={{ display: "flex", gap: 12, flex: "none", alignItems: "center" }}>
                <span style={{ color: "#6B7169", fontSize: 13 }}>{human(o.size)}</span>
                <a href={urls.fileUrl(o.path, true)}>Download</a>
              </span>
            </div>
          ))}
        </div>
      )}

      {entries && entries.length === 0 && !err && <p style={{ color: "#6B7169" }}>This folder is empty.</p>}
      </>)}

      {/* the month you're scrolling through; tap it to jump to another */}
      <button
        type="button"
        onClick={() => setJumpOpen(true)}
        aria-hidden={!whenOn}
        tabIndex={-1}
        style={{
          position: "fixed", left: "50%", top: 80, transform: "translateX(-50%)", zIndex: 50,
          background: "#1F2420", color: "#fff", border: 0, borderRadius: 999, padding: "7px 15px",
          font: "inherit", fontSize: 14, fontWeight: 600, boxShadow: "0 2px 10px rgba(0,0,0,.25)",
          opacity: whenOn && !searchingNow ? 0.92 : 0, pointerEvents: whenOn && !searchingNow ? "auto" : "none",
          transition: "opacity .25s", cursor: "pointer",
        }}
        onMouseEnter={() => setWhenOn(true)}
      >
        {when}
      </button>

      {jumpOpen && <JumpToDate media={media} onPick={jumpTo} onClose={() => setJumpOpen(false)} />}

      {lightbox && (
        <Lightbox entry={lightbox} urls={urls} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function Lightbox({ entry, urls, onClose }: { entry: Entry; urls: BrowserUrls; onClose: () => void }) {
  const isVideo = VIDEO.test(entry.name);
  const heic = /\.(hei[cf])$/i.test(entry.name);
  const canShow = isVideo || SHOWABLE_IMG.test(entry.name) || heic;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={overlay}>
      <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        {isVideo ? (
          <video src={urls.fileUrl(entry.path, false)} controls autoPlay playsInline
            style={{ maxWidth: "94vw", maxHeight: "78vh", borderRadius: 8, background: "#000" }} />
        ) : canShow ? (
          <SensitiveImg src={heic ? `${urls.fileUrl(entry.path, false)}&thumb=1&w=1600` : urls.fileUrl(entry.path, false)} alt={entry.name}
            imgStyle={{ maxWidth: "94vw", maxHeight: "78vh", borderRadius: 8, objectFit: "contain" }} />
        ) : (
          <div style={{ color: "#fff", textAlign: "center" }}>
            <p>This type of photo (HEIC) can&apos;t preview in a browser.</p>
          </div>
        )}
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ color: "#ddd", fontSize: 14, maxWidth: "60vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
          <a href={urls.fileUrl(entry.path, true)} style={{ color: "#8Fd0aa" }}>Download</a>
        </div>
      </div>
    </div>
  );
}

const crumbBtn: React.CSSProperties = { background: "none", border: 0, color: "#2E6A48", font: "inherit", cursor: "pointer", padding: 0, fontWeight: 600 };
const folderTile: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "14px 10px",
  background: "rgba(127,127,127,.08)", border: "1px solid rgba(127,127,127,.3)", borderRadius: 10, cursor: "pointer", font: "inherit", color: "inherit", textAlign: "center",
};
const mediaTile: React.CSSProperties = {
  position: "relative", aspectRatio: "1 / 1", padding: 0, border: "1px solid #E4E2DA", borderRadius: 8,
  overflow: "hidden", cursor: "pointer", background: "#111",
};
const tilePlaceholder: React.CSSProperties = {
  width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, background: "#222",
};
const playBadge: React.CSSProperties = {
  position: "absolute", bottom: 6, right: 6, background: "rgba(0,0,0,.6)", color: "#fff",
  borderRadius: 20, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
};
const fileRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
  borderBottom: "1px solid #E4E2DA", padding: "9px 2px",
};
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.9)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
const closeBtn: React.CSSProperties = {
  position: "fixed", top: 14, right: 18, background: "none", border: 0, color: "#fff", fontSize: 34, cursor: "pointer", lineHeight: 1,
};

/**
 * A frame from the video, which the backup server takes with ffmpeg; the ▶
 * placeholder stays if it can't (an older server, a damaged file).
 */
function VideoThumb({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div style={tilePlaceholder}>
        <span style={{ fontSize: 30 }}>▶</span>
        <span style={{ fontSize: 11, color: "#eee", padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", textAlign: "center" }}>{name}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
  );
}

/** Every year and month in the folder, with how many photos; picking one jumps to its first. */
function JumpToDate({ media, onPick, onClose }: { media: Entry[]; onPick: (i: number) => void; onClose: () => void }) {
  const years = new Map<number, Map<number, { first: number; n: number }>>();
  media.forEach((e, i) => {
    const d = new Date(e.mtime);
    if (Number.isNaN(d.getTime())) return;
    const y = d.getFullYear(), m = d.getMonth();
    if (!years.has(y)) years.set(y, new Map());
    const ms = years.get(y)!;
    if (!ms.has(m)) ms.set(m, { first: i, n: 0 });
    ms.get(m)!.n++;
  });
  const order = [...years.keys()].sort((a, b) => b - a);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div style={{ ...overlay, background: "rgba(0,0,0,.45)", alignItems: "flex-start", paddingTop: 70 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="Jump to date" style={{ background: "var(--surface, #fff)", color: "var(--ink, #1F2420)", borderRadius: 16, width: "min(520px, 100%)", maxHeight: "calc(100vh - 100px)", overflow: "auto", padding: "8px 16px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "inherit", padding: "8px 0" }}>
          <b>Jump to a month</b>
          <button onClick={onClose} aria-label="Close" style={{ border: 0, background: "none", fontSize: 24, cursor: "pointer", color: "inherit" }}>×</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
          {order.map((y) => (
            <button key={y} style={crumbBtn} onClick={() => document.getElementById(`jy${y}`)?.scrollIntoView({ block: "start" })}>{y}</button>
          ))}
        </div>
        {order.length === 0 && <p style={{ opacity: 0.7 }}>No dates to show.</p>}
        {order.map((y) => (
          <div key={y}>
            <h3 id={`jy${y}`} style={{ margin: "14px 0 6px", fontSize: 15 }}>{y}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {MONTHS.map((name, m) => {
                const c = years.get(y)!.get(m);
                return (
                  <button key={m} disabled={!c} onClick={() => c && onPick(c.first)}
                    style={{ border: "1px solid rgba(127,127,127,.3)", background: "none", borderRadius: 10, padding: "8px 4px", cursor: c ? "pointer" : "default", opacity: c ? 1 : 0.35, font: "inherit", fontSize: 13.5, color: "inherit" }}>
                    {name}
                    <span style={{ display: "block", fontSize: 11.5, opacity: 0.65 }}>{c ? c.n.toLocaleString() : "—"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

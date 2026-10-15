"use client";

import { useCallback, useEffect, useState } from "react";

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
};

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

  return (
    <div>
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
              <span style={{ color: "#6B7169", fontSize: 12 }}>{f.count ?? 0} item{f.count === 1 ? "" : "s"}</span>
            </button>
          ))}
        </div>
      )}

      {/* photos & videos grid */}
      {media.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginBottom: 18 }}>
          {media.map((m) => {
            const isVideo = VIDEO.test(m.name);
            const canShow = isVideo || SHOWABLE_IMG.test(m.name);
            return (
              <button key={m.path} onClick={() => setLightbox(m)} style={mediaTile} title={m.name}>
                {!isVideo && canShow ? (
                  <img src={urls.fileUrl(m.path, false)} loading="lazy" alt={m.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={tilePlaceholder}>
                    <span style={{ fontSize: 30 }}>{isVideo ? "▶" : "🖼"}</span>
                    <span style={{ fontSize: 11, color: "#eee", padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", textAlign: "center" }}>{m.name}</span>
                  </div>
                )}
                {isVideo && <span style={playBadge}>▶</span>}
              </button>
            );
          })}
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

      {lightbox && (
        <Lightbox entry={lightbox} urls={urls} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function Lightbox({ entry, urls, onClose }: { entry: Entry; urls: BrowserUrls; onClose: () => void }) {
  const isVideo = VIDEO.test(entry.name);
  const canShow = isVideo || SHOWABLE_IMG.test(entry.name);
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
          <img src={urls.fileUrl(entry.path, false)} alt={entry.name}
            style={{ maxWidth: "94vw", maxHeight: "78vh", borderRadius: 8, objectFit: "contain" }} />
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
  background: "#fff", border: "1px solid #E4E2DA", borderRadius: 10, cursor: "pointer", font: "inherit", color: "inherit", textAlign: "center",
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

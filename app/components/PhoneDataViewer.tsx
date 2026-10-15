"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BackupBrowser, { type BrowserUrls } from "./BackupBrowser";
import SensitiveImg from "./SensitiveImg";

/**
 * A full-screen reader for one phone's backup: texts as a chat, the call log,
 * contacts, and the installed-app list. Opened from the Phones page. Each tab
 * loads its data the first time it's shown; a phone with nothing backed up
 * yet just says so.
 */
type Tab = "media" | "texts" | "calls" | "contacts" | "apps";

export default function PhoneDataViewer({ phoneId, phoneName, onClose }: { phoneId: string; phoneName: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("media");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={overlay}>
      <div style={sheet}>
        <header style={head}>
          <strong style={{ fontSize: 16 }}>{phoneName}</strong>
          <nav style={tabs}>
            {(["media", "texts", "calls", "contacts", "apps"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{ ...tabBtn, ...(tab === t ? tabActive : {}) }}>
                {t === "media" ? "Photos & videos" : t === "texts" ? "Texts" : t === "calls" ? "Calls" : t === "contacts" ? "Contacts" : "Apps"}
              </button>
            ))}
          </nav>
          <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
        </header>
        <div style={body}>
          {tab === "media" && <MediaTab phoneId={phoneId} />}
          {tab === "texts" && <TextsTab phoneId={phoneId} />}
          {tab === "calls" && <CallsTab phoneId={phoneId} />}
          {tab === "contacts" && <ContactsTab phoneId={phoneId} />}
          {tab === "apps" && <AppsTab phoneId={phoneId} />}
        </div>
      </div>
    </div>
  );
}

// ---- shared data loading ----

function useJson<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true); setErr("");
    fetch(url, { cache: "no-store" })
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b?.error || "Couldn't load that."); return b; })
      .then((b) => { if (live) setData(b); })
      .catch((e) => { if (live) setErr(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [url]);
  return { data, err, loading };
}

function fmtDate(ms: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDay(ms: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function Empty({ what }: { what: string }) {
  return <p style={{ color: "var(--muted)", padding: 20 }}>No {what} backed up yet.</p>;
}
function Loading() { return <p style={{ color: "var(--muted)", padding: 20 }}>Loading…</p>; }
function ErrorMsg({ msg }: { msg: string }) { return <p style={{ color: "var(--expense)", padding: 20 }}>{msg}</p>; }

// ---- Texts ----

type Attachment = { path: string; ct: string; name?: string };
type SmsMessage = { dir: "in" | "out"; body: string; date: number; attachments?: Attachment[]; from?: string };
type Conversation = { key: string; name: string; address: string; count: number; lastDate: number; messages: SmsMessage[] };

function TextsTab({ phoneId }: { phoneId: string }) {
  const { data, err, loading } = useJson<{ conversations: Conversation[]; backedUpAt: string | null }>(`/api/phones/${phoneId}/texts`);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const fileUrl = (path: string, dl: boolean) => `/api/phones/${phoneId}/file?p=${encodeURIComponent(path)}${dl ? "&download=1" : ""}`;

  if (loading) return <Loading />;
  if (err) return <ErrorMsg msg={err} />;
  const convos = data?.conversations || [];
  if (convos.length === 0) return <Empty what="text messages" />;

  const filtered = convos.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.address.includes(q));
  const open = convos.find((c) => c.key === openKey) || null;

  return (
    <div style={splitWrap}>
      <div style={{ ...listPane, display: open ? undefined : "flex" }} data-open={!!open}>
        <input placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} style={search} />
        <div style={{ overflowY: "auto" }}>
          {filtered.map((c) => (
            <button key={c.key} onClick={() => setOpenKey(c.key)} style={{ ...convRow, ...(c.key === openKey ? rowActive : {}) }}>
              <div style={avatar}>{c.name.slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{c.count} message{c.count === 1 ? "" : "s"} · {fmtDay(c.lastDate)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div style={{ ...threadPane, display: open ? "flex" : "none" }}>
        {open && (
          <>
            <div style={threadHead}>
              <button onClick={() => setOpenKey(null)} style={backBtn}>‹ All</button>
              <strong>{open.name}</strong>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>{open.address}</span>
            </div>
            {/* column-reverse: the thread opens scrolled to the newest message, like a phone. */}
            <div key={open.key} style={bubbleScroll}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {open.messages.map((msg, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.dir === "out" ? "flex-end" : "flex-start" }}>
                    {msg.from && <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 2px 6px" }}>{msg.from}</div>}
                    <div style={{ ...bubble, ...(msg.dir === "out" ? bubbleOut : bubbleIn) }}>
                      {msg.attachments?.map((a, j) => <MmsAttachment key={j} a={a} fileUrl={fileUrl} />)}
                      {(msg.body || !msg.attachments?.length) && (
                        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.body || <em style={{ opacity: .6 }}>(no text)</em>}</div>
                      )}
                      <div style={{ fontSize: 10.5, opacity: 0.65, marginTop: 3, textAlign: "right" }}>{fmtDate(msg.date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Calls ----

type Call = { dir: string; name: string; number: string; duration: number; date: number };
const CALL_ICON: Record<string, string> = { in: "↙", out: "↗", missed: "✖", rejected: "⦸", blocked: "⛔", voicemail: "✉", other: "•" };
const CALL_COLOR: Record<string, string> = { in: "var(--accent)", out: "var(--accent)", missed: "var(--expense)", rejected: "var(--expense)", blocked: "var(--expense)", voicemail: "var(--gold)", other: "var(--muted)" };
function dur(s: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60), sec = s % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
}
function CallsTab({ phoneId }: { phoneId: string }) {
  const { data, err, loading } = useJson<{ calls: Call[] }>(`/api/phones/${phoneId}/calls`);
  if (loading) return <Loading />;
  if (err) return <ErrorMsg msg={err} />;
  const calls = data?.calls || [];
  if (calls.length === 0) return <Empty what="calls" />;
  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "4px 0" }}>
      {calls.map((c, i) => (
        <div key={i} style={callRow}>
          <span style={{ color: CALL_COLOR[c.dir], fontSize: 18, width: 22, textAlign: "center" }}>{CALL_ICON[c.dir] || "•"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
            <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{c.dir === "missed" ? "Missed" : c.dir[0].toUpperCase() + c.dir.slice(1)} · {dur(c.duration)}</div>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "right", flex: "none" }}>{fmtDate(c.date)}</div>
        </div>
      ))}
    </div>
  );
}

// ---- Contacts ----

type Contact = { name: string; phones: string[]; emails: string[] };
function ContactsTab({ phoneId }: { phoneId: string }) {
  const { data, err, loading } = useJson<{ contacts: Contact[] }>(`/api/phones/${phoneId}/contacts`);
  const [q, setQ] = useState("");
  if (loading) return <Loading />;
  if (err) return <ErrorMsg msg={err} />;
  const all = data?.contacts || [];
  if (all.length === 0) return <Empty what="contacts" />;
  const list = all.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.phones.join(" ").includes(q));
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <input placeholder={`Search ${all.length} contacts…`} value={q} onChange={(e) => setQ(e.target.value)} style={{ ...search, margin: 10 }} />
      <div style={{ overflowY: "auto", flex: 1 }}>
        {list.map((c, i) => (
          <div key={i} style={contactRow}>
            <div style={avatar}>{c.name.slice(0, 1).toUpperCase()}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              {c.phones.map((p, j) => <div key={j} style={{ color: "var(--ink)", opacity: .8, fontSize: 13.5 }}>{p}</div>)}
              {c.emails.map((e, j) => <div key={j} style={{ color: "var(--muted)", fontSize: 13 }}>{e}</div>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Photos & videos (gallery) ----

type MediaItem = { path: string; name: string; size: number; mtime: string; video: boolean };

function MediaTab({ phoneId }: { phoneId: string }) {
  const { data, err, loading } = useJson<{ items: MediaItem[]; capped: boolean }>(`/api/phones/${phoneId}/media`);
  const [open, setOpen] = useState<number | null>(null);
  const fileUrl = (path: string, dl: boolean) => `/api/phones/${phoneId}/file?p=${encodeURIComponent(path)}${dl ? "&download=1" : ""}`;

  if (loading) return <Loading />;
  if (err) return <ErrorMsg msg={err} />;
  const items = data?.items || [];
  if (items.length === 0) return <Empty what="photos or videos" />;

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg)", padding: 3 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 3 }}>
        {items.map((m, i) => (
          <button key={m.path} onClick={() => setOpen(i)} style={galTile} title={m.name}>
            {m.video || /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(m.name) ? (
              m.video ? (
                <div style={galPlaceholder}><span style={{ fontSize: 26, color: "#fff" }}>▶</span></div>
              ) : (
                <SensitiveImg src={fileUrl(m.path, false)} thumb={`${fileUrl(m.path, false)}&thumb=1`} fill compact />
              )
            ) : (
              <div style={galPlaceholder}><span style={{ fontSize: 22, color: "#bbb" }}>HEIC</span></div>
            )}
            {m.video && <span style={galPlay}>▶</span>}
          </button>
        ))}
      </div>
      {data?.capped && <p style={{ color: "#aaa", textAlign: "center", padding: 12, fontSize: 13 }}>Showing the newest 4,000. Browse all on the Phones page.</p>}
      {open !== null && (
        <GalleryLightbox items={items} index={open} fileUrl={fileUrl} onClose={() => setOpen(null)} onNav={setOpen} />
      )}
    </div>
  );
}

function GalleryLightbox({ items, index, fileUrl, onClose, onNav }: {
  items: MediaItem[]; index: number; fileUrl: (p: string, d: boolean) => string; onClose: () => void; onNav: (i: number) => void;
}) {
  const m = items[index];
  const isImg = /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(m.name);
  const prev = () => onNav((index - 1 + items.length) % items.length);
  const next = () => onNav((index + 1) % items.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div onClick={onClose} style={overlay}>
      <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
      <button onClick={(e) => { e.stopPropagation(); prev(); }} style={{ ...navArrow, left: 10 }} aria-label="Previous">‹</button>
      <button onClick={(e) => { e.stopPropagation(); next(); }} style={{ ...navArrow, right: 10 }} aria-label="Next">›</button>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "90vw", maxHeight: "86vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        {m.video ? (
          <video src={fileUrl(m.path, false)} controls autoPlay playsInline style={{ maxWidth: "90vw", maxHeight: "78vh", borderRadius: 8, background: "#000" }} />
        ) : isImg ? (
          <SensitiveImg key={m.path} src={fileUrl(m.path, false)} alt={m.name} imgStyle={{ maxWidth: "90vw", maxHeight: "78vh", objectFit: "contain", borderRadius: 8 }} />
        ) : (
          <div style={{ color: "#fff" }}>This photo (HEIC) can&apos;t preview in a browser.</div>
        )}
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ color: "#ccc", fontSize: 13 }}>{index + 1} of {items.length}</span>
          <a href={fileUrl(m.path, true)} style={{ color: "#8Fd0aa" }}>Download</a>
        </div>
      </div>
    </div>
  );
}

/** A photo, video or voice clip from a picture message, inside its bubble. */
function MmsAttachment({ a, fileUrl }: { a: Attachment; fileUrl: (p: string, dl: boolean) => string }) {
  const ct = (a.ct || "").toLowerCase();
  const full = fileUrl(a.path, false);
  const box: React.CSSProperties = { margin: "2px 0 6px", borderRadius: 10, overflow: "hidden", maxWidth: 260 };
  if (ct.startsWith("image/") && !/hei[cf]/.test(ct)) {
    return (
      <a href={full} target="_blank" rel="noreferrer" style={{ ...box, display: "block" }}>
        <SensitiveImg src={full} thumb={`${full}&thumb=1`} alt={a.name || "Picture message"}
          imgStyle={{ maxWidth: 260, maxHeight: 320, width: "100%", objectFit: "cover", borderRadius: 10 }} />
      </a>
    );
  }
  if (ct.startsWith("video/")) {
    return <div style={box}><video src={full} controls preload="none" playsInline style={{ width: "100%", maxHeight: 320, background: "#000", display: "block" }} /></div>;
  }
  if (ct.startsWith("audio/")) {
    return <div style={{ margin: "2px 0 6px" }}><audio src={full} controls preload="none" style={{ maxWidth: 240 }} /></div>;
  }
  return (
    <div style={{ margin: "2px 0 6px" }}>
      <a href={fileUrl(a.path, true)} style={{ color: "inherit", textDecoration: "underline" }}>📎 {a.name || "Attachment"}</a>
    </div>
  );
}

// ---- Apps ----

type AppRow = { label: string; pkg: string; version: string; source: string; installed: string };
function AppsTab({ phoneId }: { phoneId: string }) {
  const { data, err, loading } = useJson<{ apps: AppRow[] }>(`/api/phones/${phoneId}/apps`);
  const [q, setQ] = useState("");
  if (loading) return <Loading />;
  if (err) return <ErrorMsg msg={err} />;
  const all = data?.apps || [];
  if (all.length === 0) return <Empty what="app list" />;
  const list = all.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()) || a.pkg.includes(q));
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <input placeholder={`Search ${all.length} apps…`} value={q} onChange={(e) => setQ(e.target.value)} style={{ ...search, margin: 10 }} />
      <div style={{ overflowY: "auto", flex: 1 }}>
        {list.map((a, i) => (
          <div key={i} style={contactRow}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{a.label}</div>
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{a.pkg}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{a.version ? `v${a.version} · ` : ""}{a.source}{a.installed ? ` · ${a.installed}` : ""}</div>
            </div>
            <a href={`https://play.google.com/store/apps/details?id=${encodeURIComponent(a.pkg)}`} target="_blank" rel="noreferrer" style={{ flex: "none", fontSize: 13 }}>Store</a>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- styles ----

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "2vh 2vw" };
const sheet: React.CSSProperties = { background: "var(--surface)", color: "var(--ink)", borderRadius: 14, width: "min(900px, 100%)", height: "96vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 10px 40px rgba(0,0,0,.3)" };
const head: React.CSSProperties = { display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderBottom: "1px solid var(--line-strong)", flexWrap: "wrap" };
const tabs: React.CSSProperties = { display: "flex", gap: 4, flex: 1, flexWrap: "wrap" };
const tabBtn: React.CSSProperties = { border: 0, background: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", font: "inherit", color: "var(--muted)", fontWeight: 600 };
const tabActive: React.CSSProperties = { background: "var(--accent)", color: "var(--on-accent)" };
const closeBtn: React.CSSProperties = { border: 0, background: "none", fontSize: 26, cursor: "pointer", color: "var(--muted)", lineHeight: 1 };
const body: React.CSSProperties = { flex: 1, minHeight: 0, background: "var(--bg)" };
const splitWrap: React.CSSProperties = { display: "flex", height: "100%" };
const listPane: React.CSSProperties = { width: 290, borderRight: "1px solid var(--line-strong)", flexDirection: "column", minWidth: 0, flex: "none" };
const threadPane: React.CSSProperties = { flex: 1, flexDirection: "column", minWidth: 0 };
const search: React.CSSProperties = { margin: 10, padding: "9px 11px", border: "1px solid var(--line-strong)", borderRadius: 9, font: "inherit", background: "var(--surface)", color: "var(--ink)" };
const convRow: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", color: "inherit", border: 0, borderBottom: "1px solid var(--line)", background: "none", padding: "10px 12px", cursor: "pointer", font: "inherit" };
const rowActive: React.CSSProperties = { background: "var(--accent-soft)" };
const avatar: React.CSSProperties = { width: 36, height: 36, borderRadius: "50%", background: "var(--accent)", color: "var(--on-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flex: "none" };
const threadHead: React.CSSProperties = { display: "flex", gap: 10, alignItems: "baseline", padding: "10px 14px", borderBottom: "1px solid var(--line-strong)", background: "var(--surface)" };
const backBtn: React.CSSProperties = { border: 0, background: "none", color: "var(--accent)", cursor: "pointer", font: "inherit", fontWeight: 600, padding: 0 };
const bubbleScroll: React.CSSProperties = { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column-reverse" };
const bubble: React.CSSProperties = { maxWidth: "76%", padding: "8px 11px", borderRadius: 14, fontSize: 14.5, lineHeight: 1.35 };
const bubbleIn: React.CSSProperties = { background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line-strong)", borderBottomLeftRadius: 4 };
const bubbleOut: React.CSSProperties = { background: "var(--accent)", color: "var(--on-accent)", borderBottomRightRadius: 4 };
const callRow: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line)" };
const contactRow: React.CSSProperties = { display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 14px", borderBottom: "1px solid var(--line)" };
const galTile: React.CSSProperties = { position: "relative", aspectRatio: "1 / 1", padding: 0, border: 0, overflow: "hidden", cursor: "pointer", background: "#222" };
const galPlaceholder: React.CSSProperties = { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#333" };
const galPlay: React.CSSProperties = { position: "absolute", bottom: 5, right: 5, background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 20, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 };
const navArrow: React.CSSProperties = { position: "fixed", top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,.4)", border: 0, color: "#fff", fontSize: 40, width: 50, height: 70, cursor: "pointer", borderRadius: 8, zIndex: 1001 };

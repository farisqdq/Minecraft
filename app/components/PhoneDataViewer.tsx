"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * A full-screen reader for one phone's backup: texts as a chat, the call log,
 * contacts, and the installed-app list. Opened from the Phones page. Each tab
 * loads its data the first time it's shown; a phone with nothing backed up
 * yet just says so.
 */
type Tab = "texts" | "calls" | "contacts" | "apps";

export default function PhoneDataViewer({ phoneId, phoneName, onClose }: { phoneId: string; phoneName: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("texts");
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
            {(["texts", "calls", "contacts", "apps"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{ ...tabBtn, ...(tab === t ? tabActive : {}) }}>
                {t === "texts" ? "Texts" : t === "calls" ? "Calls" : t === "contacts" ? "Contacts" : "Apps"}
              </button>
            ))}
          </nav>
          <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
        </header>
        <div style={body}>
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
  return <p style={{ color: "#6B7169", padding: 20 }}>No {what} backed up yet.</p>;
}
function Loading() { return <p style={{ color: "#6B7169", padding: 20 }}>Loading…</p>; }
function ErrorMsg({ msg }: { msg: string }) { return <p style={{ color: "#B23A3A", padding: 20 }}>{msg}</p>; }

// ---- Texts ----

type SmsMessage = { dir: "in" | "out"; body: string; date: number };
type Conversation = { key: string; name: string; address: string; count: number; lastDate: number; messages: SmsMessage[] };

function TextsTab({ phoneId }: { phoneId: string }) {
  const { data, err, loading } = useJson<{ conversations: Conversation[]; backedUpAt: string | null }>(`/api/phones/${phoneId}/texts`);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [q, setQ] = useState("");

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
                <div style={{ color: "#6B7169", fontSize: 12.5 }}>{c.count} message{c.count === 1 ? "" : "s"} · {fmtDay(c.lastDate)}</div>
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
              <span style={{ color: "#6B7169", fontSize: 13 }}>{open.address}</span>
            </div>
            <div style={bubbleScroll}>
              {open.messages.map((msg, i) => (
                <div key={i} style={{ display: "flex", justifyContent: msg.dir === "out" ? "flex-end" : "flex-start" }}>
                  <div style={{ ...bubble, ...(msg.dir === "out" ? bubbleOut : bubbleIn) }}>
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.body || <em style={{ opacity: .6 }}>(no text)</em>}</div>
                    <div style={{ fontSize: 10.5, opacity: 0.65, marginTop: 3, textAlign: "right" }}>{fmtDate(msg.date)}</div>
                  </div>
                </div>
              ))}
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
const CALL_COLOR: Record<string, string> = { in: "#2E6A48", out: "#2E6A48", missed: "#B23A3A", rejected: "#B23A3A", blocked: "#B23A3A", voicemail: "#A6651B", other: "#6B7169" };
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
            <div style={{ color: "#6B7169", fontSize: 12.5 }}>{c.dir === "missed" ? "Missed" : c.dir[0].toUpperCase() + c.dir.slice(1)} · {dur(c.duration)}</div>
          </div>
          <div style={{ color: "#6B7169", fontSize: 12.5, textAlign: "right", flex: "none" }}>{fmtDate(c.date)}</div>
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
              {c.phones.map((p, j) => <div key={j} style={{ color: "#4a4f45", fontSize: 13.5 }}>{p}</div>)}
              {c.emails.map((e, j) => <div key={j} style={{ color: "#6B7169", fontSize: 13 }}>{e}</div>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Apps ----

function AppsTab({ phoneId }: { phoneId: string }) {
  const { data, err, loading } = useJson<{ path: string | null }>(`/api/phones/${phoneId}/apps`);
  if (loading) return <Loading />;
  if (err) return <ErrorMsg msg={err} />;
  if (!data?.path) return <Empty what="app list" />;
  const src = `/api/phones/${phoneId}/file?p=${encodeURIComponent(data.path)}`;
  return <iframe src={src} title="Installed apps" style={{ width: "100%", height: "100%", border: 0, background: "#fff" }} />;
}

// ---- styles ----

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "2vh 2vw" };
const sheet: React.CSSProperties = { background: "var(--card,#fff)", color: "#23281F", borderRadius: 14, width: "min(900px, 100%)", height: "96vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 10px 40px rgba(0,0,0,.3)" };
const head: React.CSSProperties = { display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderBottom: "1px solid #E4E2DA", flexWrap: "wrap" };
const tabs: React.CSSProperties = { display: "flex", gap: 4, flex: 1, flexWrap: "wrap" };
const tabBtn: React.CSSProperties = { border: 0, background: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", font: "inherit", color: "#6B7169", fontWeight: 600 };
const tabActive: React.CSSProperties = { background: "#2E6A48", color: "#fff" };
const closeBtn: React.CSSProperties = { border: 0, background: "none", fontSize: 26, cursor: "pointer", color: "#6B7169", lineHeight: 1 };
const body: React.CSSProperties = { flex: 1, minHeight: 0, background: "#F6F5F1" };
const splitWrap: React.CSSProperties = { display: "flex", height: "100%" };
const listPane: React.CSSProperties = { width: 290, borderRight: "1px solid #E4E2DA", flexDirection: "column", minWidth: 0, flex: "none" };
const threadPane: React.CSSProperties = { flex: 1, flexDirection: "column", minWidth: 0 };
const search: React.CSSProperties = { margin: 10, padding: "9px 11px", border: "1px solid #E4E2DA", borderRadius: 9, font: "inherit", background: "#fff" };
const convRow: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid #ECEAE3", background: "none", padding: "10px 12px", cursor: "pointer", font: "inherit" };
const rowActive: React.CSSProperties = { background: "#ECF2EE" };
const avatar: React.CSSProperties = { width: 36, height: 36, borderRadius: "50%", background: "#2E6A48", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flex: "none" };
const threadHead: React.CSSProperties = { display: "flex", gap: 10, alignItems: "baseline", padding: "10px 14px", borderBottom: "1px solid #E4E2DA", background: "#fff" };
const backBtn: React.CSSProperties = { border: 0, background: "none", color: "#2E6A48", cursor: "pointer", font: "inherit", fontWeight: 600, padding: 0 };
const bubbleScroll: React.CSSProperties = { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 6 };
const bubble: React.CSSProperties = { maxWidth: "76%", padding: "8px 11px", borderRadius: 14, fontSize: 14.5, lineHeight: 1.35 };
const bubbleIn: React.CSSProperties = { background: "#fff", border: "1px solid #E4E2DA", borderBottomLeftRadius: 4 };
const bubbleOut: React.CSSProperties = { background: "#2E6A48", color: "#fff", borderBottomRightRadius: 4 };
const callRow: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #ECEAE3" };
const contactRow: React.CSSProperties = { display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 14px", borderBottom: "1px solid #ECEAE3" };

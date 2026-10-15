"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import ConfirmDialog, { type ConfirmRequest } from "../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../components/Toasts";
import styles from "../dashboard.module.css";

type Report = {
  at?: number;
  sentFiles?: number;
  sentBytes?: number;
  counts?: Record<string, number>;
  skipped?: string[];
  problems?: string[];
  error?: string;
};
type Phone = {
  id: string;
  name: string;
  paired: boolean;
  pairCode?: string;
  pairExpires?: string;
  pairedAt?: string;
  model?: string;
  lastSeen?: string;
  report?: Report;
  bytes: number;
  files: number;
  backupRequested?: boolean;
  requestedAt?: string;
};
type Summary = {
  configured: boolean;
  host?: string;
  down?: boolean;
  error?: string;
  disk?: { free: number; total: number; minFree: number };
  devices?: Phone[];
};

function human(n?: number) {
  if (!n || n < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, b = n;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function Ago({ at }: { at?: number | string }) {
  const [t, setT] = useState("");
  useEffect(() => {
    if (!at) { setT(""); return; }
    const ms = typeof at === "number" ? at : Date.parse(at);
    if (!ms) { setT(""); return; }
    const s = (Date.now() - ms) / 1000;
    setT(
      s < 90 ? "just now" :
      s < 5400 ? `${Math.round(s / 60)} min ago` :
      s < 129600 ? `${Math.round(s / 3600)} hr ago` :
      `${Math.round(s / 86400)} days ago`
    );
  }, [at]);
  return <>{t}</>;
}

/** The company phones and what they've backed up. Admin only. */
export default function PhonesClient({ openRepairs, initial }: { openRepairs?: number; initial: Summary }) {
  const [data, setData] = useState<Summary>(initial);
  const [busy, setBusy] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const { toasts, push, dismiss } = useToasts();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/phones", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch { /* leave the last good view up */ }
  }, []);

  // While any phone has a backup requested or running, poll so status moves.
  useEffect(() => {
    const active = (data.devices || []).some((d) => d.backupRequested);
    if (active && !pollRef.current) {
      pollRef.current = setInterval(refresh, 5000);
    } else if (!active && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [data, refresh]);

  async function act(url: string, init: RequestInit, ok: string) {
    setBusy(url);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { push(body?.error || "That didn't work.", "bad"); return null; }
      push(ok, "good");
      await refresh();
      return body;
    } catch {
      push("Couldn't reach the server.", "bad");
      return null;
    } finally {
      setBusy("");
    }
  }

  const addPhone = async () => {
    const name = newName.trim();
    if (!name) return;
    const made = await act("/api/phones", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    }, "Phone added.");
    if (made) setNewName("");
  };

  const requestBackup = (p: Phone) =>
    act(`/api/phones/${p.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request" }) },
      "Backup requested — the phone will start shortly.");

  const newCode = (p: Phone) =>
    act(`/api/phones/${p.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "code" }) },
      "New setup code ready.");

  // Returns the link (doesn't refresh the list — nothing changed server-side).
  const restoreLink = async (p: Phone): Promise<string | null> => {
    try {
      const res = await fetch(`/api/phones/${p.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore-link" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { push(body?.error || "Couldn't make a restore link.", "bad"); return null; }
      return body.link as string;
    } catch {
      push("Couldn't reach the server.", "bad");
      return null;
    }
  };

  const rename = (p: Phone) => {
    const name = prompt("New name for this phone:", p.name);
    if (name && name.trim() && name.trim() !== p.name) {
      act(`/api/phones/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }, "Renamed.");
    }
  };

  const remove = (p: Phone) => {
    setConfirm({
      title: `Remove ${p.name}?`,
      body: "The phone stops backing up. The files it already backed up are kept on the server (you can delete them there if you want to).",
      confirmLabel: "Remove phone",
      cancelLabel: "Cancel",
      onConfirm: () => act(`/api/phones/${p.id}`, { method: "DELETE" }, "Phone removed; its files were kept."),
    });
  };

  if (!data.configured) {
    return (
      <AppShell openRepairs={openRepairs} title="Phones" tagline="Back up the company phones.">
        <section className={styles.block}>
          <div className={styles.formCard}>
            <p className={styles.helpText} style={{ marginTop: 0 }}>
              The backup server isn&apos;t connected yet. Once the two settings
              <code> PHONE_BACKUP_URL</code> and <code> PHONE_BACKUP_SECRET</code> are added, this page shows your phones.
            </p>
          </div>
        </section>
      </AppShell>
    );
  }

  const disk = data.disk;
  const usedPct = disk && disk.total ? Math.min(100, Math.round(((disk.total - disk.free) / disk.total) * 100)) : 0;
  const lowDisk = disk ? disk.free < disk.minFree : false;

  return (
    <AppShell openRepairs={openRepairs} title="Phones" tagline="Back up the company phones.">
      <Toasts toasts={toasts} onDismiss={dismiss} />
      {confirm && <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />}

      {data.down && (
        <div className={styles.errorBar}>
          The backup server on your VPS didn&apos;t answer. It may be off or offline. {data.error}
        </div>
      )}

      {disk && (
        <section className={styles.block}>
          <div className={styles.formCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <strong>{data.host}</strong>
              <span className={styles.helpText} style={{ margin: 0 }}>
                {human(disk.free)} free of {human(disk.total)}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 6, background: "var(--line, #e4e2da)", marginTop: 10, overflow: "hidden" }}>
              <div style={{ width: `${usedPct}%`, height: "100%", background: lowDisk ? "#B23A3A" : "#2E6A48" }} />
            </div>
            {lowDisk && <p className={styles.helpText} style={{ color: "#B23A3A" }}>Running low — phones will pause backing up until there&apos;s room.</p>}
          </div>
        </section>
      )}

      <section className={styles.block}>
        <div className={styles.blockHead}><h2>Add a phone</h2></div>
        <div className={styles.formCard}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Name the phone, then on that phone open <strong>Rent Roll → ☁ Backup</strong> and type the setup code it gives you.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              style={{ flex: 1, padding: "10px 12px", border: "1px solid var(--line,#e4e2da)", borderRadius: 10, font: "inherit", background: "var(--card,#fff)", color: "inherit" }}
              placeholder="e.g. Romeo's phone"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addPhone()}
            />
            <button className={`${styles.btn} ${styles.primary}`} disabled={!newName.trim() || busy === "/api/phones"} onClick={addPhone}>
              Add phone
            </button>
          </div>
        </div>
      </section>

      {(data.devices || []).length === 0 && (
        <section className={styles.block}><div className={styles.formCard}><p className={styles.helpText} style={{ margin: 0 }}>No phones yet.</p></div></section>
      )}

      {(data.devices || []).map((p) => (
        <PhoneCard
          key={p.id}
          p={p}
          busy={busy}
          onRequest={() => requestBackup(p)}
          onCode={() => newCode(p)}
          onRename={() => rename(p)}
          onRemove={() => remove(p)}
          onRestoreLink={() => restoreLink(p)}
        />
      ))}
    </AppShell>
  );
}

function PhoneCard({
  p, busy, onRequest, onCode, onRename, onRemove, onRestoreLink,
}: {
  p: Phone; busy: string;
  onRequest: () => void; onCode: () => void; onRename: () => void; onRemove: () => void;
  onRestoreLink: () => Promise<string | null>;
}) {
  const [browse, setBrowse] = useState(false);
  const [restore, setRestore] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const makeRestore = async () => {
    const link = await onRestoreLink();
    if (link) { setRestore(link); setCopied(false); }
  };
  const copyRestore = async () => {
    try { await navigator.clipboard.writeText(restore); setCopied(true); } catch { /* user can select it */ }
  };
  const r = p.report;
  const counts = r?.counts || {};
  const order: [string, string][] = [
    ["photos", "Photos"], ["videos", "Videos"], ["files", "Files"],
    ["contacts", "Contacts"], ["calls", "Calls"], ["texts", "Texts"], ["apps", "Apps"],
  ];
  const cells = order.filter(([k]) => counts[k] != null && counts[k] >= 0);

  return (
    <section className={styles.block}>
      <div className={styles.formCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <strong style={{ fontSize: 16 }}>{p.name}</strong>
            <div className={styles.helpText} style={{ margin: "2px 0 0" }}>
              {p.model ? `${p.model} · ` : ""}{human(p.bytes)} backed up
              {p.lastSeen ? <> · last seen <Ago at={p.lastSeen} /></> : ""}
            </div>
          </div>
          <StatusPill p={p} />
        </div>

        {!p.paired && p.pairCode && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--bg,#f6f5f1)", textAlign: "center" }}>
            <div className={styles.helpText} style={{ margin: 0 }}>Setup code — type it on the phone</div>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 26, letterSpacing: 4, fontWeight: 700 }}>{p.pairCode}</div>
            <div className={styles.helpText} style={{ margin: 0 }}>Expires in 7 days.</div>
          </div>
        )}

        {r && (r.sentFiles != null || r.error) && (
          <div style={{ marginTop: 12 }}>
            {r.error ? (
              <div className={styles.helpText} style={{ color: "#A6651B", margin: 0 }}>Last backup: {r.error}</div>
            ) : (
              <div className={styles.helpText} style={{ margin: 0 }}>
                Last backup <Ago at={r.at} />: sent {r.sentFiles} new file{r.sentFiles === 1 ? "" : "s"}, {human(r.sentBytes)}.
                {r.problems && r.problems.length ? ` ${r.problems.length} couldn't be copied.` : ""}
              </div>
            )}
            {cells.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))", gap: 6, marginTop: 10 }}>
                {cells.map(([k, label]) => (
                  <div key={k} style={{ background: "var(--bg,#f6f5f1)", border: "1px solid var(--line,#e4e2da)", borderRadius: 8, padding: "6px 8px" }}>
                    <div style={{ fontWeight: 600 }}>{counts[k]}</div>
                    <div className={styles.helpText} style={{ margin: 0, fontSize: 12 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={styles.formFoot} style={{ justifyContent: "flex-start", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {p.paired && (
            <button className={`${styles.btn} ${styles.primary}`} disabled={!!busy || p.backupRequested} onClick={onRequest}>
              {p.backupRequested ? "Waiting for phone…" : "Back up now"}
            </button>
          )}
          {p.paired && <button className={styles.btn} onClick={() => setBrowse((b) => !b)}>{browse ? "Hide files" : "Browse files"}</button>}
          {p.paired && <button className={styles.btn} onClick={makeRestore}>Send restore link</button>}
          <button className={styles.btn} onClick={onCode}>{p.paired ? "Replace phone" : "New code"}</button>
          <button className={styles.btn} onClick={onRename}>Rename</button>
          <button className={styles.btn} onClick={onRemove}>Remove</button>
        </div>

        {restore && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--bg,#f6f5f1)", border: "1px solid var(--line,#e4e2da)" }}>
            <div className={styles.helpText} style={{ margin: "0 0 6px" }}>
              Send this link to whoever has {p.name}. It opens their backup to download, no login, and expires in 7 days.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input readOnly value={restore} onFocus={(e) => e.currentTarget.select()}
                style={{ flex: 1, minWidth: 220, padding: "8px 10px", border: "1px solid var(--line,#e4e2da)", borderRadius: 8, font: "inherit", background: "var(--card,#fff)", color: "inherit" }} />
              <button className={`${styles.btn} ${styles.primary}`} onClick={copyRestore}>{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>
        )}

        {browse && <FileBrowser phoneId={p.id} />}
      </div>
    </section>
  );
}

function StatusPill({ p }: { p: Phone }) {
  let label = "Not set up", color = "#8A8F82";
  if (p.backupRequested) { label = "Backup requested"; color = "#A6651B"; }
  else if (p.paired) { label = "Active"; color = "#2E6A48"; }
  return (
    <span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: "#fff", background: color, borderRadius: 20, padding: "4px 10px" }}>
      {label}
    </span>
  );
}

function FileBrowser({ phoneId }: { phoneId: string }) {
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<any[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async (d: string) => {
    setErr(""); setEntries(null);
    try {
      const res = await fetch(`/api/phones/${phoneId}/files?dir=${encodeURIComponent(d)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) { setErr(body?.error || "Couldn't open that folder."); return; }
      setDir(body.dir === "." ? "" : body.dir);
      setEntries(body.entries || []);
    } catch { setErr("Couldn't reach the server."); }
  }, [phoneId]);

  useEffect(() => { load(""); }, [load]);

  const up = () => {
    const parts = dir.split("/").filter(Boolean);
    parts.pop();
    load(parts.join("/"));
  };

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--line,#e4e2da)", paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {dir && <button className={styles.btn} onClick={up}>↑ Up</button>}
        <span className={styles.helpText} style={{ margin: 0 }}>/{dir}</span>
      </div>
      {err && <div className={styles.helpText} style={{ color: "#B23A3A" }}>{err}</div>}
      {entries === null && !err && <div className={styles.helpText}>Loading…</div>}
      {entries && entries.length === 0 && <div className={styles.helpText}>Nothing here.</div>}
      <div>
        {(entries || []).map((e) => e.dir ? (
          <button key={e.path} onClick={() => load(e.path)} style={rowStyle}>
            <span>📁 {e.name}</span>
            <span className={styles.helpText} style={{ margin: 0 }}>{e.count ?? ""} item{e.count === 1 ? "" : "s"}</span>
          </button>
        ) : (
          <div key={e.path} style={rowStyle}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {e.name}</span>
            <span style={{ display: "flex", gap: 10, alignItems: "center", flex: "none" }}>
              <span className={styles.helpText} style={{ margin: 0 }}>{human(e.size)}</span>
              <a href={`/api/phones/${phoneId}/file?p=${encodeURIComponent(e.path)}`} target="_blank" rel="noreferrer">View</a>
              <a href={`/api/phones/${phoneId}/file?p=${encodeURIComponent(e.path)}&download=1`}>Download</a>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
  width: "100%", textAlign: "left", background: "none", border: "0",
  borderBottom: "1px solid var(--line,#e4e2da)", padding: "9px 2px", font: "inherit", cursor: "pointer",
};

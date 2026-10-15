"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import ConfirmDialog, { type ConfirmRequest } from "../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../components/Toasts";
import PhoneDataViewer from "../../components/PhoneDataViewer";
import styles from "../dashboard.module.css";

type Report = {
  at?: number;
  sentFiles?: number;
  sentBytes?: number;
  counts?: Record<string, number>;
  skipped?: string[];
  problems?: string[];
  error?: string;
  // Live progress while a backup is running (app v1.6+ sends these mid-run).
  running?: boolean;
  done?: number;
  total?: number;
  bytesDone?: number;
  bytesTotal?: number;
  etaSec?: number;
  current?: string;
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
  appVersion?: string;
  // Anti-theft
  command?: string;          // queued, waiting for the phone's next check-in
  commandAt?: string;
  lastCmd?: string;          // last one the phone picked up
  lastCmdAt?: string;
  caps?: string;             // "admin=1;loc=always"
  loc?: { lat: number; lng: number; acc: number; at: string };
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

  // While any phone has a backup requested or running — or the backup server
  // didn't answer — poll so the page catches up on its own.
  useEffect(() => {
    const recent = (t?: string) => !!t && Date.now() - Date.parse(t) < 5 * 60 * 1000;
    const active = !!data.down || (data.devices || []).some((d) =>
      d.backupRequested || isLive(d.report) || !!d.command || recent(d.lastCmdAt));
    if (active && !pollRef.current) {
      pollRef.current = setInterval(refresh, data.down ? 15000 : 5000);
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

  const NAMES: Record<string, string> = { lock: "Lock", wipe: "Erase", locate: "Locate", cancel: "Cancel" };
  const sendCmd = (p: Phone, cmd: "lock" | "wipe" | "locate" | "cancel", confirmText?: string) =>
    act(`/api/phones/${p.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "command", cmd, confirm: confirmText }),
    }, cmd === "cancel" ? "Cancelled — nothing will be sent to the phone." : `${NAMES[cmd]} sent — the phone will act at its next check-in.`);

  const askCmd = (p: Phone, cmd: "lock" | "locate") => {
    if (cmd === "locate") { sendCmd(p, "locate"); return; }
    setConfirm({
      title: `Lock ${p.name}?`,
      body: "The screen locks at the phone's next check-in (usually within 15 minutes). Whoever has it will need the phone's PIN or pattern to get back in.",
      confirmLabel: "Lock phone",
      onConfirm: () => { setConfirm(null); sendCmd(p, "lock"); },
    });
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
          The backup server on your VPS isn&apos;t answering right now. Your backups are safe — this page will retry
          on its own every 15 seconds.
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

      {!data.down && (data.devices || []).length === 0 && (
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
          onCmd={(cmd) => askCmd(p, cmd)}
          onWipe={(text) => sendCmd(p, "wipe", text)}
          onCancelCmd={() => sendCmd(p, "cancel")}
        />
      ))}
    </AppShell>
  );
}

function PhoneCard({
  p, busy, onRequest, onCode, onRename, onRemove, onRestoreLink, onCmd, onWipe, onCancelCmd,
}: {
  p: Phone; busy: string;
  onRequest: () => void; onCode: () => void; onRename: () => void; onRemove: () => void;
  onRestoreLink: () => Promise<string | null>;
  onCmd: (cmd: "lock" | "locate") => void;
  onWipe: (typed: string) => Promise<unknown>;
  onCancelCmd: () => void;
}) {
  const [browse, setBrowse] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [restore, setRestore] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const makeRestore = async () => {
    const link = await onRestoreLink();
    if (link) { setRestore(link); setCopied(false); }
  };
  const copyRestore = async () => {
    try { await navigator.clipboard.writeText(restore); setCopied(true); } catch { /* user can select it */ }
  };
  const sendRestore = async () => {
    const text = `Here's the link to download the backup of ${p.name}. It works once, no login, and expires in 7 days:\n${restore}`;
    try {
      if (navigator.share) { await navigator.share({ title: "Phone backup", text }); return; }
    } catch { /* cancelled or unsupported */ }
    // No share sheet (desktop): open an email draft.
    window.location.href = `mailto:?subject=${encodeURIComponent("Your phone backup")}&body=${encodeURIComponent(text)}`;
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
              {p.appVersion ? ` · app v${p.appVersion}` : ""}
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

        {isLive(r) && <LiveProgress r={r!} />}

        {r && !isLive(r) && (r.sentFiles != null || r.error) && (
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

        {p.paired && <AntiTheft p={p} busy={!!busy} onCmd={onCmd} onWipe={onWipe} onCancelCmd={onCancelCmd} />}

        <div className={styles.formFoot} style={{ justifyContent: "flex-start", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {p.paired && (
            <button className={`${styles.btn} ${styles.primary}`} disabled={!!busy || p.backupRequested} onClick={onRequest}>
              {p.backupRequested ? "Waiting for phone…" : "Back up now"}
            </button>
          )}
          {p.paired && <button className={`${styles.btn} ${styles.primary}`} onClick={() => setViewer(true)}>View backup</button>}
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
              <button className={styles.btn} onClick={copyRestore}>{copied ? "Copied" : "Copy"}</button>
              <button className={`${styles.btn} ${styles.primary}`} onClick={sendRestore}>Send</button>
            </div>
          </div>
        )}

        {browse && <FileBrowser phoneId={p.id} />}
      </div>
      {viewer && <PhoneDataViewer phoneId={p.id} phoneName={p.name} onClose={() => setViewer(false)} />}
    </section>
  );
}

function StatusPill({ p }: { p: Phone }) {
  let label = "Not set up", color = "#8A8F82";
  if (isLive(p.report)) { label = "Backing up"; color = "#2E6A48"; }
  else if (p.backupRequested) { label = "Backup requested"; color = "#A6651B"; }
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

/** A running report counts only while fresh — a phone killed mid-backup stops sending. */
function isLive(r?: Report) {
  return !!r?.running && !!r.at && Date.now() - r.at < 3 * 60 * 1000;
}

function fmtEta(sec?: number) {
  if (sec == null || !isFinite(sec) || sec < 0) return "";
  if (sec < 60) return "under a minute left";
  const m = Math.round(sec / 60);
  if (m < 90) return `about ${m} min left`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `about ${h} hr${mm ? ` ${mm} min` : ""} left`;
}

/** The running backup: a bar by bytes (or files) and the phone's ETA. */
function LiveProgress({ r }: { r: Report }) {
  // Tick every second so the time left counts down between the phone's reports.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const since = r.at ? Math.max(0, (now - r.at) / 1000) : 0;
  const byBytes = !!r.bytesTotal && r.bytesTotal > 0;
  const pct = byBytes
    ? Math.min(100, Math.round(((r.bytesDone || 0) / r.bytesTotal!) * 100))
    : r.total ? Math.min(100, Math.round(((r.done || 0) / r.total) * 100)) : 0;
  const eta = fmtEta(r.etaSec != null ? Math.max(0, r.etaSec - since) : undefined);
  const ago = since < 5 ? "just now" : since < 90 ? `${Math.round(since)} s ago` : `${Math.round(since / 60)} min ago`;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14 }}>
        <strong>Backing up now — {pct}%</strong>
        <span className={styles.helpText} style={{ margin: 0 }}>{eta || "working out time left…"}</span>
      </div>
      <div style={{ height: 8, borderRadius: 6, background: "var(--line, #e4e2da)", marginTop: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#2E6A48", transition: "width .5s" }} />
      </div>
      <div className={styles.helpText} style={{ margin: "6px 0 0" }}>
        {r.total ? `${r.done || 0} of ${r.total} files` : ""}
        {byBytes ? ` · ${human(r.bytesDone)} of ${human(r.bytesTotal)}` : ""}
        {r.at ? ` · updated ${ago}` : ""}
      </div>
    </div>
  );
}

function parseCaps(caps?: string) {
  const m: Record<string, string> = {};
  for (const part of (caps || "").split(";")) { const [k, v] = part.split("="); if (k) m[k.trim()] = (v || "").trim(); }
  return { known: !!caps, admin: m.admin === "1", loc: m.loc || "none" };
}

/** Lost or stolen phone: Locate / Lock / Erase, and where it was last seen. */
function AntiTheft({ p, busy, onCmd, onWipe, onCancelCmd }: {
  p: Phone; busy: boolean;
  onCmd: (cmd: "lock" | "locate") => void;
  onWipe: (typed: string) => Promise<unknown>;
  onCancelCmd: () => void;
}) {
  const caps = parseCaps(p.caps);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const NAMES: Record<string, string> = { lock: "Lock", wipe: "Erase", locate: "Locate" };
  const box: React.CSSProperties = { marginTop: 14, padding: 12, borderRadius: 10, border: "1px solid var(--line-strong, #e4e2da)" };
  const pill = (on: boolean, text: string) => (
    <span style={{ fontSize: 12, fontWeight: 600, color: on ? "var(--accent)" : "var(--muted)" }}>{text}</span>
  );
  const needsSetup = !caps.admin || caps.loc !== "always";

  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong>If this phone is lost</strong>
        <span style={{ display: "flex", gap: 12 }}>
          {pill(caps.admin, caps.admin ? "Lock & erase: on" : "Lock & erase: off")}
          {pill(caps.loc === "always", caps.loc === "always" ? "Location: on" : caps.loc === "fg" ? "Location: only while open" : "Location: off")}
        </span>
      </div>

      {needsSetup && (
        <p className={styles.helpText} style={{ margin: "6px 0 0" }}>
          {caps.known ? "To turn these on" : "Needs app v1.7 or later. Then"}: on the phone, open Rent Roll → Settings → Phone backup →
          {" "}<b>If this phone is lost</b>, and tap Turn on / Allow.
        </p>
      )}

      {p.command && (
        <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: p.command === "wipe" ? "rgba(178,58,58,.12)" : "var(--accent-soft, #eef4f0)", display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5 }}>
            <b>{NAMES[p.command] || p.command}</b> is waiting for the phone — it happens at the next check-in (usually within 15 minutes).
          </span>
          <button className={styles.btn} disabled={busy} onClick={onCancelCmd}>Cancel</button>
        </div>
      )}
      {!p.command && p.lastCmd && p.lastCmdAt && (
        <p className={styles.helpText} style={{ margin: "8px 0 0" }}>
          {NAMES[p.lastCmd] || p.lastCmd} reached the phone <Ago at={p.lastCmdAt} />.
        </p>
      )}

      {p.loc && (
        <p style={{ margin: "8px 0 0", fontSize: 14 }}>
          📍 Last seen{" "}
          <a href={`https://www.google.com/maps?q=${p.loc.lat},${p.loc.lng}`} target="_blank" rel="noreferrer">on the map</a>
          {" "}· within {Math.max(1, Math.round(p.loc.acc))} m · <Ago at={p.loc.at} />
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className={styles.btn} disabled={busy || !!p.command} onClick={() => onCmd("locate")}>Locate</button>
        <button className={styles.btn} disabled={busy || !!p.command || !caps.admin} onClick={() => onCmd("lock")}>Lock</button>
        <button className={styles.btn} disabled={busy || !!p.command || !caps.admin} onClick={() => { setWipeOpen((o) => !o); setTyped(""); }}
          style={{ color: "var(--expense, #b42318)" }}>Erase phone…</button>
      </div>

      {wipeOpen && !p.command && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: "1px solid var(--expense, #b42318)" }}>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            <b>Erase everything on {p.name}?</b> The phone resets to factory settings at its next check-in. This can&apos;t be undone.
            Its backups on your server are kept.
          </p>
          <label className={styles.helpText} style={{ display: "block", margin: "0 0 6px" }}>Type <b>ERASE</b> to confirm</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters"
              style={{ padding: "9px 11px", border: "1px solid var(--line-strong, #e4e2da)", borderRadius: 9, font: "inherit", background: "transparent", color: "inherit", width: 140 }} />
            <button className={styles.btn} disabled={typed !== "ERASE" || busy}
              onClick={async () => { await onWipe(typed); setWipeOpen(false); setTyped(""); }}
              style={{ background: typed === "ERASE" ? "var(--expense, #b42318)" : undefined, color: typed === "ERASE" ? "#fff" : undefined }}>
              Erase phone
            </button>
            <button className={styles.btn} onClick={() => setWipeOpen(false)}>Never mind</button>
          </div>
        </div>
      )}
    </div>
  );
}

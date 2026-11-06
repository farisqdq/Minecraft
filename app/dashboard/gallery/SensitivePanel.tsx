"use client";

import { useCallback, useEffect, useState } from "react";
import type { SensitiveState } from "@/lib/phone-backup";
import styles from "../dashboard.module.css";

/**
 * The sensitive-photo check on the Gallery page: how many photos are flagged,
 * how far the backup server's scan has got, a button to re-scan everything,
 * and the lists the server saved along the way, any of which can be put
 * back. Re-scans and restores both save the current list first.
 */
export default function SensitivePanel({ phoneId }: { phoneId: string }) {
  const [state, setState] = useState<SensitiveState | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [showLists, setShowLists] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/phones/${phoneId}/sensitive`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Couldn't reach the backup server.");
      setState(body);
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [phoneId]);

  // Refresh every 15 s while a scan is running, every minute otherwise.
  useEffect(() => {
    load();
    const t = setInterval(load, state?.scan?.running ? 15000 : 60000);
    return () => clearInterval(t);
  }, [load, state?.scan?.running]);

  const act = async (body: object, label: string, confirmText: string) => {
    if (!confirm(confirmText)) return;
    setBusy(label);
    try {
      const res = await fetch(`/api/phones/${phoneId}/sensitive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error || "That didn't work.");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const scan = state?.scan;
  const running = !!scan?.running && !!scan.total;
  const left = running && scan!.perMinute ? Math.round((scan!.total! - scan!.done!) / scan!.perMinute) : 0;
  const leftText = left <= 0 ? "" : left < 60 ? `, about ${left} min left` : `, about ${Math.floor(left / 60)} hr ${left % 60} min left`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <strong>Sensitive photos</strong>
          <div style={{ fontSize: 13.5, opacity: 0.75, marginTop: 2 }}>
            {!state ? (err || "Loading…") :
              `${state.current.flagged.toLocaleString()} flagged` +
              (state.current.notSensitive ? ` · ${state.current.notSensitive.toLocaleString()} marked not sensitive` : "") +
              (running ? ` · checking ${scan!.done!.toLocaleString()} of ${scan!.total!.toLocaleString()}${leftText}`
                : scan?.pending || (state.current.checked === 0 && scan?.enabled) ? " · rescan starting…"
                : ` · ${state.current.checked.toLocaleString()} checked`)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className={styles.btn} disabled={!state || !!busy}
            onClick={() => act({ action: "rescan" }, "rescan", "Re-check every photo for sensitive content? Photos marked “not sensitive” stay that way, and the current list is saved first so you can put it back.")}>
            {busy === "rescan" ? "Starting…" : "Rescan all photos"}
          </button>
          <button type="button" className={styles.btn} disabled={!state} onClick={() => setShowLists((v) => !v)}>
            {showLists ? "Hide saved lists" : `Saved lists${state?.lists?.length ? ` (${state.lists.length})` : ""}`}
          </button>
        </div>
      </div>
      {err && state && <div style={{ color: "#B23A3A", fontSize: 13.5 }}>{err}</div>}
      {showLists && state && (
        <div style={{ borderTop: "1px solid rgba(127,127,127,.25)", paddingTop: 8 }}>
          {!state.lists?.length && <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>No saved lists yet. One is saved before each rescan or restore, and after scans that change something.</p>}
          {state.lists?.map((l) => (
            <div key={l.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(127,127,127,.15)", fontSize: 14 }}>
              <span>
                <strong>{new Date(l.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong>
                <span style={{ opacity: 0.7 }}> · {l.reason} · {l.counts.flagged.toLocaleString()} flagged of {l.counts.checked.toLocaleString()}</span>
              </span>
              <button type="button" className={styles.btn} disabled={!!busy}
                onClick={() => act({ action: "restore", name: l.name }, l.name, `Put back the list from ${new Date(l.at).toLocaleString()} (${l.counts.flagged} flagged)? The current list is saved first.`)}>
                {busy === l.name ? "Restoring…" : "Restore"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

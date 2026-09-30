"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmRequest } from "../../components/ConfirmDialog";
import styles from "../dashboard.module.css";
import s from "./admin-push.module.css";
import { formatDay } from "@/lib/lease";
import { PUSH_BODY_MAX, PUSH_LINK_MAX, PUSH_TITLE_MAX, checkCompose, type PushTarget } from "@/lib/push-rules";
import type { AdminDevice, AdminSnapshot } from "@/lib/admin-db";

const day = (iso: string) => formatDay(iso.slice(0, 10));

/** A local time, rendered only in the browser (the server's zone would differ and break hydration). */
function When({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  }, [iso]);
  return <>{text || " "}</>;
}

type Result = { id: string; device: string; who: string; sent: boolean; status?: number; error?: string; removed?: boolean };

const targetValue = (t: PushTarget) => (t.kind === "everyone" ? "everyone" : t.kind === "device" ? `device:${t.id}` : `person:${t.owner}`);

function targetFrom(value: string): PushTarget {
  if (value.startsWith("device:")) return { kind: "device", id: value.slice(7) };
  if (value.startsWith("person:")) return { kind: "person", owner: value.slice(7) };
  return { kind: "everyone" };
}

/**
 * The Admin page's Notifications section: every device with notifications
 * on and whose it is, a way to send one of the admin's own, and how each
 * device took it — the push service's status code when one refused, which
 * is what tells "this phone has an old key" from "the site's keys are
 * wrong".
 */
export default function AdminPush({
  devices,
  onSnapshot,
  confirm,
  toast,
}: {
  devices: AdminDevice[];
  onSnapshot: (snap: AdminSnapshot) => void;
  confirm: (req: ConfirmRequest | null) => void;
  toast: (message: string, tone?: "good" | "bad") => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [target, setTarget] = useState("everyone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const composeRef = useRef<HTMLDivElement>(null);

  const people = useMemo(() => {
    const byOwner = new Map<string, { owner: string; who: string; whoDetail: string; count: number }>();
    for (const d of devices) {
      const p = byOwner.get(d.owner);
      if (p) p.count += 1;
      else byOwner.set(d.owner, { owner: d.owner, who: d.who, whoDetail: d.whoDetail, count: 1 });
    }
    return [...byOwner.values()].sort((a, b) => a.who.localeCompare(b.who));
  }, [devices]);

  // A target that no longer exists (its device was removed) falls back to everyone.
  useEffect(() => {
    const t = targetFrom(target);
    if (t.kind === "device" && !devices.some((d) => d.id === t.id)) setTarget("everyone");
    if (t.kind === "person" && !devices.some((d) => d.owner === t.owner)) setTarget("everyone");
  }, [devices, target]);

  async function call(url: string, method: string, payload?: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.accounts && json?.companies) onSnapshot(json as AdminSnapshot);
      if (!res.ok) {
        setError(json?.error || "That didn't work.");
        return null;
      }
      return json;
    } catch {
      setError("Couldn't reach the site. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function doSend() {
    const t = targetFrom(target);
    setResults(null);
    const json = await call("/api/admin/push", "POST", { title, body, link, target: t });
    if (!json) return;
    const r = (json.results as Result[]) ?? [];
    setResults(r);
    const sent = Number(json.sent ?? 0);
    const failed = Number(json.failed ?? 0);
    toast(failed ? `Sent to ${sent}, ${failed} failed.` : `Sent to ${sent} device${sent === 1 ? "" : "s"}.`, failed && !sent ? "bad" : "good");
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const check = checkCompose({ title, body, link });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (targetFrom(target).kind === "everyone") {
      confirm({
        title: `Send to all ${devices.length} device${devices.length === 1 ? "" : "s"}?`,
        body: `"${check.title}" goes to every landlord and tenant with notifications on.`,
        confirmLabel: "Send to everyone",
        onConfirm: () => {
          confirm(null);
          void doSend();
        },
      });
      return;
    }
    void doSend();
  }

  function remove(d: AdminDevice) {
    confirm({
      title: `Remove ${d.who}'s ${d.device}?`,
      body: "Nothing more is sent to it. If notifications are still on there, it registers again the next time they open their notification settings.",
      confirmLabel: "Remove device",
      danger: true,
      onConfirm: async () => {
        confirm(null);
        if (await call(`/api/admin/push/${d.id}`, "DELETE")) toast("Device removed.");
      },
    });
  }

  function aimAt(d: AdminDevice) {
    setTarget(targetValue({ kind: "device", id: d.id }));
    composeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    composeRef.current?.querySelector("input")?.focus({ preventScroll: true });
  }

  return (
    <section className={styles.block} aria-labelledby="admin-push-h">
      <div className={styles.blockHead}>
        <h2 id="admin-push-h">Notifications</h2>
        <span className={styles.count}>
          {devices.length} device{devices.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className={styles.card} ref={composeRef}>
        <form className={s.compose} onSubmit={send} noValidate>
          <div className={styles.field}>
            <label htmlFor="push-title">Title</label>
            <input
              id="push-title"
              value={title}
              maxLength={PUSH_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Rent Roll"
              autoComplete="off"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="push-target">Send to</label>
            <select id="push-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="everyone">
                Everyone ({devices.length} device{devices.length === 1 ? "" : "s"})
              </option>
              {people.length > 0 && (
                <optgroup label="One person (all their devices)">
                  {people.map((p) => (
                    <option key={p.owner} value={`person:${p.owner}`}>
                      {p.who} — {p.count} device{p.count === 1 ? "" : "s"}
                    </option>
                  ))}
                </optgroup>
              )}
              {devices.length > 0 && (
                <optgroup label="One device">
                  {devices.map((d) => (
                    <option key={d.id} value={`device:${d.id}`}>
                      {d.who} — {d.device}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div className={`${styles.field} ${s.full}`}>
            <label htmlFor="push-body">Message</label>
            <textarea id="push-body" value={body} maxLength={PUSH_BODY_MAX} onChange={(e) => setBody(e.target.value)} rows={3} />
            <span className={s.counter}>
              {body.length}/{PUSH_BODY_MAX}
            </span>
          </div>
          <div className={`${styles.field} ${s.full}`}>
            <label htmlFor="push-link">Link (optional)</label>
            <input
              id="push-link"
              value={link}
              maxLength={PUSH_LINK_MAX}
              onChange={(e) => setLink(e.target.value)}
              placeholder="/dashboard or https://…"
              autoComplete="off"
              inputMode="url"
            />
          </div>
          <div className={`${s.sendRow} ${s.full}`}>
            <button type="submit" className={`${styles.btn} ${styles.accent}`} disabled={busy || devices.length === 0}>
              {busy ? "Sending…" : "Send notification"}
            </button>
            {error && (
              <span className={s.error} role="alert">
                {error}
              </span>
            )}
          </div>
        </form>

        {results && (
          <ul className={s.results} aria-label="How each device took it">
            {results.map((r) => (
              <li key={r.id} data-push-result={r.sent ? "sent" : "failed"}>
                <span className={`${s.mark} ${r.sent ? s.ok : s.fail}`} aria-hidden>
                  {r.sent ? "✓" : "✗"}
                </span>
                <span>
                  <strong>{r.who}</strong> · {r.device} — {r.sent ? "sent" : `failed: ${r.error ?? "not sent"}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className={styles.helpText}>
        A device shows here once someone turns notifications on in their settings. &ldquo;Sent&rdquo; means the push service (Google, Apple,
        Mozilla) accepted it; the phone shows it when it next wakes. A device that fails with 403 subscribed with an old key: they turn
        notifications off and on again there, or just open their notification settings, which renews it.
      </p>

      <ul className={s.devices} style={{ marginTop: 12 }} aria-label="Devices with notifications on">
        <li className={s.head} aria-hidden>
          <span>Whose</span>
          <span>Device</span>
          <span>Added</span>
          <span>Last sent</span>
          <span />
        </li>
        {devices.length === 0 && <li className={s.empty}>No device has notifications on yet.</li>}
        {devices.map((d) => (
          <li key={d.id} className={s.row} data-device-id={d.id}>
            <div className={s.cell}>
              <strong>{d.who}</strong>
              <div className={s.sub}>{d.whoDetail}</div>
            </div>
            <div className={s.cell}>
              {d.device}
              <div className={s.sub}>via {d.service}</div>
            </div>
            <div className={s.cell}>
              <span className={s.label}>Added</span>
              {day(d.createdAt)}
            </div>
            <div className={s.cell}>
              <span className={s.label}>Last sent</span>
              {d.lastSuccessAt ? <When iso={d.lastSuccessAt} /> : <span className={s.sub}>never</span>}
              {d.lastError && (
                <div className={s.lastError}>
                  {d.lastErrorAt && (
                    <>
                      <When iso={d.lastErrorAt} />:{" "}
                    </>
                  )}
                  {d.lastError}
                </div>
              )}
            </div>
            <div className={s.actions}>
              <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => aimAt(d)} disabled={busy}>
                Send to this
              </button>
              <button type="button" className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`} onClick={() => remove(d)} disabled={busy}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

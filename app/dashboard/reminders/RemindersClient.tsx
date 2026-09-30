"use client";

import { useState } from "react";
import AppShell from "../../components/AppShell";
import PushSetup from "../../components/PushSetup";
import { Toasts, useToasts } from "../../components/Toasts";
import styles from "../dashboard.module.css";
import { KIND_LABEL, type ReminderKind, type ReminderSettingsDTO } from "@/lib/reminders";
import type { ReminderSnapshot } from "@/lib/reminders-db";
import { ago } from "@/lib/maintenance";

type Company = { id: string; name: string; role: "owner" | "member"; snapshot: ReminderSnapshot };

function Days({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <input
      type="number"
      min={0}
      max={31}
      className={styles.remDays}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Math.max(0, Math.min(31, parseInt(e.target.value, 10) || 0)))}
      aria-label="days"
    />
  );
}

function DayList({ value, onChange, disabled }: { value: number[]; onChange: (v: string) => void; disabled: boolean }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <input
      type="text"
      inputMode="numeric"
      className={styles.remDayList}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      placeholder="60, 30"
      aria-label="days before"
    />
  );
}

/** A section per LLC: the switches, a test button, and what has gone out. */
export default function RemindersClient({
  userLabel,
  openRepairs,
  companies: initial,
}: {
  userLabel: string;
  openRepairs: number;
  companies: Company[];
}) {
  const { toasts, push, dismiss } = useToasts();
  const [companies, setCompanies] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, ReminderSettingsDTO>>(
    Object.fromEntries(initial.map((c) => [c.id, c.snapshot.settings]))
  );
  const [dayLists, setDayLists] = useState<Record<string, { leaseEnd?: string; docExpiry?: string }>>({});
  const [busy, setBusy] = useState("");
  const [showLog, setShowLog] = useState<Record<string, boolean>>({});

  const setDraft = (id: string, fn: (s: ReminderSettingsDTO) => ReminderSettingsDTO) =>
    setDrafts((d) => ({ ...d, [id]: fn(d[id]) }));

  async function save(company: Company) {
    setBusy(`save:${company.id}`);
    const draft = drafts[company.id];
    const lists = dayLists[company.id] ?? {};
    const body = {
      ...draft,
      leaseEnd: { ...draft.leaseEnd, days: lists.leaseEnd ?? draft.leaseEnd.days },
      docExpiry: { ...draft.docExpiry, days: lists.docExpiry ?? draft.docExpiry.days },
    };
    const res = await fetch(`/api/companies/${company.id}/reminders`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      push(data?.error || "Couldn't save that.", "bad");
      return;
    }
    setCompanies((prev) => prev.map((c) => (c.id === company.id ? { ...c, snapshot: data } : c)));
    setDrafts((d) => ({ ...d, [company.id]: data.settings }));
    setDayLists((d) => ({ ...d, [company.id]: {} }));
    push(data.settings.enabled ? "Saved. Reminders are on." : "Saved. Reminders are off until you turn them on.");
  }

  async function test(company: Company, channel: "email" | "push") {
    setBusy(`test:${channel}:${company.id}`);
    const res = await fetch(`/api/companies/${company.id}/reminders/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      push(data?.error || "Couldn't send a test.", "bad");
      return;
    }
    const detail = data.detail ? ` (${data.detail})` : "";
    if (data.outcome === "sent") push(channel === "email" ? "Test email sent — check your inbox." : `Test notification sent${detail}.`);
    else push(`Not sent${detail}.`, "bad");
    const fresh = await fetch(`/api/companies/${company.id}/reminders`).then((r) => (r.ok ? r.json() : null));
    if (fresh) setCompanies((prev) => prev.map((c) => (c.id === company.id ? { ...c, snapshot: fresh } : c)));
  }

  return (
    <AppShell
      openRepairs={openRepairs}
      userLabel={userLabel}
      title="Reminders"
    >
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Notifications on this device</h2>
        </div>
        <PushSetup audience="user" />
      </section>

      {companies.length === 0 && (
        <section className={styles.block}>
          <h2>No LLCs yet</h2>
          <p className={styles.helpText}>Reminders are set up per LLC. Create one from the overview first.</p>
        </section>
      )}

      {companies.map((company) => {
        const s = drafts[company.id];
        const canEdit = company.role === "owner";
        const snap = company.snapshot;
        const rows: { key: "rentDue" | "rentLate" | "leaseEnd" | "docExpiry" | "maintenance"; label: string; who: string; detail: React.ReactNode }[] = [
          {
            key: "rentDue",
            label: "Rent due soon",
            who: "to the tenant",
            detail: (
              <>
                <Days value={s.rentDue.days} disabled={!canEdit} onChange={(n) => setDraft(company.id, (d) => ({ ...d, rentDue: { ...d.rentDue, days: n } }))} /> days before
                their due day
              </>
            ),
          },
          {
            key: "rentLate",
            label: "Rent late",
            who: "to the tenant, once a month",
            detail: (
              <>
                after the grace period —{" "}
                <Days value={s.rentLate.graceDays} disabled={!canEdit} onChange={(n) => setDraft(company.id, (d) => ({ ...d, rentLate: { ...d.rentLate, graceDays: n } }))} /> days when a tenant
                has no late-fee rule of their own
              </>
            ),
          },
          {
            key: "leaseEnd",
            label: "Lease ending",
            who: "to your team",
            detail: (
              <>
                <DayList value={s.leaseEnd.days} disabled={!canEdit} onChange={(v) => setDayLists((d) => ({ ...d, [company.id]: { ...d[company.id], leaseEnd: v } }))} /> days before
                <label className={styles.checkboxField} style={{ marginLeft: 10 }}>
                  <input type="checkbox" checked={s.leaseEnd.tenant} disabled={!canEdit} onChange={(e) => setDraft(company.id, (d) => ({ ...d, leaseEnd: { ...d.leaseEnd, tenant: e.target.checked } }))} />
                  tell the tenant too
                </label>
              </>
            ),
          },
          {
            key: "docExpiry",
            label: "Document expiring",
            who: "to your team",
            detail: (
              <>
                <DayList value={s.docExpiry.days} disabled={!canEdit} onChange={(v) => setDayLists((d) => ({ ...d, [company.id]: { ...d[company.id], docExpiry: v } }))} /> days before
                (insurance, licences — anything with an expiry date in the filing cabinet)
              </>
            ),
          },
          {
            key: "maintenance",
            label: "Repair updates",
            who: "to the tenant",
            detail: <>when you reply on their request or change its status</>,
          },
        ];
        return (
          <section key={company.id} className={styles.block}>
            <div className={styles.blockHead}>
              <h2>{company.name}</h2>
              <span className={styles.count}>{canEdit ? "" : "you're a member — an owner changes these"}</span>
            </div>

            <label className={`${styles.checkboxField} ${styles.remMaster}`}>
              <input type="checkbox" checked={s.enabled} disabled={!canEdit} onChange={(e) => setDraft(company.id, (d) => ({ ...d, enabled: e.target.checked }))} />
              <span>
                <strong>Send automatic reminders for {company.name}</strong>
                <br />
                <span className={styles.helpText}>Runs every morning (around 9am Eastern). Nothing goes out while this is off.</span>
              </span>
            </label>

            <div className={styles.remRows}>
              {rows.map((r) => (
                <div key={r.key} className={styles.remRow}>
                  <label className={styles.remRowHead}>
                    <input type="checkbox" checked={s[r.key].on} disabled={!canEdit} onChange={(e) => setDraft(company.id, (d) => ({ ...d, [r.key]: { ...d[r.key], on: e.target.checked } }))} />
                    <span>
                      <strong>{r.label}</strong> <span className={styles.helpText}>{r.who}</span>
                    </span>
                  </label>
                  <div className={styles.remDetail}>{r.detail}</div>
                  <div className={styles.remChannels}>
                    <label className={styles.checkboxField}>
                      <input type="checkbox" checked={s[r.key].email} disabled={!canEdit} onChange={(e) => setDraft(company.id, (d) => ({ ...d, [r.key]: { ...d[r.key], email: e.target.checked } }))} />
                      Email
                    </label>
                    <label className={styles.checkboxField}>
                      <input type="checkbox" checked={s[r.key].push} disabled={!canEdit} onChange={(e) => setDraft(company.id, (d) => ({ ...d, [r.key]: { ...d[r.key], push: e.target.checked } }))} />
                      Notification
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.formFoot} style={{ justifyContent: "flex-start" }}>
              {canEdit && (
                <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => save(company)} disabled={busy === `save:${company.id}`}>
                  {busy === `save:${company.id}` ? "Saving…" : "Save"}
                </button>
              )}
              <button type="button" className={styles.btn} onClick={() => test(company, "email")} disabled={busy.startsWith("test:")}>
                Send test email
              </button>
              <button type="button" className={styles.btn} onClick={() => test(company, "push")} disabled={busy.startsWith("test:")}>
                Send test notification
              </button>
            </div>

            <ul className={styles.remStatus}>
              <li>{snap.email ? "✓ Email is set up." : "✗ Email isn't set up on this site (RESEND_API_KEY and EMAIL_FROM)."}</li>
              <li>{snap.push ? "✓ Phone notifications are set up." : "✗ Phone notifications aren't set up on this site (VAPID keys)."}</li>
              <li>{snap.cron ? "✓ The daily run is scheduled." : "✗ The daily run isn't scheduled yet (CRON_SECRET)."}</li>
            </ul>

            <button type="button" className={styles.portalLink} onClick={() => setShowLog((v) => ({ ...v, [company.id]: !v[company.id] }))}>
              {showLog[company.id] ? "Hide what's gone out" : `What's gone out (${snap.log.length})`}
            </button>
            {showLog[company.id] && (
              <div className={styles.ledgerWrap} style={{ marginTop: 10 }}>
                {snap.log.length === 0 ? (
                  <p className={styles.helpText}>Nothing yet.</p>
                ) : (
                  <table className={styles.ledger}>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>What</th>
                        <th>How</th>
                        <th>To</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snap.log.map((l) => (
                        <tr key={l.id}>
                          <td>{ago(l.createdAt)}</td>
                          <td>{KIND_LABEL[l.kind as ReminderKind] ?? l.kind}</td>
                          <td>{l.channel === "push" ? "Notification" : "Email"}</td>
                          <td>{l.to.startsWith("user:") ? "your team" : l.to.startsWith("tenant:") ? "the tenant's phone" : l.to}</td>
                          <td>
                            {l.status}
                            {l.detail ? <div className={styles.note}>{l.detail}</div> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </section>
        );
      })}
    </AppShell>
  );
}

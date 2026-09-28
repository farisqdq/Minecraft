"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import ConfirmDialog, { type ConfirmRequest } from "../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../components/Toasts";
import type { CompanyOwnersSnapshot, InviteResult, OwnerDTO, OwnerInviteDTO } from "@/lib/owners-db";
import styles from "../dashboard.module.css";

type Draft = { email: string; name: string; propertyIds: string[] };

const emptyDraft = (): Draft => ({ email: "", name: "", propertyIds: [] });

/**
 * One block per LLC: who has owner-portal access to which properties, who
 * has been invited and hasn't answered yet, and a form to invite someone.
 * The invite link is shown on screen whenever it wasn't emailed, so the
 * landlord can hand it over themselves — the same way tenant codes go.
 */
export default function OwnersClient({
  openRepairs,
  companies: initial,
  memberOnly,
}: {
  openRepairs?: number;
  companies: CompanyOwnersSnapshot[];
  /** LLCs where this person is only a member, and so can't manage owners. */
  memberOnly: number;
}) {
  const [companies, setCompanies] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editing, setEditing] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Record<string, { link: string; sent: boolean; reason: string; email: string }>>({});
  const [copied, setCopied] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const draftFor = (id: string) => drafts[id] ?? emptyDraft();
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...draftFor(id), ...patch } }));
  const setError = (id: string, message: string) => setErrors((prev) => ({ ...prev, [id]: message }));

  const update = (companyId: string, fn: (c: CompanyOwnersSnapshot) => CompanyOwnersSnapshot) =>
    setCompanies((prev) => prev.map((c) => (c.companyId === companyId ? fn(c) : c)));

  function toggleIn(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt("Copy this link:", text);
    }
  }

  function noteResult(companyId: string, r: InviteResult) {
    setLinks((prev) => ({ ...prev, [companyId]: { link: r.link, sent: r.sent, reason: r.reason, email: r.invite.email } }));
    push(r.sent ? `Invite emailed to ${r.invite.email}.` : "Invite created — copy the link below and send it to them.");
  }

  async function invite(e: FormEvent, company: CompanyOwnersSnapshot) {
    e.preventDefault();
    const draft = draftFor(company.companyId);
    setError(company.companyId, "");
    if (draft.propertyIds.length === 0) {
      setError(company.companyId, "Tick at least one property.");
      return;
    }
    setBusy(company.companyId);
    const res = await fetch(`/api/companies/${company.companyId}/owners/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setError(company.companyId, data?.error || "Couldn't send that invite.");
      return;
    }
    const r = data as InviteResult;
    update(company.companyId, (c) => ({
      ...c,
      invites: [r.invite, ...c.invites.filter((i) => i.email !== r.invite.email)],
    }));
    setDrafts((prev) => ({ ...prev, [company.companyId]: emptyDraft() }));
    noteResult(company.companyId, r);
  }

  async function resend(company: CompanyOwnersSnapshot, inv: OwnerInviteDTO) {
    setBusy(inv.id);
    const res = await fetch(`/api/companies/${company.companyId}/owners/invites/${inv.id}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setError(company.companyId, data?.error || "Couldn't resend that.");
      return;
    }
    const r = data as InviteResult;
    update(company.companyId, (c) => ({ ...c, invites: c.invites.map((i) => (i.id === inv.id ? r.invite : i)) }));
    noteResult(company.companyId, r);
  }

  async function revokeInvite(company: CompanyOwnersSnapshot, inv: OwnerInviteDTO) {
    const res = await fetch(`/api/companies/${company.companyId}/owners/invites/${inv.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(company.companyId, "Couldn't withdraw that invite.");
      return;
    }
    update(company.companyId, (c) => ({ ...c, invites: c.invites.filter((i) => i.id !== inv.id) }));
    if (links[company.companyId]?.email === inv.email) {
      setLinks((prev) => {
        const next = { ...prev };
        delete next[company.companyId];
        return next;
      });
    }
    push("Invite withdrawn.");
  }

  /** Re-invite someone who exists but has no password — restored from a backup, say. */
  async function reinvite(company: CompanyOwnersSnapshot, owner: OwnerDTO) {
    setBusy(owner.id);
    const res = await fetch(`/api/companies/${company.companyId}/owners/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: owner.email, name: owner.name, propertyIds: owner.propertyIds }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setError(company.companyId, data?.error || "Couldn't send that invite.");
      return;
    }
    const r = data as InviteResult;
    update(company.companyId, (c) => ({ ...c, invites: [r.invite, ...c.invites.filter((i) => i.email !== r.invite.email)] }));
    noteResult(company.companyId, r);
  }

  async function saveAssignments(company: CompanyOwnersSnapshot, owner: OwnerDTO) {
    const ids = editing[owner.id] ?? owner.propertyIds;
    setBusy(owner.id);
    setError(company.companyId, "");
    const res = await fetch(`/api/companies/${company.companyId}/owners/${owner.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyIds: ids }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setError(company.companyId, data?.error || "Couldn't save that.");
      return;
    }
    update(company.companyId, (c) => ({
      ...c,
      owners: c.owners.map((o) => (o.id === owner.id ? { ...o, propertyIds: data.propertyIds } : o)),
    }));
    setEditing((prev) => {
      const next = { ...prev };
      delete next[owner.id];
      return next;
    });
    push("Saved. They see the new set on their next page load.");
  }

  function revoke(company: CompanyOwnersSnapshot, owner: OwnerDTO) {
    setConfirming({
      title: `Remove ${owner.name || owner.email}?`,
      body: `They lose access to ${company.companyName}'s properties on the owner portal. Nothing in the books changes.`,
      confirmLabel: "Remove access",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/companies/${company.companyId}/owners/${owner.id}`, { method: "DELETE" });
        setConfirming(null);
        if (!res.ok) {
          setError(company.companyId, "Couldn't remove them.");
          return;
        }
        update(company.companyId, (c) => ({ ...c, owners: c.owners.filter((o) => o.id !== owner.id) }));
        push("Access removed.");
      },
    });
  }

  const propertyName = (c: CompanyOwnersSnapshot, id: string) => c.properties.find((p) => p.id === id)?.name ?? "";

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Property owners"
      tagline="Give an owner or investor a read-only view of their properties: rent roll, income and expenses, monthly statements, open repairs, and the documents you choose."
      back={{ href: "/dashboard/team", label: "Team" }}
    >
      {companies.length === 0 && (
        <div className={styles.firstRun}>
          <h2>{memberOnly > 0 ? "Owners only" : "No LLCs yet"}</h2>
          <p>
            {memberOnly > 0
              ? "Only an owner of an LLC can share its properties with investors. Ask an owner on your team."
              : "Add an LLC and a property on the dashboard first, then come back here to share it."}
          </p>
        </div>
      )}

      {companies.map((company) => {
        const draft = draftFor(company.companyId);
        const shown = links[company.companyId];
        return (
          <section key={company.companyId} className={styles.block}>
            <div className={styles.blockHead}>
              <h2>{company.companyName}</h2>
              <span className={styles.count}>
                {company.owners.length} {company.owners.length === 1 ? "owner" : "owners"}
                {company.invites.length > 0 ? ` · ${company.invites.length} invited` : ""}
              </span>
            </div>

            {errors[company.companyId] && <div className={styles.errorBar}>{errors[company.companyId]}</div>}

            {company.properties.length === 0 ? (
              <p className={styles.helpText}>This LLC has no properties yet, so there is nothing to share.</p>
            ) : (
              <>
                {(company.owners.length > 0 || company.invites.length > 0) && (
                  <div className={styles.ledgerWrap}>
                    <table className={styles.ledger}>
                      <thead>
                        <tr>
                          <th>Person</th>
                          <th>Properties</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {company.owners.map((o) => {
                          const edit = editing[o.id];
                          return (
                            <tr key={o.id}>
                              <td>
                                {o.name || o.email}
                                {o.name && <div className={styles.note}>{o.email}</div>}
                                <div className={styles.note}>
                                  {o.hasPassword
                                    ? o.lastLoginAt
                                      ? `Last signed in ${new Date(o.lastLoginAt).toLocaleDateString("en-US")}`
                                      : "Hasn't signed in yet"
                                    : "No password yet — send them an invite"}
                                  {o.monthlyEmail ? " · gets the monthly email" : ""}
                                </div>
                              </td>
                              <td>
                                {edit ? (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    {company.properties.map((p) => (
                                      <label key={p.id} className={styles.checkboxField}>
                                        <input
                                          type="checkbox"
                                          checked={edit.includes(p.id)}
                                          onChange={() => setEditing((prev) => ({ ...prev, [o.id]: toggleIn(edit, p.id) }))}
                                        />
                                        {p.name}
                                      </label>
                                    ))}
                                  </div>
                                ) : (
                                  o.propertyIds.map((id) => (
                                    <span key={id} className={`${styles.tag} ${styles.rent}`} style={{ marginRight: 4, marginBottom: 4 }}>
                                      {propertyName(company, id)}
                                    </span>
                                  ))
                                )}
                              </td>
                              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                {edit ? (
                                  <>
                                    <button
                                      type="button"
                                      className={`${styles.btn} ${styles.small} ${styles.primary}`}
                                      disabled={busy === o.id || edit.length === 0}
                                      onClick={() => saveAssignments(company, o)}
                                    >
                                      {busy === o.id ? "Saving…" : "Save"}
                                    </button>{" "}
                                    <button
                                      type="button"
                                      className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                                      onClick={() =>
                                        setEditing((prev) => {
                                          const next = { ...prev };
                                          delete next[o.id];
                                          return next;
                                        })
                                      }
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {!o.hasPassword && (
                                      <>
                                        <button
                                          type="button"
                                          className={`${styles.btn} ${styles.small}`}
                                          disabled={busy === o.id}
                                          onClick={() => reinvite(company, o)}
                                        >
                                          {busy === o.id ? "Sending…" : "Send invite"}
                                        </button>{" "}
                                      </>
                                    )}
                                    <button
                                      type="button"
                                      className={`${styles.btn} ${styles.small}`}
                                      onClick={() => setEditing((prev) => ({ ...prev, [o.id]: [...o.propertyIds] }))}
                                    >
                                      Edit
                                    </button>{" "}
                                    <button
                                      type="button"
                                      className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                                      onClick={() => revoke(company, o)}
                                    >
                                      Remove
                                    </button>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {company.invites.map((inv) => (
                          <tr key={inv.id}>
                            <td>
                              {inv.name || inv.email}
                              {inv.name && <div className={styles.note}>{inv.email}</div>}
                              <div className={styles.note}>
                                <span className={styles.tagPending}>Invited</span> · link expires{" "}
                                {new Date(inv.expiresAt).toLocaleDateString("en-US")}
                              </div>
                            </td>
                            <td>
                              {inv.propertyIds.map((id) => (
                                <span key={id} className={`${styles.tag} ${styles.expense}`} style={{ marginRight: 4, marginBottom: 4 }}>
                                  {propertyName(company, id)}
                                </span>
                              ))}
                            </td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.small}`}
                                disabled={busy === inv.id}
                                onClick={() => resend(company, inv)}
                              >
                                {busy === inv.id ? "Sending…" : company.emailConfigured ? "Resend" : "New link"}
                              </button>{" "}
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                                onClick={() => revokeInvite(company, inv)}
                              >
                                Withdraw
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {shown && (
                  <div className={styles.successBar}>
                    <strong>{shown.sent ? `Emailed to ${shown.email}.` : `Invite link for ${shown.email}`}</strong>{" "}
                    {shown.sent
                      ? "If it doesn't arrive, the link below is the same one."
                      : shown.reason === "unconfigured"
                        ? "This site can't send email, so send it to them yourself:"
                        : "The email didn't go through, so send it to them yourself:"}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                      <code className={styles.portalCode} style={{ overflowWrap: "anywhere", whiteSpace: "normal", letterSpacing: 0, fontSize: 12 }}>
                        {shown.link}
                      </code>
                      <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => copy(shown.link)}>
                        {copied === shown.link ? "Copied" : "Copy link"}
                      </button>
                    </div>
                    <div className={styles.note} style={{ marginTop: 6 }}>
                      Works once, for 14 days. It isn&apos;t shown again — use Resend for a fresh one.
                    </div>
                  </div>
                )}

                <form className={styles.contactForm} onSubmit={(e) => invite(e, company)}>
                  <div className={styles.contactHead}>
                    <strong>Invite a property owner</strong>
                    <span className={styles.helpText} style={{ margin: 0 }}>
                      They get a link to set a password, then sign in at <Link href="/owners/login">/owners</Link>. They
                      see only the properties ticked here, and only to read — tenants show as a first name, never a
                      phone number, and repairs show without who reported them or what the vendor charged.
                    </span>
                  </div>
                  <div className={styles.contactFields}>
                    <div className={styles.field}>
                      <label htmlFor={`owner-email-${company.companyId}`}>Email</label>
                      <input
                        id={`owner-email-${company.companyId}`}
                        type="email"
                        required
                        autoComplete="off"
                        placeholder="investor@example.com"
                        value={draft.email}
                        onChange={(e) => setDraft(company.companyId, { email: e.target.value })}
                      />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`owner-name-${company.companyId}`}>Name (optional)</label>
                      <input
                        id={`owner-name-${company.companyId}`}
                        type="text"
                        autoComplete="off"
                        maxLength={120}
                        value={draft.name}
                        onChange={(e) => setDraft(company.companyId, { name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span className={styles.note}>Properties they may see</span>
                    {company.properties.map((p) => (
                      <label key={p.id} className={styles.checkboxField}>
                        <input
                          type="checkbox"
                          checked={draft.propertyIds.includes(p.id)}
                          onChange={() => setDraft(company.companyId, { propertyIds: toggleIn(draft.propertyIds, p.id) })}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                  <div>
                    <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy === company.companyId}>
                      {busy === company.companyId ? "Sending…" : company.emailConfigured ? "Send invite" : "Create invite link"}
                    </button>
                  </div>
                </form>
                <p className={styles.helpText}>
                  To share a document with owners, tick <em>Show to property owners</em> on it in the filing cabinet.
                  Owners can ask for a monthly email when each statement is ready; it goes out on the 2nd.
                </p>
              </>
            )}
          </section>
        );
      })}

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}

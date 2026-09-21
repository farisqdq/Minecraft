"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import ConfirmDialog, { type ConfirmRequest } from "../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../components/Toasts";
import { formatPhone } from "@/lib/lease";
import styles from "../dashboard.module.css";

type Member = { userId: string; email: string; name: string; role: "owner" | "member" };
type Invite = { id: string; role: "owner" | "member"; code: string; expiresAt: string };
type Company = {
  id: string;
  name: string;
  /** What tenants of this LLC see under "Who to contact". */
  contactPhone: string;
  contactEmail: string;
  role: "owner" | "member";
  propertyCount: number;
  transactionCount: number;
  members: Member[];
  invites: Invite[];
};

export default function TeamClient({
  openRepairs,
  currentUserId,
  companies: initialCompanies,
}: {
  /** Repairs waiting on you, for the nav badge. */
  openRepairs?: number;
  currentUserId: string;
  companies: Company[];
}) {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [drafts, setDrafts] = useState<Record<string, { email: string; role: "owner" | "member" }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState("");
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { toasts, push, dismiss } = useToasts();

  // Contact fields are edited in place; the draft is keyed by LLC so two
  // cards never share a half-typed number.
  const [contactDrafts, setContactDrafts] = useState<Record<string, { phone: string; email: string }>>({});
  const [contactSaving, setContactSaving] = useState("");

  function contactDraft(company: Company) {
    return contactDrafts[company.id] ?? { phone: company.contactPhone, email: company.contactEmail };
  }

  async function saveContact(e: React.FormEvent, company: Company) {
    e.preventDefault();
    const draft = contactDraft(company);
    setContactSaving(company.id);
    const res = await fetch(`/api/companies/${company.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactPhone: draft.phone, contactEmail: draft.email }),
    });
    const data = await res.json().catch(() => ({}));
    setContactSaving("");
    if (!res.ok) {
      push(data?.error || "Couldn't save that.", "bad");
      return;
    }
    setCompanies((prev) =>
      prev.map((c) =>
        c.id === company.id ? { ...c, contactPhone: data.contactPhone, contactEmail: data.contactEmail } : c
      )
    );
    setContactDrafts((prev) => {
      const next = { ...prev };
      delete next[company.id];
      return next;
    });
    push(
      data.contactPhone || data.contactEmail
        ? "Saved. Tenants on this LLC's properties see it now."
        : "Cleared. Tenants see no contact details for this LLC."
    );
  }

  function draftFor(companyId: string) {
    return drafts[companyId] ?? { role: "member" as const };
  }

  function setDraft(companyId: string, patch: Partial<{ role: "owner" | "member" }>) {
    setDrafts((prev) => ({ ...prev, [companyId]: { ...draftFor(companyId), ...patch } }));
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt("Copy this join code:", code);
    }
  }

  async function createCode(e: React.FormEvent, companyId: string) {
    e.preventDefault();
    setErrors((prev) => ({ ...prev, [companyId]: "" }));

    const res = await fetch(`/api/companies/${companyId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: draftFor(companyId).role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors((prev) => ({ ...prev, [companyId]: data?.error || "Couldn't create a join code." }));
      return;
    }

    setCompanies((prev) =>
      prev.map((c) => (c.id === companyId ? { ...c, invites: [data, ...c.invites] } : c))
    );
  }

  async function changeRole(companyId: string, userId: string, role: "owner" | "member") {
    setErrors((prev) => ({ ...prev, [companyId]: "" }));
    const res = await fetch(`/api/companies/${companyId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors((prev) => ({ ...prev, [companyId]: data?.error || "Couldn't change that role." }));
      return;
    }
    setCompanies((prev) =>
      prev.map((c) =>
        c.id === companyId
          ? { ...c, members: c.members.map((m) => (m.userId === userId ? { ...m, role } : m)) }
          : c
      )
    );
  }

  async function revokeInvite(companyId: string, inviteId: string) {
    const res = await fetch(`/api/companies/${companyId}/invites/${inviteId}`, { method: "DELETE" });
    if (!res.ok) return;
    setCompanies((prev) =>
      prev.map((c) => (c.id === companyId ? { ...c, invites: c.invites.filter((i) => i.id !== inviteId) } : c))
    );
  }

  function removeMember(companyId: string, userId: string) {
    const leaving = userId === currentUserId;
    const company = companies.find((c) => c.id === companyId);
    const who = company?.members.find((m) => m.userId === userId);
    setConfirming({
      title: leaving ? `Leave ${company?.name ?? "this LLC"}?` : `Remove ${who?.name || who?.email || "this teammate"}?`,
      body: leaving
        ? "You'll lose access to its properties and ledger straight away. An owner would have to invite you back."
        : "They lose access to this LLC's properties and ledger. Nothing they recorded is deleted.",
      confirmLabel: leaving ? "Leave LLC" : "Remove them",
      danger: true,
      onConfirm: () => doRemoveMember(companyId, userId, leaving),
    });
  }

  async function doRemoveMember(companyId: string, userId: string, leaving: boolean) {
    const res = await fetch(`/api/companies/${companyId}/members/${userId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors((prev) => ({ ...prev, [companyId]: data?.error || "Couldn't remove them." }));
      return;
    }

    if (leaving) {
      setCompanies((prev) => prev.filter((c) => c.id !== companyId));
      push("You've left that LLC.");
      return;
    }
    push("Teammate removed.");
    setCompanies((prev) =>
      prev.map((c) =>
        c.id === companyId ? { ...c, members: c.members.filter((m) => m.userId !== userId) } : c
      )
    );
  }

  function startDelete(companyId: string) {
    setConfirmingDelete(companyId);
    setDeleteText("");
    setErrors((prev) => ({ ...prev, [companyId]: "" }));
  }

  async function deleteCompany(companyId: string) {
    setDeleting(true);
    const res = await fetch(`/api/companies/${companyId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setDeleting(false);
    if (!res.ok) {
      setErrors((prev) => ({ ...prev, [companyId]: data?.error || "Couldn't delete that LLC." }));
      return;
    }
    setCompanies((prev) => prev.filter((c) => c.id !== companyId));
    setConfirmingDelete("");
    setDeleteText("");
    router.refresh();
  }

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Team"
      tagline="Each LLC has its own team — invite partners to one without giving access to the others."
    >

      {companies.length === 0 && (
        <div className={styles.firstRun}>
          <h2>No LLCs yet</h2>
          <p>Add an LLC on the dashboard first, then you can invite people to it here.</p>
        </div>
      )}

      {companies.map((company) => {
        const isOwner = company.role === "owner";
        const draft = draftFor(company.id);
        const ownerCount = company.members.filter((m) => m.role === "owner").length;
        const soleOwner = isOwner && ownerCount === 1;
        return (
          <section key={company.id} className={styles.block}>
            <div className={styles.blockHead}>
              <h2>{company.name}</h2>
              <span className={styles.count}>
                {company.members.length} {company.members.length === 1 ? "person" : "people"}
                {isOwner ? "" : " · you're a member"}
              </span>
            </div>

            {errors[company.id] && <div className={styles.errorBar}>{errors[company.id]}</div>}

            <div className={styles.ledgerWrap}>
              <table className={styles.ledger}>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {company.members.map((m) => (
                    <tr key={m.userId}>
                      <td>
                        {m.name || m.email}
                        {m.name && <div className={styles.note}>{m.email}</div>}
                        {m.userId === currentUserId && <div className={styles.note}>That&apos;s you</div>}
                      </td>
                      <td>
                        <span className={`${styles.tag} ${m.role === "owner" ? styles.rent : styles.expense}`}>
                          {m.role === "owner" ? "Owner" : "Member"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {isOwner && m.role === "member" && (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.small}`}
                            onClick={() => changeRole(company.id, m.userId, "owner")}
                          >
                            Make owner
                          </button>
                        )}
                        {/* Leaving as the last owner would strand the LLC with
                            nobody able to manage it — delete it instead. */}
                        {m.userId === currentUserId && soleOwner ? null : (isOwner ||
                            m.userId === currentUserId) && (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                            onClick={() => removeMember(company.id, m.userId)}
                          >
                            {m.userId === currentUserId ? "Leave" : "Remove"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {company.invites.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <span className={styles.joinCode}>{i.code}</span>
                        <div className={styles.note}>
                          Unused join code · expires {new Date(i.expiresAt).toLocaleDateString("en-US")}
                        </div>
                      </td>
                      <td>
                        <span className={styles.tagPending}>
                          Joins as {i.role === "owner" ? "owner" : "member"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small}`}
                          onClick={() => copyCode(i.code)}
                        >
                          {copied === i.code ? "Copied" : "Copy code"}
                        </button>
                        {isOwner && (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                            onClick={() => revokeInvite(company.id, i.id)}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {isOwner && (
              <form className={styles.contactForm} onSubmit={(e) => saveContact(e, company)}>
                <div className={styles.contactHead}>
                  <strong>What tenants see under &ldquo;Who to contact&rdquo;</strong>
                  <span className={styles.helpText} style={{ margin: 0 }}>
                    A dispatch line or an office inbox — never anyone&apos;s personal number. This is also
                    the number the portal tells them to call for an emergency. Leave both blank and the
                    portal shows no contact card at all.
                  </span>
                </div>
                <div className={styles.contactFields}>
                  <div className={styles.field}>
                    <label htmlFor={`contact-phone-${company.id}`}>Phone</label>
                    <input
                      id={`contact-phone-${company.id}`}
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      placeholder="(555) 010-4477"
                      value={contactDraft(company).phone}
                      onChange={(e) =>
                        setContactDrafts((prev) => ({
                          ...prev,
                          [company.id]: { ...contactDraft(company), phone: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={`contact-email-${company.id}`}>Email</label>
                    <input
                      id={`contact-email-${company.id}`}
                      type="email"
                      autoComplete="off"
                      placeholder="repairs@example.com"
                      value={contactDraft(company).email}
                      onChange={(e) =>
                        setContactDrafts((prev) => ({
                          ...prev,
                          [company.id]: { ...contactDraft(company), email: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <button
                    type="submit"
                    className={`${styles.btn} ${styles.small} ${styles.primary}`}
                    disabled={contactSaving === company.id}
                  >
                    {contactSaving === company.id ? "Saving\u2026" : "Save"}
                  </button>
                </div>
                {(company.contactPhone || company.contactEmail) && !contactDrafts[company.id] && (
                  <span className={styles.helpText} style={{ margin: 0 }}>
                    Showing tenants:{" "}
                    {[company.contactPhone && formatPhone(company.contactPhone), company.contactEmail]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </form>
            )}

            {isOwner && (
              <form className={styles.inviteForm} onSubmit={(e) => createCode(e, company.id)}>
                <div className={styles.field}>
                  <label htmlFor={`invite-role-${company.id}`}>They join as</label>
                  <select
                    id={`invite-role-${company.id}`}
                    value={draft.role}
                    onChange={(e) => setDraft(company.id, { role: e.target.value as "owner" | "member" })}
                  >
                    <option value="member">Member — record rent and expenses</option>
                    <option value="owner">Owner — can also invite and delete</option>
                  </select>
                </div>
                <button type="submit" className={`${styles.btn} ${styles.primary}`}>
                  Create join code
                </button>
              </form>
            )}
            {isOwner && (
              <p className={styles.helpText}>
                Give the code to one person however you like — text, email, in person. They sign in, enter it under
                &ldquo;Join with a code&rdquo; on the dashboard, and land on this LLC. Each code works once and
                expires after 7 days.
              </p>
            )}

            {isOwner && (
              <div className={styles.dangerZone}>
                {confirmingDelete === company.id ? (
                  <>
                    <div className={styles.dangerTitle}>Delete {company.name}?</div>
                    <p className={styles.dangerText}>
                      This also deletes{" "}
                      <strong>
                        {company.propertyCount} {company.propertyCount === 1 ? "property" : "properties"}
                      </strong>{" "}
                      and{" "}
                      <strong>
                        {company.transactionCount} ledger{" "}
                        {company.transactionCount === 1 ? "entry" : "entries"}
                      </strong>{" "}
                      under it, for everyone on the team. It can&apos;t be undone — download a backup first if you
                      might want this history later.
                    </p>
                    <div className={styles.dangerActions}>
                      <input
                        id={`confirm-delete-${company.id}`}
                        type="text"
                        autoComplete="off"
                        placeholder={`Type "${company.name}" to confirm`}
                        value={deleteText}
                        onChange={(e) => setDeleteText(e.target.value)}
                      />
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.danger}`}
                        disabled={deleteText.trim() !== company.name || deleting}
                        onClick={() => deleteCompany(company.id)}
                      >
                        {deleting ? "Deleting…" : "Delete this LLC"}
                      </button>
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => {
                          setConfirmingDelete("");
                          setDeleteText("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                    onClick={() => startDelete(company.id)}
                  >
                    Delete this LLC
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}

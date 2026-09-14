"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../dashboard.module.css";

type Member = { userId: string; email: string; name: string; role: "owner" | "member" };
type Invite = { id: string; role: "owner" | "member"; code: string; expiresAt: string };
type Company = {
  id: string;
  name: string;
  role: "owner" | "member";
  propertyCount: number;
  transactionCount: number;
  members: Member[];
  invites: Invite[];
};

export default function TeamClient({
  currentUserId,
  companies: initialCompanies,
}: {
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

  async function removeMember(companyId: string, userId: string) {
    const leaving = userId === currentUserId;
    const message = leaving
      ? "Leave this LLC? You'll lose access to its properties and ledger."
      : "Remove this teammate from the LLC?";
    if (!window.confirm(message)) return;

    const res = await fetch(`/api/companies/${companyId}/members/${userId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors((prev) => ({ ...prev, [companyId]: data?.error || "Couldn't remove them." }));
      return;
    }

    if (leaving) {
      setCompanies((prev) => prev.filter((c) => c.id !== companyId));
      return;
    }
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
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <h1>Team</h1>
          <div className={styles.tagline}>Each LLC has its own team — invite partners to one without giving access to the others.</div>
        </div>
        <div className={styles.userBar}>
          <a href="/dashboard" className={styles.textLink}>
            Back to dashboard
          </a>
        </div>
      </header>

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
    </div>
  );
}

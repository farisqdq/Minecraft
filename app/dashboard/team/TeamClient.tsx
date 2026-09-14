"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../dashboard.module.css";

type Member = { userId: string; email: string; name: string; role: "owner" | "member" };
type Invite = { id: string; email: string; role: "owner" | "member"; token: string; expiresAt: string };
type Company = {
  id: string;
  name: string;
  role: "owner" | "member";
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
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [drafts, setDrafts] = useState<Record<string, { email: string; role: "owner" | "member" }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState("");

  function draftFor(companyId: string) {
    return drafts[companyId] ?? { email: "", role: "member" as const };
  }

  function setDraft(companyId: string, patch: Partial<{ email: string; role: "owner" | "member" }>) {
    setDrafts((prev) => ({ ...prev, [companyId]: { ...draftFor(companyId), ...patch } }));
  }

  function inviteLink(token: string) {
    return `${window.location.origin}/invite/${token}`;
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopied(token);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt("Copy this invite link:", inviteLink(token));
    }
  }

  async function sendInvite(e: React.FormEvent, companyId: string) {
    e.preventDefault();
    const draft = draftFor(companyId);
    const email = draft.email.trim();
    if (!email) return;
    setErrors((prev) => ({ ...prev, [companyId]: "" }));

    const res = await fetch(`/api/companies/${companyId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role: draft.role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors((prev) => ({ ...prev, [companyId]: data?.error || "Couldn't create that invite." }));
      return;
    }

    setCompanies((prev) =>
      prev.map((c) =>
        c.id === companyId
          ? { ...c, invites: [data, ...c.invites.filter((i) => i.email !== data.email)] }
          : c
      )
    );
    setDraft(companyId, { email: "" });
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

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <h1>Team</h1>
          <div className={styles.tagline}>Each LLC has its own team — invite partners to one without giving access to the others.</div>
        </div>
        <div className={styles.userBar}>
          <Link href="/dashboard" className={styles.textLink}>
            Back to dashboard
          </Link>
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
                      <td style={{ textAlign: "right" }}>
                        {(isOwner || m.userId === currentUserId) && (
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
                        {i.email}
                        <div className={styles.note}>
                          Invited · expires {new Date(i.expiresAt).toLocaleDateString("en-US")}
                        </div>
                      </td>
                      <td>
                        <span className={styles.tagPending}>Pending</span>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small}`}
                          onClick={() => copyLink(i.token)}
                        >
                          {copied === i.token ? "Copied" : "Copy link"}
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
              <form className={styles.inviteForm} onSubmit={(e) => sendInvite(e, company.id)}>
                <div className={styles.field}>
                  <label htmlFor={`invite-email-${company.id}`}>Invite by email</label>
                  <input
                    id={`invite-email-${company.id}`}
                    type="email"
                    required
                    placeholder="partner@example.com"
                    value={draft.email}
                    onChange={(e) => setDraft(company.id, { email: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor={`invite-role-${company.id}`}>Role</label>
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
                  Create invite
                </button>
              </form>
            )}
            {isOwner && (
              <p className={styles.helpText}>
                Creating an invite gives you a link to send them yourself — the app doesn&apos;t send email. They&apos;ll
                need to sign in with the address you invited.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import Modal from "../../components/Modal";
import ConfirmDialog, { type ConfirmRequest } from "../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../components/Toasts";
import styles from "../dashboard.module.css";
import { formatDay } from "@/lib/lease";
import { planAccountDeletion } from "@/lib/admin";
import type { AdminAccount, AdminCompany, AdminSnapshot } from "@/lib/admin-db";

type Role = "owner" | "member";

const day = (iso: string) => formatDay(iso.slice(0, 10));

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Every account and LLC on the site, for the people who run it.
 *
 * Each action answers with a fresh copy of everything, and that copy
 * replaces the page's state wholesale — so what's on screen is always what
 * the database has, even after a delete that took an LLC with it.
 */
export default function AdminClient({
  openRepairs,
  me,
  initial,
}: {
  openRepairs?: number;
  me: { id: string; email: string };
  initial: AdminSnapshot;
}) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [accountId, setAccountId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { toasts, push, dismiss } = useToasts();

  // Dialog forms.
  const [addCompanyId, setAddCompanyId] = useState("");
  const [addRole, setAddRole] = useState<Role>("member");
  const [newLlcName, setNewLlcName] = useState("");
  const [typedEmail, setTypedEmail] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<Role>("member");
  const [rename, setRename] = useState("");
  const [typedName, setTypedName] = useState("");
  const [createName, setCreateName] = useState("");
  const [createOwner, setCreateOwner] = useState("");

  const account = data.accounts.find((a) => a.id === accountId) ?? null;
  const company = data.companies.find((c) => c.id === companyId) ?? null;

  const q = query.trim().toLowerCase();
  const accounts = useMemo(
    () =>
      data.accounts.filter(
        (a) =>
          !q ||
          a.email.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          a.memberships.some((m) => m.companyName.toLowerCase().includes(q))
      ),
    [data.accounts, q]
  );
  const companies = useMemo(
    () =>
      data.companies.filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.members.some((m) => m.email.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      ),
    [data.companies, q]
  );

  /** One call shape for everything: send, and on success swap in the snapshot that came back. */
  async function send(url: string, method: string, body?: unknown, done?: string) {
    setBusy(true);
    setError("");
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json?.error || "That didn't work.");
      return false;
    }
    if (json?.accounts && json?.companies) setData(json as AdminSnapshot);
    if (done) push(done);
    return true;
  }

  function openAccount(a: AdminAccount) {
    setError("");
    setAccountId(a.id);
    setAddCompanyId("");
    setAddRole("member");
    setNewLlcName("");
    setTypedEmail("");
  }

  function openCompany(c: AdminCompany) {
    setError("");
    setCompanyId(c.id);
    setRename(c.name);
    setMemberEmail("");
    setMemberRole("member");
    setTypedName("");
  }

  function openCreate() {
    setError("");
    setCreateName("");
    setCreateOwner(me.id);
    setCreating(true);
  }

  const plan = account
    ? planAccountDeletion(
        account.id,
        data.companies.map((c) => ({
          id: c.id,
          name: c.name,
          members: c.members.map((m) => ({ userId: m.userId, role: m.role, createdAt: m.since })),
        }))
      )
    : null;

  function deleteAccount(a: AdminAccount) {
    if (!plan) return;
    const gone = plan.deleteCompanies.map((c) => c.name);
    setConfirming({
      title: `Delete ${a.email}?`,
      body: `Their login and account go for good.${
        gone.length ? ` ${gone.join(", ")} — with every property and ledger entry — goes with them, because nobody else is on it.` : ""
      }${plan.leaveCompanies.length ? ` They're taken off ${plan.leaveCompanies.map((c) => c.name).join(", ")}.` : ""}`,
      confirmLabel: "Delete account",
      danger: true,
      onConfirm: async () => {
        setConfirming(null);
        if (await send(`/api/admin/accounts/${a.id}`, "DELETE", { email: typedEmail }, `${a.email} deleted.`)) {
          setAccountId("");
        }
      },
    });
  }

  function deleteCompany(c: AdminCompany) {
    setConfirming({
      title: `Delete ${c.name}?`,
      body: `${c.properties} ${c.properties === 1 ? "property" : "properties"} and ${c.transactions} ledger ${
        c.transactions === 1 ? "entry" : "entries"
      } go with it, for all ${c.members.length} ${c.members.length === 1 ? "person" : "people"} on it. There is no undo.`,
      confirmLabel: "Delete LLC",
      danger: true,
      onConfirm: async () => {
        setConfirming(null);
        if (await send(`/api/admin/companies/${c.id}`, "DELETE", { name: typedName }, `${c.name} deleted.`)) {
          setCompanyId("");
        }
      },
    });
  }

  const flags = (a: AdminAccount) => (
    <span className={styles.adminFlags}>
      {a.isAdmin && <span className={`${styles.pill} ${styles.paid}`}>Admin</span>}
      {a.twoFactor && <span className={`${styles.pill} ${styles.vacant}`}>2FA</span>}
    </span>
  );

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Admin"
      tagline="Every account and LLC on this site, and what's been done to them."
      actions={
        <button type="button" className={`${styles.btn} ${styles.accent}`} onClick={openCreate}>
          + Create an LLC
        </button>
      }
    >
      <div className={`${styles.field} ${styles.adminSearch}`}>
        <label htmlFor="admin-q">Find</label>
        <input
          id="admin-q"
          type="search"
          placeholder="Email, name or LLC"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Accounts</h2>
          <span className={styles.count}>
            {accounts.length === data.accounts.length ? data.accounts.length : `${accounts.length} of ${data.accounts.length}`}
          </span>
        </div>
        <div className={styles.ledgerWrap}>
          {accounts.length === 0 ? (
            <div className={styles.emptyState}>No accounts match.</div>
          ) : (
            <table className={styles.ledger}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Joined</th>
                  <th>LLCs</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.email}
                      {flags(a)}
                      {a.name && <div className={styles.note}>{a.name}</div>}
                    </td>
                    <td>{day(a.createdAt)}</td>
                    <td>
                      {a.memberships.length === 0 ? (
                        <span className={styles.note}>none</span>
                      ) : (
                        <span className={styles.adminChips}>
                          {a.memberships.map((m) => (
                            <span key={m.companyId} className={styles.adminChip}>
                              {m.companyName} <i>· {m.role}</i>
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => openAccount(a)}>
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>LLCs</h2>
          <span className={styles.count}>
            {companies.length === data.companies.length ? data.companies.length : `${companies.length} of ${data.companies.length}`}
          </span>
        </div>
        <div className={styles.ledgerWrap}>
          {companies.length === 0 ? (
            <div className={styles.emptyState}>No LLCs match.</div>
          ) : (
            <table className={styles.ledger}>
              <thead>
                <tr>
                  <th>LLC</th>
                  <th>People</th>
                  <th style={{ textAlign: "right" }}>Properties</th>
                  <th style={{ textAlign: "right" }}>Entries</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      <div className={styles.note}>since {day(c.createdAt)}</div>
                    </td>
                    <td>
                      <span className={styles.adminChips}>
                        {c.members.map((m) => (
                          <span key={m.userId} className={styles.adminChip}>
                            {m.email} <i>· {m.role}</i>
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {c.properties}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {c.transactions}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => openCompany(c)}>
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>What admins have done</h2>
        </div>
        <div className={styles.card}>
          {data.log.length === 0 ? (
            <p className={styles.helpText} style={{ margin: 0 }}>
              Nothing yet. Every action taken here is written down with who did it.
            </p>
          ) : (
            <ul className={styles.logList}>
              {data.log.map((l) => (
                <li key={l.id}>
                  <span className={styles.logWhen}>{when(l.createdAt)}</span>
                  <span>
                    {l.text} <span className={styles.logWho}>· {l.adminEmail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---- Manage an account ---- */}
      <Modal
        open={Boolean(account)}
        title={account?.email ?? "Account"}
        subtitle={account ? `${account.name ? `${account.name} · ` : ""}joined ${day(account.createdAt)}` : undefined}
        onClose={() => setAccountId("")}
      >
        {account && (
          <>
            {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}

            <h3 className={styles.moHeading} style={{ marginTop: 0 }}>
              On these LLCs
            </h3>
            {account.memberships.length === 0 ? (
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                None yet.
              </p>
            ) : (
              <ul className={styles.adminRows}>
                {account.memberships.map((m) => (
                  <li key={m.companyId}>
                    <span>{m.companyName}</span>
                    <select
                      aria-label={`Role on ${m.companyName}`}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) =>
                        send(`/api/admin/companies/${m.companyId}/members/${account.id}`, "PATCH", { role: e.target.value }, "Role changed.")
                      }
                    >
                      <option value="owner">Owner</option>
                      <option value="member">Member</option>
                    </select>
                    <button
                      type="button"
                      className={styles.portalLink}
                      disabled={busy}
                      onClick={() =>
                        send(`/api/admin/companies/${m.companyId}/members/${account.id}`, "DELETE", undefined, `Taken off ${m.companyName}.`)
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {data.companies.some((c) => !account.memberships.some((m) => m.companyId === c.id)) && (
              <div className={styles.adminInline}>
                <select aria-label="LLC to add them to" value={addCompanyId} onChange={(e) => setAddCompanyId(e.target.value)}>
                  <option value="">Add to LLC…</option>
                  {data.companies
                    .filter((c) => !account.memberships.some((m) => m.companyId === c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <select aria-label="Role" value={addRole} onChange={(e) => setAddRole(e.target.value as Role)}>
                  <option value="member">as member</option>
                  <option value="owner">as owner</option>
                </select>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.small}`}
                  disabled={busy || !addCompanyId}
                  onClick={async () => {
                    if (await send(`/api/admin/companies/${addCompanyId}/members`, "POST", { userId: account.id, role: addRole }, "Added.")) {
                      setAddCompanyId("");
                    }
                  }}
                >
                  Add
                </button>
              </div>
            )}
            <div className={styles.adminInline}>
              <input
                type="text"
                aria-label="Name for a new LLC"
                placeholder="Create an LLC for them, e.g. Birchwood Holdings LLC"
                value={newLlcName}
                onChange={(e) => setNewLlcName(e.target.value)}
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.small}`}
                disabled={busy || !newLlcName.trim()}
                onClick={async () => {
                  if (await send("/api/admin/companies", "POST", { name: newLlcName, ownerUserId: account.id }, `${newLlcName.trim()} created.`)) {
                    setNewLlcName("");
                  }
                }}
              >
                Create
              </button>
            </div>

            <h3 className={styles.moHeading}>Account</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className={`${styles.btn} ${styles.small}`}
                disabled={busy}
                onClick={() => send(`/api/admin/accounts/${account.id}`, "PATCH", { signOutEverywhere: true }, "Signed out everywhere.")}
              >
                Sign out everywhere
              </button>
              {account.twoFactor && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.small}`}
                  disabled={busy}
                  onClick={() => send(`/api/admin/accounts/${account.id}`, "PATCH", { twoFactor: "off" }, "Two-factor turned off.")}
                >
                  Turn off two-factor
                </button>
              )}
              {account.id !== me.id && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.small}`}
                  disabled={busy}
                  onClick={() =>
                    send(`/api/admin/accounts/${account.id}`, "PATCH", { isAdmin: !account.isAdmin }, account.isAdmin ? "Admin removed." : "Now an admin.")
                  }
                >
                  {account.isAdmin ? "Remove admin" : "Make admin"}
                </button>
              )}
            </div>
            <p className={styles.helpText}>
              Signing them out ends every session they have; two-factor off lets someone who lost their phone back in with
              just their password. Both are written to the log on this page.
            </p>

            {account.id !== me.id && !account.isAdmin && plan && (
              <div className={styles.dangerZone}>
                <h4>Delete this account</h4>
                <p className={styles.helpText} style={{ marginTop: 0 }}>
                  {plan.deleteCompanies.length > 0
                    ? `${plan.deleteCompanies.map((c) => c.name).join(", ")} ${
                        plan.deleteCompanies.length === 1 ? "has" : "have"
                      } nobody else on ${plan.deleteCompanies.length === 1 ? "it" : "them"}, so ${
                        plan.deleteCompanies.length === 1 ? "it" : "they"
                      } — properties, ledger, tenants — would be deleted too. `
                    : ""}
                  {plan.leaveCompanies.length > 0
                    ? `They'd be taken off ${plan.leaveCompanies.map((c) => c.name).join(", ")}${
                        plan.leaveCompanies.some((c) => c.promote)
                          ? ", and the longest-standing member there becomes an owner"
                          : ""
                      }. `
                    : ""}
                  Type their email to confirm.
                </p>
                <div className={styles.adminInline}>
                  <input
                    type="email"
                    aria-label="Type the email to confirm"
                    placeholder={account.email}
                    autoComplete="off"
                    value={typedEmail}
                    onChange={(e) => setTypedEmail(e.target.value)}
                  />
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.small} ${styles.danger}`}
                    disabled={busy || typedEmail.trim().toLowerCase() !== account.email.toLowerCase()}
                    onClick={() => deleteAccount(account)}
                  >
                    Delete account
                  </button>
                </div>
              </div>
            )}
            {account.isAdmin && account.id !== me.id && (
              <p className={styles.helpText}>To delete this account, remove admin from it first.</p>
            )}
          </>
        )}
      </Modal>

      {/* ---- Manage an LLC ---- */}
      <Modal
        open={Boolean(company)}
        title={company?.name ?? "LLC"}
        subtitle={
          company
            ? `${company.properties} ${company.properties === 1 ? "property" : "properties"} · ${company.transactions} ledger ${
                company.transactions === 1 ? "entry" : "entries"
              } · since ${day(company.createdAt)}`
            : undefined
        }
        onClose={() => setCompanyId("")}
      >
        {company && (
          <>
            {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}

            <div className={styles.adminInline} style={{ marginTop: 0 }}>
              <input type="text" aria-label="LLC name" value={rename} onChange={(e) => setRename(e.target.value)} />
              <button
                type="button"
                className={`${styles.btn} ${styles.small}`}
                disabled={busy || !rename.trim() || rename.trim() === company.name}
                onClick={() => send(`/api/admin/companies/${company.id}`, "PATCH", { name: rename }, "Renamed.")}
              >
                Rename
              </button>
            </div>

            <h3 className={styles.moHeading}>People</h3>
            <ul className={styles.adminRows}>
              {company.members.map((m) => (
                <li key={m.userId}>
                  <span>
                    {m.email}
                    {m.name ? <span className={styles.note}> {m.name}</span> : null}
                  </span>
                  <select
                    aria-label={`Role of ${m.email}`}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) =>
                      send(`/api/admin/companies/${company.id}/members/${m.userId}`, "PATCH", { role: e.target.value }, "Role changed.")
                    }
                  >
                    <option value="owner">Owner</option>
                    <option value="member">Member</option>
                  </select>
                  <button
                    type="button"
                    className={styles.portalLink}
                    disabled={busy}
                    onClick={() => send(`/api/admin/companies/${company.id}/members/${m.userId}`, "DELETE", undefined, `${m.email} removed.`)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.adminInline}>
              <input
                type="email"
                list="admin-emails"
                aria-label="Email of the account to add"
                placeholder="Email of an account to add"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
              />
              <datalist id="admin-emails">
                {data.accounts
                  .filter((a) => !company.members.some((m) => m.userId === a.id))
                  .map((a) => (
                    <option key={a.id} value={a.email} />
                  ))}
              </datalist>
              <select aria-label="Role" value={memberRole} onChange={(e) => setMemberRole(e.target.value as Role)}>
                <option value="member">as member</option>
                <option value="owner">as owner</option>
              </select>
              <button
                type="button"
                className={`${styles.btn} ${styles.small}`}
                disabled={busy || !memberEmail.trim()}
                onClick={async () => {
                  if (await send(`/api/admin/companies/${company.id}/members`, "POST", { email: memberEmail, role: memberRole }, "Added.")) {
                    setMemberEmail("");
                  }
                }}
              >
                Add
              </button>
            </div>

            <div className={styles.dangerZone}>
              <h4>Delete this LLC</h4>
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                Everything under it goes, for everyone on it. Type its name to confirm.
              </p>
              <div className={styles.adminInline}>
                <input
                  type="text"
                  aria-label="Type the LLC's name to confirm"
                  placeholder={company.name}
                  autoComplete="off"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                />
                <button
                  type="button"
                  className={`${styles.btn} ${styles.small} ${styles.danger}`}
                  disabled={busy || typedName.trim() !== company.name}
                  onClick={() => deleteCompany(company)}
                >
                  Delete LLC
                </button>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* ---- Create an LLC ---- */}
      <Modal
        open={creating}
        title="Create an LLC"
        subtitle="It starts with one owner — the account you pick — who can then invite the rest of their team."
        narrow
        onClose={() => setCreating(false)}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send("/api/admin/companies", "POST", { name: createName, ownerUserId: createOwner }, `${createName.trim()} created.`)) {
              setCreating(false);
            }
          }}
        >
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="create-name">Name</label>
              <input
                id="create-name"
                type="text"
                required
                placeholder="e.g. Birchwood Holdings LLC"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="create-owner">Owned by</label>
              <select id="create-owner" value={createOwner} onChange={(e) => setCreateOwner(e.target.value)}>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                    {a.name ? ` (${a.name})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.formFoot}>
            <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
              {busy ? "Creating…" : "Create LLC"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}

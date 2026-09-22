"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "../../../components/AppShell";
import Modal from "../../../components/Modal";
import ConfirmDialog, { type ConfirmRequest } from "../../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../../components/Toasts";
import styles from "../../dashboard.module.css";
import { money } from "@/lib/money";
import { formatDay, formatPhone, smsHref, telHref } from "@/lib/lease";
import { TRADES, type VendorDTO } from "@/lib/vendors";
import DocumentsPanel from "../../../components/DocumentsPanel";
import type { DocumentDTO } from "@/lib/documents";

type Company = { id: string; name: string };

const EMPTY = { id: "", companyId: "", name: "", trade: "General", phone: "", email: "", note: "" };

export default function VendorsClient({
  companies,
  initial,
  openRepairs,
  ownerOf,
  documents,
  storageReady,
  serverToday,
}: {
  companies: Company[];
  initial: VendorDTO[];
  openRepairs: number;
  /** LLCs where you're an owner — only an owner can delete from the book. */
  ownerOf: string[];
  documents: DocumentDTO[];
  storageReady: boolean;
  serverToday: string;
}) {
  const { toasts, push, dismiss } = useToasts();
  const [vendors, setVendors] = useState(initial);
  const [company, setCompany] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "";

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors
      .filter((v) => !company || v.companyId === company)
      .filter(
        (v) =>
          !q ||
          [v.name, v.trade, v.phone, v.email, v.note].some((f) => f.toLowerCase().includes(q))
      );
  }, [vendors, company, query]);

  // Grouped by trade, in the book's own order, so "who's my electrician?" is
  // a glance rather than a scroll.
  const groups = useMemo(
    () =>
      TRADES.map((trade) => ({ trade, list: shown.filter((v) => v.trade === trade) })).filter(
        (g) => g.list.length > 0
      ),
    [shown]
  );

  const spentThisYear = shown.reduce((s, v) => s + v.spentThisYear, 0);

  function openForm(v?: VendorDTO) {
    setError("");
    setForm(
      v
        ? { id: v.id, companyId: v.companyId, name: v.name, trade: v.trade, phone: v.phone, email: v.email, note: v.note }
        : { ...EMPTY, companyId: company || companies[0]?.id || "" }
    );
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const editing = Boolean(form.id);
    const res = await fetch(editing ? `/api/vendors/${form.id}` : "/api/vendors", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that.");
      return;
    }
    setVendors((prev) =>
      (editing ? prev.map((v) => (v.id === data.id ? data : v)) : [...prev, data]).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    );
    setOpen(false);
    push(editing ? "Saved." : `${data.name} added to the book.`);
  }

  function remove(v: VendorDTO) {
    setConfirming({
      title: `Take ${v.name} out of the book?`,
      body:
        v.jobs || v.spent
          ? `Their ${v.jobs} ${v.jobs === 1 ? "repair" : "repairs"} and ${money(v.spent)} of expenses stay exactly as they are — they just stop saying who did the work.`
          : "They haven't been used on anything yet, so nothing else changes.",
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/vendors/${v.id}`, { method: "DELETE" });
        setConfirming(null);
        if (!res.ok) {
          push("Couldn't remove them.", "bad");
          return;
        }
        setVendors((prev) => prev.filter((x) => x.id !== v.id));
        push(`${v.name} removed.`);
      },
    });
  }

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Vendors"
      tagline="Who you call to fix things — and what you've paid them."
      back={{ href: "/dashboard/repairs", label: "Repairs" }}
      actions={
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          onClick={() => openForm()}
          disabled={companies.length === 0}
        >
          + Add a vendor
        </button>
      }
    >
      <div className={styles.vendorTools}>
        {companies.length > 1 && (
          <div className={styles.companyBar}>
            <button
              type="button"
              className={`${styles.chip} ${company === "" ? styles.active : ""}`}
              onClick={() => setCompany("")}
            >
              All LLCs
            </button>
            {companies.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.chip} ${company === c.id ? styles.active : ""}`}
                onClick={() => setCompany(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <input
          type="search"
          className={styles.vendorSearch}
          aria-label="Search vendors"
          placeholder="Search by name, trade or number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {vendors.length > 0 && (
        <p className={styles.helpText}>
          {shown.length} {shown.length === 1 ? "vendor" : "vendors"}
          {spentThisYear > 0 && <> · {money(spentThisYear)} paid out this year</>}
        </p>
      )}

      {vendors.length === 0 ? (
        <div className={styles.ledgerWrap}>
          <div className={styles.emptyState}>
            Nobody in the book yet. Add your plumber, your HVAC company, whoever does the lot —
            then put them on a repair from the queue and their jobs and costs add up here.
          </div>
        </div>
      ) : groups.length === 0 ? (
        <div className={styles.ledgerWrap}>
          <div className={styles.emptyState}>Nobody matches that.</div>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.trade} className={styles.block}>
            <div className={styles.blockHead}>
              <h2>{g.trade}</h2>
            </div>
            <div className={styles.tenantGrid}>
              {g.list.map((v) => (
                <div key={v.id} className={styles.tenantCard}>
                  <div className={styles.tenantHead}>
                    <div className={styles.tenantName}>
                      <span className={styles.name}>{v.name}</span>
                    </div>
                    {companies.length > 1 && <div className={styles.addr}>{companyName(v.companyId)}</div>}
                  </div>

                  {(v.phone || v.email) && (
                    <div className={styles.contactRow}>
                      {v.phone && telHref(v.phone) && (
                        <>
                          <a className={styles.contactBtn} href={telHref(v.phone)}>
                            Call {formatPhone(v.phone)}
                          </a>
                          <a className={styles.contactBtn} href={smsHref(v.phone)}>
                            Text
                          </a>
                        </>
                      )}
                      {v.email && (
                        <a className={styles.contactBtn} href={`mailto:${v.email}`}>
                          Email
                        </a>
                      )}
                    </div>
                  )}

                  <div className={styles.tenantFacts}>
                    <div className={styles.figure}>
                      <span className={styles.figureLabel}>Jobs</span>
                      <span className={styles.figureValue}>{v.jobs}</span>
                    </div>
                    <div className={styles.figure}>
                      <span className={styles.figureLabel}>Paid this year</span>
                      <span className={styles.figureValue}>{money(v.spentThisYear)}</span>
                    </div>
                    <div className={styles.figure}>
                      <span className={styles.figureLabel}>Last used</span>
                      <span className={styles.figureValue}>
                        {v.lastUsed ? formatDay(v.lastUsed) : "Not yet"}
                      </span>
                    </div>
                  </div>

                  {v.note && <div className={styles.note}>{v.note}</div>}

                  <div className={styles.propActions}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                      onClick={() => openForm(v)}
                    >
                      Edit
                    </button>
                    {ownerOf.includes(v.companyId) && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`}
                        onClick={() => remove(v)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {vendors.length > 0 && (
        <section className={styles.block}>
          <div className={styles.blockHead}>
            <h2>Their paperwork</h2>
          </div>
          <p className={styles.helpText} style={{ marginTop: -6 }}>
            Certificates of insurance and W-9s. A contractor whose insurance lapsed is your
            liability the day they fall off a ladder, so the expiry date matters here.
          </p>
          <DocumentsPanel
            initial={documents}
            targets={vendors.map((v) => ({
              key: `vendor:${v.id}`,
              label: companies.length > 1 ? `${v.name} — ${companyName(v.companyId)}` : v.name,
            }))}
            today={serverToday}
            canDelete={ownerOf.length > 0}
            storageReady={storageReady}
            onToast={(m, tone) => push(m, tone)}
            emptyText="No certificates or W-9s on file."
          />
        </section>
      )}

      <p className={styles.helpText} style={{ marginTop: 24 }}>
        Tenants never see who you send. <Link href="/dashboard/repairs">Back to the repair queue</Link>
      </p>

      <Modal
        open={open}
        title={form.id ? "Edit vendor" : "Add a vendor"}
        subtitle="Only the name is required."
        onClose={() => setOpen(false)}
      >
        <form onSubmit={save}>
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="v-name">Name</label>
              <input
                id="v-name"
                type="text"
                required
                placeholder="e.g. Bluegrass Plumbing"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="v-trade">Trade</label>
              <select
                id="v-trade"
                value={form.trade}
                onChange={(e) => setForm((f) => ({ ...f, trade: e.target.value }))}
              >
                {TRADES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {!form.id && companies.length > 1 && (
              <div className={`${styles.field} ${styles.span4}`}>
                <label htmlFor="v-company">Which LLC&apos;s book</label>
                <select
                  id="v-company"
                  value={form.companyId}
                  onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="v-phone">Phone</label>
              <input
                id="v-phone"
                type="tel"
                autoComplete="off"
                placeholder="(859) 555-0100"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="v-email">Email</label>
              <input
                id="v-email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="v-note">Note</label>
              <input
                id="v-note"
                type="text"
                placeholder="Rates, who to ask for, after-hours number…"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>
          <div className={styles.formFoot}>
            <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={saving}>
              {saving ? "Saving…" : form.id ? "Save" : "Add vendor"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}

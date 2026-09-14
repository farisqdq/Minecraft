"use client";

import { useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { shrinkImage } from "@/lib/shrinkImage";
import styles from "./dashboard.module.css";

type Company = { id: string; name: string; role: "owner" | "member" };

type Property = {
  id: string;
  companyId: string;
  name: string;
  address: string;
  monthlyRent: number;
};

type Attachment = {
  id: string;
  transactionId: string;
  url: string;
  filename: string;
  contentType: string;
};

type Transaction = {
  id: string;
  propertyId: string;
  type: "rent" | "expense";
  date: string;
  amount: number;
  detail: string;
  note: string;
  attachments: Attachment[];
};

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtFull = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const todayISO = () => new Date().toISOString().slice(0, 10);

const ALL_TIME = "all";

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthName(key: string, withYear = true) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export default function DashboardClient({
  userLabel,
  initialCompanies,
  initialProperties,
  initialTransactions,
}: {
  userLabel: string;
  initialCompanies: Company[];
  initialProperties: Property[];
  initialTransactions: Transaction[];
}) {
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [properties, setProperties] = useState<Property[]>(initialProperties);
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);

  const [selectedCompany, setSelectedCompany] = useState<string>(
    initialCompanies.length === 1 ? initialCompanies[0].id : "all"
  );

  const [addingCompany, setAddingCompany] = useState(false);
  const [companyName, setCompanyName] = useState("");

  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);

  const [addingProperty, setAddingProperty] = useState(false);
  const [propName, setPropName] = useState("");
  const [propAddress, setPropAddress] = useState("");
  const [propRent, setPropRent] = useState("");
  const [propCompany, setPropCompany] = useState("");

  const [type, setType] = useState<"rent" | "expense">("rent");
  const [propertyId, setPropertyId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [filterProperty, setFilterProperty] = useState("");
  const [filterType, setFilterType] = useState("");

  const [pendingProof, setPendingProof] = useState<File[]>([]);
  const proofInput = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState("");

  const visibleProperties = useMemo(
    () =>
      selectedCompany === "all"
        ? properties
        : properties.filter((p) => p.companyId === selectedCompany),
    [properties, selectedCompany]
  );

  const visibleIds = useMemo(() => new Set(visibleProperties.map((p) => p.id)), [visibleProperties]);

  const visibleTransactions = useMemo(
    () => transactions.filter((t) => visibleIds.has(t.propertyId)),
    [transactions, visibleIds]
  );

  function propName_(id: string) {
    return properties.find((p) => p.id === id)?.name ?? "—";
  }

  // Every month from the first recorded entry through the current one, so you
  // can page back through the year even where a month has nothing in it.
  const months = useMemo(() => {
    const earliest = transactions.reduce(
      (min, t) => (t.date < min ? t.date : min),
      currentMonthKey() + "-01"
    );
    const [startY, startM] = earliest.slice(0, 7).split("-").map(Number);
    const now = new Date();
    const list: string[] = [];
    let y = startY;
    let m = startM;
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      list.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return list;
  }, [transactions]);

  const monthIndex = months.indexOf(selectedMonth);
  const allTime = selectedMonth === ALL_TIME;

  const inScope = (t: Transaction) => allTime || t.date.startsWith(selectedMonth);

  const scopedTransactions = useMemo(
    () => visibleTransactions.filter(inScope),
    [visibleTransactions, selectedMonth]
  );

  function totalsFor(ids: Set<string> | null, txns: Transaction[]) {
    let rent = 0;
    let expense = 0;
    for (const t of txns) {
      if (ids && !ids.has(t.propertyId)) continue;
      if (t.type === "rent") rent += t.amount;
      else expense += t.amount;
    }
    return { rent, expense, net: rent - expense };
  }

  const inScopeTransactions = useMemo(() => transactions.filter(inScope), [transactions, selectedMonth]);

  const overall = totalsFor(visibleIds, scopedTransactions);

  const perCompany = useMemo(
    () =>
      companies.map((c) => {
        const ids = new Set(properties.filter((p) => p.companyId === c.id).map((p) => p.id));
        return { company: c, count: ids.size, ...totalsFor(ids, inScopeTransactions) };
      }),
    [companies, properties, inScopeTransactions]
  );

  // The rent bar always measures one month; on All time that's the current one.
  const barMonth = allTime ? currentMonthKey() : selectedMonth;

  function rentInBarMonth(propertyId: string) {
    return transactions
      .filter((t) => t.propertyId === propertyId && t.type === "rent" && t.date.startsWith(barMonth))
      .reduce((sum, t) => sum + t.amount, 0);
  }

  const rows = useMemo(
    () =>
      scopedTransactions
        .filter((t) => !filterProperty || t.propertyId === filterProperty)
        .filter((t) => !filterType || t.type === filterType)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date)),
    [scopedTransactions, filterProperty, filterType]
  );

  const activeCompany = companies.find((c) => c.id === selectedCompany) ?? null;

  const isRent = type === "rent";
  const formPropertyId =
    propertyId && visibleIds.has(propertyId) ? propertyId : visibleProperties[0]?.id ?? "";

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    const name = companyName.trim();
    if (!name) return;
    setError("");

    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't add that LLC.");
      return;
    }
    setCompanies((prev) => [...prev, data]);
    setSelectedCompany(data.id);
    setCompanyName("");
    setAddingCompany(false);
  }

  async function joinWithCode(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code) return;
    setError("");
    setJoinBusy(true);

    const res = await fetch("/api/invites/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    setJoinBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't join with that code.");
      return;
    }
    // Full reload so the newly visible LLC's properties and ledger come with it.
    window.location.href = "/dashboard";
  }

  function openPropertyForm() {
    setPropCompany(selectedCompany !== "all" ? selectedCompany : companies[0]?.id ?? "");
    setAddingProperty(true);
  }

  async function addProperty(e: React.FormEvent) {
    e.preventDefault();
    const name = propName.trim();
    if (!name || !propCompany) return;
    setError("");

    const res = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: propAddress.trim(),
        monthlyRent: parseFloat(propRent) || 0,
        companyId: propCompany,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't add that property.");
      return;
    }
    setProperties((prev) => [...prev, data]);
    if (!propertyId) setPropertyId(data.id);
    setPropName("");
    setPropAddress("");
    setPropRent("");
    setAddingProperty(false);
  }

  async function removeProperty(id: string) {
    const hasTxns = transactions.some((t) => t.propertyId === id);
    if (
      hasTxns &&
      !window.confirm(
        "This property has transactions in the ledger. Remove it anyway? Its transactions will be removed too."
      )
    ) {
      return;
    }
    const res = await fetch(`/api/properties/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setProperties((prev) => prev.filter((p) => p.id !== id));
    setTransactions((prev) => prev.filter((t) => t.propertyId !== id));
  }

  async function removeTransaction(id: string) {
    const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }

  /** Uploads one file and files the returned attachment onto its transaction. */
  async function uploadProof(transactionId: string, file: File) {
    const prepared = await shrinkImage(file);
    const form = new FormData();
    form.append("file", prepared);

    const res = await fetch(`/api/transactions/${transactionId}/attachments`, {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't upload that file.");
      return false;
    }

    setTransactions((prev) =>
      prev.map((t) => (t.id === transactionId ? { ...t, attachments: [...t.attachments, data] } : t))
    );
    return true;
  }

  async function addProofToRow(transactionId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setUploadingFor(transactionId);
    for (const file of Array.from(files)) {
      const uploaded = await uploadProof(transactionId, file);
      if (!uploaded) break;
    }
    setUploadingFor("");
  }

  async function removeAttachment(attachmentId: string) {
    const res = await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
    if (!res.ok) return;
    setTransactions((prev) =>
      prev.map((t) => ({ ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId) }))
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    // Must match what the select shows: a stale selection from another LLC
    // would otherwise book the money against the wrong house.
    const target = formPropertyId;
    if (!target || !date || !(amt > 0)) return;
    setError("");

    setSubmitting(true);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: target, type, date, amount: amt, detail, note }),
    });
    setSubmitting(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't save that transaction.");
      return;
    }

    const created: Transaction = { ...data, attachments: [] };
    setTransactions((prev) => [...prev, created]);
    setAmount("");
    setDetail("");
    setNote("");
    setDate(todayISO());

    if (pendingProof.length > 0) {
      setUploadingFor(created.id);
      for (const file of pendingProof) {
        const uploaded = await uploadProof(created.id, file);
        if (!uploaded) break;
      }
      setUploadingFor("");
      setPendingProof([]);
      if (proofInput.current) proofInput.current.value = "";
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <h1>Rent Roll</h1>
          <div className={styles.tagline}>Rent collected, repairs paid, and the profit left over — by property.</div>
        </div>
        <div className={styles.userBar}>
          <span>Signed in as {userLabel}</span>
          <Link href="/dashboard/team" className={styles.textLink}>
            Team
          </Link>
          <Link href="/dashboard/backup" className={styles.textLink}>
            Backup
          </Link>
          <button type="button" onClick={() => signOut({ callbackUrl: "/login" })}>
            Sign out
          </button>
        </div>
      </header>

      <nav className={styles.companyBar} aria-label="LLCs">
        {companies.length > 1 && (
          <button
            type="button"
            className={`${styles.chip} ${selectedCompany === "all" ? styles.active : ""}`}
            onClick={() => setSelectedCompany("all")}
          >
            All LLCs
          </button>
        )}
        {companies.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${styles.chip} ${selectedCompany === c.id ? styles.active : ""}`}
            onClick={() => setSelectedCompany(c.id)}
          >
            {c.name}
          </button>
        ))}
        {addingCompany ? (
          <form className={styles.inlineForm} onSubmit={addCompany}>
            <input
              id="new-company"
              type="text"
              autoFocus
              placeholder="e.g. Birchwood Holdings LLC"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
            <button type="submit" className={`${styles.btn} ${styles.small} ${styles.primary}`}>
              Add
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.small}`}
              onClick={() => {
                setAddingCompany(false);
                setCompanyName("");
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className={`${styles.chip} ${styles.chipAdd}`} onClick={() => setAddingCompany(true)}>
            + Add LLC
          </button>
        )}

        {joining ? (
          <form className={styles.inlineForm} onSubmit={joinWithCode}>
            <input
              id="join-code"
              type="text"
              autoFocus
              placeholder="Join code, e.g. K7P2-M9X4"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
            <button type="submit" className={`${styles.btn} ${styles.small} ${styles.primary}`} disabled={joinBusy}>
              {joinBusy ? "Joining…" : "Join"}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.small}`}
              onClick={() => {
                setJoining(false);
                setJoinCode("");
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className={`${styles.chip} ${styles.chipAdd}`} onClick={() => setJoining(true)}>
            Join with a code
          </button>
        )}
      </nav>

      {error && <div className={styles.errorBar}>{error}</div>}

      {companies.length === 0 ? (
        <div className={styles.firstRun}>
          <h2>Start with an LLC</h2>
          <p>
            Properties live under the company that owns them, so add your first LLC and then add its houses. You can
            invite partners to each LLC separately from the Team page.
          </p>
        </div>
      ) : (
        <>
          <nav className={styles.monthBar} aria-label="Period">
            <button
              type="button"
              className={styles.monthArrow}
              aria-label="Previous month"
              disabled={allTime || monthIndex <= 0}
              onClick={() => setSelectedMonth(months[monthIndex - 1])}
            >
              ‹
            </button>
            <span className={styles.monthLabel}>
              {allTime ? "All time" : monthName(selectedMonth)}
            </span>
            <button
              type="button"
              className={styles.monthArrow}
              aria-label="Next month"
              disabled={allTime || monthIndex < 0 || monthIndex >= months.length - 1}
              onClick={() => setSelectedMonth(months[monthIndex + 1])}
            >
              ›
            </button>
            <button
              type="button"
              className={`${styles.chip} ${allTime ? styles.active : ""}`}
              onClick={() => setSelectedMonth(allTime ? currentMonthKey() : ALL_TIME)}
            >
              {allTime ? "Back to this month" : "All time"}
            </button>
          </nav>

          <section className={styles.summary}>
            <div className={`${styles.tile} ${styles.rent}`}>
              <div className={styles.label}>Rent collected</div>
              <div className={`${styles.value} num`}>{fmtFull.format(overall.rent)}</div>
              <div className={styles.sub}>
                {allTime ? "all time" : monthName(selectedMonth)}
                {activeCompany ? ` · ${activeCompany.name}` : ""}
              </div>
            </div>
            <div className={`${styles.tile} ${styles.expense}`}>
              <div className={styles.label}>Repairs &amp; expenses</div>
              <div className={`${styles.value} num`}>{fmtFull.format(overall.expense)}</div>
              <div className={styles.sub}>
                {scopedTransactions.filter((t) => t.type === "expense").length} logged
              </div>
            </div>
            <div className={styles.tile}>
              <div className={styles.label}>Net profit</div>
              <div className={`${styles.value} num ${overall.net >= 0 ? styles.pos : styles.neg}`}>
                {overall.net >= 0 ? "" : "−"}
                {fmtFull.format(Math.abs(overall.net))}
              </div>
              <div className={styles.sub}>
                {overall.net >= 0 ? "in the black" : "in the red"}
                {allTime ? " to date" : ` in ${monthName(selectedMonth, false)}`}
              </div>
            </div>
          </section>

          {selectedCompany === "all" && companies.length > 1 && (
            <section className={styles.block}>
              <div className={styles.blockHead}>
                <h2>By LLC</h2>
              </div>
              <div className={styles.ledgerWrap}>
                <table className={styles.ledger}>
                  <thead>
                    <tr>
                      <th>LLC</th>
                      <th>Properties</th>
                      <th style={{ textAlign: "right" }}>Collected</th>
                      <th style={{ textAlign: "right" }}>Expenses</th>
                      <th style={{ textAlign: "right" }}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perCompany.map((row) => (
                      <tr key={row.company.id}>
                        <td>
                          <button
                            type="button"
                            className={styles.linkCell}
                            onClick={() => setSelectedCompany(row.company.id)}
                          >
                            {row.company.name}
                          </button>
                        </td>
                        <td>{row.count}</td>
                        <td className={`${styles.amt} num ${styles.pos}`}>{fmt.format(row.rent)}</td>
                        <td className={`${styles.amt} num ${styles.neg}`}>{fmt.format(row.expense)}</td>
                        <td className={`${styles.amt} num ${row.net >= 0 ? styles.pos : styles.neg}`}>
                          {row.net >= 0 ? "" : "−"}
                          {fmt.format(Math.abs(row.net))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className={styles.block}>
            <div className={styles.blockHead}>
              <h2>Properties</h2>
              <span className={styles.count}>
                {visibleProperties.length
                  ? `${visibleProperties.length} ${visibleProperties.length === 1 ? "property" : "properties"}`
                  : ""}
              </span>
            </div>
            <div className={styles.properties}>
              {visibleProperties.map((p) => {
                const ids = new Set([p.id]);
                const t = totalsFor(ids, inScopeTransactions);
                const target = p.monthlyRent || 0;
                const paidThisMonth = rentInBarMonth(p.id);
                const pct = target > 0 ? Math.min(100, Math.round((paidThisMonth / target) * 100)) : 0;
                const paidInFull = target > 0 && paidThisMonth >= target;
                const owner = companies.find((c) => c.id === p.companyId);
                return (
                  <div key={p.id} className={styles.propCard}>
                    <div>
                      <div className={styles.name}>{p.name}</div>
                      <div className={styles.addr}>{p.address}</div>
                      {selectedCompany === "all" && owner && (
                        <div className={styles.ownerTag}>{owner.name}</div>
                      )}
                    </div>
                    <div className={styles.rentLine}>
                      <span>Monthly rent</span>
                      <span className="num">{fmt.format(target)}</span>
                    </div>
                    {target > 0 && (
                      <div>
                        <div className={styles.bar}>
                          <span
                            className={paidInFull ? styles.barFull : undefined}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className={styles.barCaption}>
                          <span>{monthName(barMonth, false)} rent</span>
                          <span className={`num ${paidInFull ? styles.pos : ""}`}>
                            {paidInFull
                              ? "Paid in full"
                              : `${fmt.format(paidThisMonth)} of ${fmt.format(target)}`}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className={styles.propRow}>
                      <span className={styles.l}>Collected</span>
                      <span className={`${styles.v} ${styles.pos} num`}>{fmt.format(t.rent)}</span>
                    </div>
                    <div className={styles.propRow}>
                      <span className={styles.l}>Repairs &amp; expenses</span>
                      <span className={`${styles.v} ${styles.neg} num`}>{fmt.format(t.expense)}</span>
                    </div>
                    <div className={styles.propRow}>
                      <span className={styles.l}>Net</span>
                      <span className={`${styles.v} ${t.net >= 0 ? styles.pos : styles.neg} num`}>
                        {t.net >= 0 ? "" : "−"}
                        {fmt.format(Math.abs(t.net))}
                      </span>
                    </div>
                    <div className={styles.propActions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                        onClick={() => removeProperty(p.id)}
                      >
                        Remove property
                      </button>
                    </div>
                  </div>
                );
              })}

              {addingProperty ? (
                <form className={`${styles.propCard} ${styles.propForm}`} onSubmit={addProperty}>
                  <div className={styles.field}>
                    <label htmlFor="new-prop-name">Property name</label>
                    <input
                      id="new-prop-name"
                      type="text"
                      autoFocus
                      required
                      placeholder="e.g. Birchwood Ave"
                      value={propName}
                      onChange={(e) => setPropName(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="new-prop-address">Address</label>
                    <input
                      id="new-prop-address"
                      type="text"
                      placeholder="142 Birchwood Ave"
                      value={propAddress}
                      onChange={(e) => setPropAddress(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="new-prop-rent">Monthly rent ($)</label>
                    <input
                      id="new-prop-rent"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={propRent}
                      onChange={(e) => setPropRent(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="new-prop-company">Owned by</label>
                    <select
                      id="new-prop-company"
                      required
                      value={propCompany}
                      onChange={(e) => setPropCompany(e.target.value)}
                    >
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.propActions}>
                    <button type="submit" className={`${styles.btn} ${styles.small} ${styles.primary}`}>
                      Add property
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small}`}
                      onClick={() => setAddingProperty(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button type="button" className={styles.addCard} onClick={openPropertyForm}>
                  + Add a property
                </button>
              )}
            </div>
          </section>

          <section className={styles.block}>
            <div className={styles.blockHead}>
              <h2>Record a transaction</h2>
            </div>
            <div className={styles.formCard}>
              <div className={styles.typeToggle}>
                <button
                  type="button"
                  className={type === "rent" ? `${styles.active} ${styles.rent}` : ""}
                  onClick={() => setType("rent")}
                >
                  Rent payment
                </button>
                <button
                  type="button"
                  className={type === "expense" ? `${styles.active} ${styles.expense}` : ""}
                  onClick={() => setType("expense")}
                >
                  Repair / expense
                </button>
              </div>
              <form onSubmit={onSubmit}>
                <div className={styles.fieldGrid}>
                  <div className={`${styles.field} ${styles.wide}`}>
                    <label htmlFor="f-property">Property</label>
                    <select
                      id="f-property"
                      required
                      value={formPropertyId}
                      onChange={(e) => setPropertyId(e.target.value)}
                    >
                      {visibleProperties.length === 0 && <option value="">Add a property first</option>}
                      {visibleProperties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="f-date">Date</label>
                    <input id="f-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="f-amount">Amount ($)</label>
                    <input
                      id="f-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <div className={`${styles.field} ${styles.wide}`}>
                    <label htmlFor="f-detail">{isRent ? "Paid by (tenant)" : "Category"}</label>
                    <input
                      id="f-detail"
                      type="text"
                      placeholder={isRent ? "e.g. J. Alvarez" : "e.g. Plumbing, HVAC, roof"}
                      value={detail}
                      onChange={(e) => setDetail(e.target.value)}
                    />
                  </div>
                  <div className={styles.field} style={{ gridColumn: "span 3" }}>
                    <label htmlFor="f-note">Note (optional)</label>
                    <input
                      id="f-note"
                      type="text"
                      placeholder={isRent ? "e.g. September rent, paid via check" : "e.g. Fixed leaking kitchen faucet"}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </div>
                  <div className={styles.field} style={{ gridColumn: "span 4" }}>
                    <label htmlFor="f-proof">
                      {isRent ? "Proof of payment (optional)" : "Receipt or photo (optional)"}
                    </label>
                    <input
                      id="f-proof"
                      ref={proofInput}
                      type="file"
                      multiple
                      accept="image/*,application/pdf"
                      className={styles.fileInput}
                      onChange={(e) => setPendingProof(Array.from(e.target.files ?? []))}
                    />
                    {pendingProof.length > 0 && (
                      <span className={styles.note}>
                        {pendingProof.length} file{pendingProof.length === 1 ? "" : "s"} will be attached
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.formFoot}>
                  <button
                    type="submit"
                    className={`${styles.btn} ${styles.primary}`}
                    disabled={submitting || visibleProperties.length === 0}
                  >
                    {isRent ? "Add rent payment" : "Add expense"}
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section className={styles.block}>
            <div className={styles.blockHead}>
              <h2>Ledger · {allTime ? "all time" : monthName(selectedMonth)}</h2>
              <div className={styles.ledgerControls}>
                <select value={filterProperty} onChange={(e) => setFilterProperty(e.target.value)}>
                  <option value="">All properties</option>
                  {visibleProperties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                  <option value="">All types</option>
                  <option value="rent">Rent only</option>
                  <option value="expense">Expenses only</option>
                </select>
              </div>
            </div>
            <div className={styles.ledgerWrap}>
              <table className={styles.ledger}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Property</th>
                    <th>Type</th>
                    <th>Details</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <div className={styles.emptyState}>
                          {allTime
                            ? "No transactions yet — record a rent payment or expense above."
                            : `Nothing recorded in ${monthName(selectedMonth)} yet.`}
                        </div>
                      </td>
                    </tr>
                  )}
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td>{fmtDate(t.date)}</td>
                      <td>{propName_(t.propertyId)}</td>
                      <td>
                        <span className={`${styles.tag} ${t.type === "rent" ? styles.rent : styles.expense}`}>
                          {t.type === "rent" ? "Rent" : "Expense"}
                        </span>
                      </td>
                      <td>
                        {t.detail}
                        {t.note && <div className={styles.note}>{t.note}</div>}
                        {t.attachments.length > 0 && (
                          <div className={styles.proofRow}>
                            {t.attachments.map((a) => (
                              <span key={a.id} className={styles.proofItem}>
                                <a href={a.url} target="_blank" rel="noopener noreferrer" title={a.filename}>
                                  {a.contentType.startsWith("image/") ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={a.url} alt={a.filename} className={styles.proofThumb} />
                                  ) : (
                                    <span className={styles.proofFile}>PDF</span>
                                  )}
                                </a>
                                <button
                                  type="button"
                                  className={styles.proofRemove}
                                  aria-label={`Remove ${a.filename}`}
                                  onClick={() => removeAttachment(a.id)}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        <label className={styles.proofAdd}>
                          {uploadingFor === t.id
                            ? "Uploading…"
                            : t.attachments.length > 0
                              ? "+ Add another"
                              : "+ Attach proof"}
                          <input
                            type="file"
                            multiple
                            accept="image/*,application/pdf"
                            hidden
                            disabled={uploadingFor === t.id}
                            onChange={(e) => {
                              addProofToRow(t.id, e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </td>
                      <td className={`${styles.amt} num ${t.type === "rent" ? styles.pos : styles.neg}`}>
                        {t.type === "rent" ? "+" : "−"}
                        {fmt.format(t.amount)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small} ${styles.ghost} ${styles.rowDel}`}
                          onClick={() => removeTransaction(t.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

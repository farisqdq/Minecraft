"use client";

import { useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import styles from "./dashboard.module.css";

type Property = {
  id: string;
  name: string;
  address: string;
  monthlyRent: number;
};

type Transaction = {
  id: string;
  propertyId: string;
  type: "rent" | "expense";
  date: string;
  amount: number;
  detail: string;
  note: string;
};

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtFull = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function DashboardClient({
  userLabel,
  initialProperties,
  initialTransactions,
}: {
  userLabel: string;
  initialProperties: Property[];
  initialTransactions: Transaction[];
}) {
  const [properties, setProperties] = useState<Property[]>(initialProperties);
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);

  const [type, setType] = useState<"rent" | "expense">("rent");
  const [propertyId, setPropertyId] = useState(initialProperties[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [filterProperty, setFilterProperty] = useState("");
  const [filterType, setFilterType] = useState("");

  function propName(id: string) {
    return properties.find((p) => p.id === id)?.name ?? "—";
  }

  function totalsFor(propId: string | null) {
    let rent = 0;
    let expense = 0;
    for (const t of transactions) {
      if (propId && t.propertyId !== propId) continue;
      if (t.type === "rent") rent += t.amount;
      else expense += t.amount;
    }
    return { rent, expense, net: rent - expense };
  }

  const overall = totalsFor(null);

  const rows = useMemo(() => {
    return transactions
      .filter((t) => !filterProperty || t.propertyId === filterProperty)
      .filter((t) => !filterType || t.type === filterType)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, filterProperty, filterType]);

  async function addProperty() {
    const name = window.prompt("Property name (e.g. street name or nickname):");
    if (!name) return;
    const address = window.prompt("Address (optional):") || "";
    const rentStr = window.prompt("Monthly rent amount ($):", "0");
    const monthlyRent = parseFloat(rentStr || "0") || 0;

    const res = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), address: address.trim(), monthlyRent }),
    });
    if (!res.ok) return;
    const created: Property = await res.json();
    setProperties((prev) => [...prev, created]);
    if (!propertyId) setPropertyId(created.id);
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!propertyId || !date || !(amt > 0)) return;

    setSubmitting(true);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, type, date, amount: amt, detail, note }),
    });
    setSubmitting(false);
    if (!res.ok) return;

    const created: Transaction = await res.json();
    setTransactions((prev) => [...prev, created]);
    setAmount("");
    setDetail("");
    setNote("");
    setDate(todayISO());
  }

  const isRent = type === "rent";

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <h1>Rent Roll</h1>
          <div className={styles.tagline}>Rent collected, repairs paid, and the profit left over — by property.</div>
        </div>
        <div className={styles.userBar}>
          <span>Signed in as {userLabel}</span>
          <button type="button" onClick={() => signOut({ callbackUrl: "/login" })}>
            Sign out
          </button>
        </div>
      </header>

      <section className={styles.summary}>
        <div className={`${styles.tile} ${styles.rent}`}>
          <div className={styles.label}>Rent collected</div>
          <div className={`${styles.value} num`}>{fmtFull.format(overall.rent)}</div>
          <div className={styles.sub}>
            across {properties.length} {properties.length === 1 ? "property" : "properties"}
          </div>
        </div>
        <div className={`${styles.tile} ${styles.expense}`}>
          <div className={styles.label}>Repairs &amp; expenses</div>
          <div className={`${styles.value} num`}>{fmtFull.format(overall.expense)}</div>
          <div className={styles.sub}>{transactions.filter((t) => t.type === "expense").length} logged</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.label}>Net profit</div>
          <div className={`${styles.value} num ${overall.net >= 0 ? styles.pos : styles.neg}`}>
            {overall.net >= 0 ? "" : "−"}
            {fmtFull.format(Math.abs(overall.net))}
          </div>
          <div className={styles.sub}>{overall.net >= 0 ? "in the black" : "in the red"} to date</div>
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Properties</h2>
          <span className={styles.count}>
            {properties.length ? `${properties.length} ${properties.length === 1 ? "property" : "properties"}` : ""}
          </span>
        </div>
        <div className={styles.properties}>
          {properties.map((p) => {
            const t = totalsFor(p.id);
            const total = t.rent + t.expense;
            const pct = total > 0 ? Math.round((t.rent / total) * 100) : 100;
            return (
              <div key={p.id} className={styles.propCard}>
                <div>
                  <div className={styles.name}>{p.name}</div>
                  <div className={styles.addr}>{p.address}</div>
                </div>
                <div className={styles.rentLine}>
                  <span>Monthly rent</span>
                  <span className="num">{fmt.format(p.monthlyRent || 0)}</span>
                </div>
                <div className={styles.bar}>
                  <span style={{ width: `${pct}%` }} />
                </div>
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
          <button type="button" className={styles.addCard} onClick={addProperty}>
            + Add a property
          </button>
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
                <select id="f-property" required value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  {properties.length === 0 && <option value="">Add a property first</option>}
                  {properties.map((p) => (
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
            </div>
            <div className={styles.formFoot}>
              <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={submitting || properties.length === 0}>
                {isRent ? "Add rent payment" : "Add expense"}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Ledger</h2>
          <div className={styles.ledgerControls}>
            <select value={filterProperty} onChange={(e) => setFilterProperty(e.target.value)}>
              <option value="">All properties</option>
              {properties.map((p) => (
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
                    <div className={styles.emptyState}>No transactions yet — record a rent payment or expense above.</div>
                  </td>
                </tr>
              )}
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.date)}</td>
                  <td>{propName(t.propertyId)}</td>
                  <td>
                    <span className={`${styles.tag} ${t.type === "rent" ? styles.rent : styles.expense}`}>
                      {t.type === "rent" ? "Rent" : "Expense"}
                    </span>
                  </td>
                  <td>
                    {t.detail}
                    {t.note && <div className={styles.note}>{t.note}</div>}
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
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../dashboard.module.css";
import { EXPENSE_CATEGORIES } from "@/lib/categories";

type Property = { id: string; name: string; address: string; monthlyRent: number; vacant: boolean };
type Unit = { id: string; propertyId: string; name: string; monthlyRent: number; vacant: boolean };
type RecurringExpense = {
  id: string;
  propertyId: string;
  unitId: string | null;
  category: string;
  detail: string;
  note: string;
  amount: number;
  frequency: "monthly" | "yearly";
  day: number;
  month: number | null;
  active: boolean;
};

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function PropertyManageClient({
  property,
  initialUnits,
  initialRecurring,
}: {
  property: Property;
  initialUnits: Unit[];
  initialRecurring: RecurringExpense[];
}) {
  const router = useRouter();
  const [units, setUnits] = useState<Unit[]>(initialUnits);
  const [recurring, setRecurring] = useState<RecurringExpense[]>(initialRecurring);
  const [error, setError] = useState("");

  const [addingUnit, setAddingUnit] = useState(false);
  const [unitName, setUnitName] = useState("");
  const [unitRent, setUnitRent] = useState("");

  const [editingUnitId, setEditingUnitId] = useState("");
  const [editUnitName, setEditUnitName] = useState("");
  const [editUnitRent, setEditUnitRent] = useState("");
  const [editUnitVacant, setEditUnitVacant] = useState(false);

  const [addingRecurring, setAddingRecurring] = useState(false);
  const [rCategory, setRCategory] = useState("");
  const [rUnitId, setRUnitId] = useState("");
  const [rAmount, setRAmount] = useState("");
  const [rDetail, setRDetail] = useState("");
  const [rFrequency, setRFrequency] = useState<"monthly" | "yearly">("monthly");
  const [rDay, setRDay] = useState("1");
  const [rMonth, setRMonth] = useState("1");

  async function addUnit(e: React.FormEvent) {
    e.preventDefault();
    const name = unitName.trim();
    if (!name) return;
    setError("");

    const res = await fetch(`/api/properties/${property.id}/units`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, monthlyRent: parseFloat(unitRent) || 0 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't add that unit.");
      return;
    }
    setUnits((prev) => [...prev, data]);
    setUnitName("");
    setUnitRent("");
    setAddingUnit(false);
  }

  function startEditUnit(u: Unit) {
    setEditingUnitId(u.id);
    setEditUnitName(u.name);
    setEditUnitRent(u.monthlyRent ? String(u.monthlyRent) : "");
    setEditUnitVacant(u.vacant);
  }

  async function saveUnit(e: React.FormEvent) {
    e.preventDefault();
    const name = editUnitName.trim();
    if (!name) return;
    setError("");

    const res = await fetch(`/api/units/${editingUnitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, monthlyRent: parseFloat(editUnitRent) || 0, vacant: editUnitVacant }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't save that unit.");
      return;
    }
    setUnits((prev) => prev.map((u) => (u.id === editingUnitId ? data : u)));
    setEditingUnitId("");
  }

  async function removeUnit(id: string) {
    if (!window.confirm("Remove this unit? Its past ledger entries stay, but stop being tied to a unit.")) return;
    const res = await fetch(`/api/units/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setUnits((prev) => prev.filter((u) => u.id !== id));
    router.refresh();
  }

  async function addRecurring(e: React.FormEvent) {
    e.preventDefault();
    if (!rCategory || !(parseFloat(rAmount) > 0)) return;
    setError("");

    const res = await fetch(`/api/properties/${property.id}/recurring`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: rCategory,
        unitId: rUnitId || undefined,
        amount: parseFloat(rAmount),
        detail: rDetail,
        frequency: rFrequency,
        day: parseInt(rDay, 10) || 1,
        month: rFrequency === "yearly" ? parseInt(rMonth, 10) || 1 : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't add that recurring expense.");
      return;
    }
    setRecurring((prev) => [...prev, data]);
    setRCategory("");
    setRUnitId("");
    setRAmount("");
    setRDetail("");
    setRFrequency("monthly");
    setRDay("1");
    setRMonth("1");
    setAddingRecurring(false);
  }

  async function toggleRecurringActive(r: RecurringExpense) {
    const res = await fetch(`/api/recurring/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setRecurring((prev) => prev.map((x) => (x.id === r.id ? data : x)));
  }

  async function removeRecurring(id: string) {
    if (!window.confirm("Delete this recurring expense? Past logged entries stay in the ledger.")) return;
    const res = await fetch(`/api/recurring/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setRecurring((prev) => prev.filter((r) => r.id !== id));
  }

  function unitLabel(unitId: string | null) {
    if (!unitId) return "Whole property";
    return units.find((u) => u.id === unitId)?.name ?? "—";
  }

  function scheduleLabel(r: RecurringExpense) {
    if (r.frequency === "yearly") return `Yearly, ${MONTHS[(r.month ?? 1) - 1]} ${r.day}`;
    return `Monthly, day ${r.day}`;
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <h1>{property.name}</h1>
          <div className={styles.tagline}>{property.address || "Manage units and recurring expenses"}</div>
        </div>
        <div className={styles.userBar}>
          <a href="/dashboard" className={styles.textLink}>
            Back to dashboard
          </a>
        </div>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Units</h2>
          <span className={styles.count}>
            {units.length ? `${units.length} ${units.length === 1 ? "unit" : "units"}` : ""}
          </span>
        </div>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Split this property into units when it&apos;s a duplex, triplex, or building with more than one tenant —
          each unit gets its own rent target and tenant. Leave it with no units for a single-tenant house.
        </p>

        {units.length === 0 ? (
          <div className={styles.ledgerWrap}>
            <div className={styles.emptyState}>No units yet — this property is tracked as a whole.</div>
          </div>
        ) : (
        <div className={styles.ledgerWrap}>
          <table className={styles.ledger}>
            <thead>
              <tr>
                <th>Unit</th>
                <th style={{ textAlign: "right" }}>Monthly rent</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) =>
                editingUnitId === u.id ? (
                  <tr key={u.id}>
                    <td colSpan={4}>
                      <form className={styles.inlineForm} onSubmit={saveUnit} style={{ flexWrap: "wrap" }}>
                        <input
                          type="text"
                          required
                          autoFocus
                          value={editUnitName}
                          onChange={(e) => setEditUnitName(e.target.value)}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Monthly rent"
                          value={editUnitRent}
                          onChange={(e) => setEditUnitRent(e.target.value)}
                        />
                        <label className={styles.checkboxField}>
                          <input
                            type="checkbox"
                            checked={editUnitVacant}
                            onChange={(e) => setEditUnitVacant(e.target.checked)}
                          />
                          Vacant
                        </label>
                        <button type="submit" className={`${styles.btn} ${styles.small} ${styles.primary}`}>
                          Save
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small}`}
                          onClick={() => setEditingUnitId("")}
                        >
                          Cancel
                        </button>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      {u.vacant && <span className={styles.vacantTag}>Vacant</span>}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {fmt.format(u.monthlyRent)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small}`}
                        onClick={() => startEditUnit(u)}
                      >
                        Edit
                      </button>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                        onClick={() => removeUnit(u.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
        )}

        {addingUnit ? (
          <form className={styles.inlineForm} onSubmit={addUnit} style={{ marginTop: 14, flexWrap: "wrap" }}>
            <input
              type="text"
              required
              autoFocus
              placeholder="Unit name, e.g. Apt 2"
              value={unitName}
              onChange={(e) => setUnitName(e.target.value)}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Monthly rent"
              value={unitRent}
              onChange={(e) => setUnitRent(e.target.value)}
            />
            <button type="submit" className={`${styles.btn} ${styles.small} ${styles.primary}`}>
              Add unit
            </button>
            <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => setAddingUnit(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div style={{ marginTop: 14 }}>
            <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => setAddingUnit(true)}>
              + Add a unit
            </button>
          </div>
        )}
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Recurring expenses</h2>
        </div>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Mortgage, insurance, HOA dues — set the amount and schedule once. Nothing posts on its own: when it&apos;s
          due, it shows up on the dashboard for that month with a one-click &ldquo;Log it&rdquo; button.
        </p>

        {recurring.length === 0 ? (
          <div className={styles.ledgerWrap}>
            <div className={styles.emptyState}>No recurring expenses set up yet.</div>
          </div>
        ) : (
        <div className={styles.ledgerWrap}>
          <table className={styles.ledger}>
            <thead>
              <tr>
                <th>Category</th>
                <th>Applies to</th>
                <th>Schedule</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td>
                    {r.category}
                    {r.detail && <div className={styles.note}>{r.detail}</div>}
                  </td>
                  <td>{unitLabel(r.unitId)}</td>
                  <td>{scheduleLabel(r)}</td>
                  <td className={`${styles.amt} num ${styles.neg}`}>{fmt.format(r.amount)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small}`}
                      onClick={() => toggleRecurringActive(r)}
                    >
                      {r.active ? "Pause" : "Resume"}
                    </button>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small} ${styles.ghost}`}
                      onClick={() => removeRecurring(r.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {addingRecurring ? (
          <form className={styles.formCard} onSubmit={addRecurring} style={{ marginTop: 14 }}>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label htmlFor="r-category">Category</label>
                <select id="r-category" required value={rCategory} onChange={(e) => setRCategory(e.target.value)}>
                  <option value="">Choose one</option>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              {units.length > 0 && (
                <div className={styles.field}>
                  <label htmlFor="r-unit">Applies to</label>
                  <select id="r-unit" value={rUnitId} onChange={(e) => setRUnitId(e.target.value)}>
                    <option value="">Whole property</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className={styles.field}>
                <label htmlFor="r-amount">Amount ($)</label>
                <input
                  id="r-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={rAmount}
                  onChange={(e) => setRAmount(e.target.value)}
                />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="r-detail">Description (optional)</label>
                <input
                  id="r-detail"
                  type="text"
                  placeholder="e.g. First National Mortgage"
                  value={rDetail}
                  onChange={(e) => setRDetail(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="r-frequency">Frequency</label>
                <select
                  id="r-frequency"
                  value={rFrequency}
                  onChange={(e) => setRFrequency(e.target.value as "monthly" | "yearly")}
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              {rFrequency === "yearly" && (
                <div className={styles.field}>
                  <label htmlFor="r-month">Month</label>
                  <select id="r-month" value={rMonth} onChange={(e) => setRMonth(e.target.value)}>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className={styles.field}>
                <label htmlFor="r-day">Day of month</label>
                <input
                  id="r-day"
                  type="number"
                  min="1"
                  max="31"
                  value={rDay}
                  onChange={(e) => setRDay(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.formFoot}>
              <button type="submit" className={`${styles.btn} ${styles.primary}`}>
                Add recurring expense
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => setAddingRecurring(false)}
                style={{ marginLeft: 8 }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.small}`}
              onClick={() => setAddingRecurring(true)}
            >
              + Add a recurring expense
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

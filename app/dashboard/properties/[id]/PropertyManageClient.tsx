"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../../components/AppShell";
import CashFlowChart from "../../../components/CashFlowChart";
import ConfirmDialog, { type ConfirmRequest } from "../../../components/ConfirmDialog";
import Modal from "../../../components/Modal";
import { Toasts, useToasts } from "../../../components/Toasts";
import styles from "../../dashboard.module.css";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { money } from "@/lib/money";
import { historyFor, type RentChangeDTO } from "@/lib/rent";
import type { TenantDTO } from "@/lib/tenants";
import { dateFromISO, formatDay, isoDay, leaseRange, leaseStatus, smsHref, telHref } from "@/lib/lease";

type Property = { id: string; name: string; address: string; monthlyRent: number; vacant: boolean };
type LedgerEntry = {
  id: string;
  unitId: string | null;
  type: "rent" | "expense";
  date: string;
  amount: number;
  detail: string;
  note: string;
  category: string;
  proofCount: number;
};
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

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const EMPTY_TENANT = {
  id: "",
  name: "",
  unitId: "",
  phone: "",
  email: "",
  leaseStart: "",
  leaseEnd: "",
  deposit: "",
  dueDay: "1",
  note: "",
};

export default function PropertyManageClient({
  companyName,
  serverToday,
  property,
  initialUnits,
  initialRecurring,
  initialTenants,
  rentChanges,
  transactions,
}: {
  companyName: string;
  serverToday: string;
  property: Property;
  initialUnits: Unit[];
  initialRecurring: RecurringExpense[];
  initialTenants: TenantDTO[];
  rentChanges: RentChangeDTO[];
  transactions: LedgerEntry[];
}) {
  const router = useRouter();

  // Same reconciliation as the dashboard: start on the server's date so the
  // first client render matches, then switch to the browser's own.
  const [todayKey, setTodayKey] = useState(serverToday);
  useEffect(() => {
    const local = isoDay(new Date());
    if (local !== serverToday) setTodayKey(local);
  }, [serverToday]);
  const now = useMemo(() => dateFromISO(todayKey), [todayKey]);

  const [units, setUnits] = useState<Unit[]>(initialUnits);
  const [recurring, setRecurring] = useState<RecurringExpense[]>(initialRecurring);
  const [tenants, setTenants] = useState<TenantDTO[]>(initialTenants);
  const [tenantForm, setTenantForm] = useState(EMPTY_TENANT);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [tenantSaving, setTenantSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { toasts, push, dismiss } = useToasts();

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

  function removeUnit(unit: Unit) {
    setConfirming({
      title: `Remove ${unit.name}?`,
      body: "Past ledger entries stay in the books — they just stop being tied to a unit. Rent tracking for this unit stops.",
      confirmLabel: "Remove unit",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/units/${unit.id}`, { method: "DELETE" });
        if (!res.ok) {
          push("Couldn't remove that unit.", "bad");
          return;
        }
        setUnits((prev) => prev.filter((u) => u.id !== unit.id));
        push(`${unit.name} removed.`);
        router.refresh();
      },
    });
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

  function removeRecurring(r: RecurringExpense) {
    setConfirming({
      title: `Delete this ${r.category.toLowerCase()} bill?`,
      body: "Entries already logged from it stay in the ledger. It just stops showing up as due each period.",
      confirmLabel: "Delete bill",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/recurring/${r.id}`, { method: "DELETE" });
        if (!res.ok) {
          push("Couldn't delete that recurring expense.", "bad");
          return;
        }
        setRecurring((prev) => prev.filter((x) => x.id !== r.id));
        push("Recurring expense deleted.");
      },
    });
  }

  // ---------- Tenants ----------

  function openTenant(t?: TenantDTO) {
    setError("");
    setTenantForm(
      t
        ? {
            id: t.id,
            name: t.name,
            unitId: t.unitId ?? "",
            phone: t.phone,
            email: t.email,
            leaseStart: t.leaseStart,
            leaseEnd: t.leaseEnd,
            deposit: t.deposit ? String(t.deposit) : "",
            dueDay: String(t.dueDay),
            note: t.note,
          }
        : { ...EMPTY_TENANT, unitId: units[0]?.id ?? "" }
    );
    setTenantOpen(true);
  }

  async function saveTenant(e: React.FormEvent) {
    e.preventDefault();
    const name = tenantForm.name.trim();
    if (!name) return;
    setTenantSaving(true);
    setError("");

    const payload = {
      name,
      unitId: units.length > 0 ? tenantForm.unitId || null : null,
      phone: tenantForm.phone,
      email: tenantForm.email,
      leaseStart: tenantForm.leaseStart,
      leaseEnd: tenantForm.leaseEnd,
      deposit: parseFloat(tenantForm.deposit) || 0,
      dueDay: parseInt(tenantForm.dueDay, 10) || 1,
      note: tenantForm.note,
    };

    const editing = Boolean(tenantForm.id);
    const res = await fetch(
      editing ? `/api/tenants/${tenantForm.id}` : `/api/properties/${property.id}/tenants`,
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json().catch(() => ({}));
    setTenantSaving(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that tenant.");
      return;
    }

    setTenants((prev) => (editing ? prev.map((t) => (t.id === data.id ? data : t)) : [...prev, data]));
    setTenantOpen(false);
    push(editing ? "Tenant updated." : `${data.name} added.`);
    router.refresh();
  }

  async function setTenantActive(t: TenantDTO, active: boolean) {
    const res = await fetch(`/api/tenants/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      push("Couldn't update that tenant.", "bad");
      return;
    }
    setTenants((prev) => prev.map((x) => (x.id === t.id ? data : x)));
    push(active ? `${t.name} is current again.` : `${t.name} moved to past tenants.`);
    router.refresh();
  }

  function removeTenant(t: TenantDTO) {
    setConfirming({
      title: `Delete ${t.name}?`,
      body: "This erases their contact details and lease dates. Rent they paid stays in the ledger. If they've just moved out, ending the tenancy keeps the record instead.",
      confirmLabel: "Delete tenant",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/tenants/${t.id}`, { method: "DELETE" });
        if (!res.ok) {
          push("Couldn't delete that tenant.", "bad");
          return;
        }
        setTenants((prev) => prev.filter((x) => x.id !== t.id));
        push(`${t.name} deleted.`);
        router.refresh();
      },
    });
  }

  /**
   * The rent trail for a place, newest first. Only rendered when there is
   * one — most properties have never had a change, and an empty history is
   * not worth a line of chrome.
   */
  function RentTrail({ unitId }: { unitId: string | null }) {
    const history = historyFor(rentChanges, property.id, unitId);
    if (history.length === 0) return null;

    const asMonth = (key: string) => {
      const [y, m] = key.split("-").map(Number);
      // The backfilled row stands for "since before any of this was recorded".
      if (y <= 1970) return "at first";
      return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    };

    // The current figure is already on screen beside this, so the trail
    // starts at "since when" and only names the older amounts.
    return (
      <div className={styles.note}>
        since {asMonth(history[0].effectiveFrom)}
        {history.slice(1).map((c) => (
          <span key={c.id}>
            {" · "}
            {money(c.amount)} {asMonth(c.effectiveFrom)}
          </span>
        ))}
      </div>
    );
  }

  function unitLabel(unitId: string | null) {
    if (!unitId) return "Whole property";
    return units.find((u) => u.id === unitId)?.name ?? "—";
  }

  function scheduleLabel(r: RecurringExpense) {
    if (r.frequency === "yearly") return `Yearly, ${MONTHS[(r.month ?? 1) - 1]} ${r.day}`;
    return `Monthly, day ${r.day}`;
  }

  // Twelve months ending this month, for this property alone.
  const series = useMemo(() => {
    const keys = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    const buckets = new Map(keys.map((k) => [k, { month: k, rent: 0, expense: 0 }]));
    for (const t of transactions) {
      const bucket = buckets.get(t.date.slice(0, 7));
      if (!bucket) continue;
      if (t.type === "rent") bucket.rent += t.amount;
      else bucket.expense += t.amount;
    }
    return keys.map((k) => buckets.get(k)!);
  }, [transactions, now]);

  const lastTwelve = useMemo(() => {
    const rent = series.reduce((sum, m) => sum + m.rent, 0);
    const expense = series.reduce((sum, m) => sum + m.expense, 0);
    return { rent, expense, net: rent - expense };
  }, [series]);

  const lifetime = useMemo(() => {
    let rent = 0;
    let expense = 0;
    for (const t of transactions) {
      if (t.type === "rent") rent += t.amount;
      else expense += t.amount;
    }
    return { rent, expense, net: rent - expense };
  }, [transactions]);

  const currentTenants = tenants.filter((t) => t.active);
  const pastTenants = tenants.filter((t) => !t.active);
  const depositsHeld = currentTenants.reduce((sum, t) => sum + t.deposit, 0);
  const recentEntries = transactions.slice(0, 12);

  return (
    <AppShell
      title={property.name}
      tagline={[property.address, companyName].filter(Boolean).join(" · ") || "Units, tenants and bills"}
      back={{ href: "/dashboard", label: "All properties" }}
      actions={
        <button type="button" className={`${styles.btn} ${styles.accent}`} onClick={() => openTenant()}>
          + Add a tenant
        </button>
      }
    >

      {error && <div className={styles.errorBar}>{error}</div>}

      {units.length === 0 && property.monthlyRent > 0 && (
        <div className={styles.rentTrailRow}>
          <span>Monthly rent</span>
          <span className="num">{money(property.monthlyRent)}</span>
          <RentTrail unitId={null} />
        </div>
      )}

      <section className={styles.kpis} aria-label="This property">
        <div className={`${styles.kpi} ${styles.rentKpi}`}>
          <div className={styles.kpiLabel}>Rent, last 12 months</div>
          <div className={`${styles.kpiValue} num`}>{money(lastTwelve.rent)}</div>
          <div className={styles.kpiFoot}>
            <span className={styles.delta}>
              <span className={styles.deltaNote}>{money(lifetime.rent)} all time</span>
            </span>
          </div>
        </div>
        <div className={`${styles.kpi} ${styles.expenseKpi}`}>
          <div className={styles.kpiLabel}>Spent, last 12 months</div>
          <div className={`${styles.kpiValue} num`}>{money(lastTwelve.expense)}</div>
          <div className={styles.kpiFoot}>
            <span className={styles.delta}>
              <span className={styles.deltaNote}>{money(lifetime.expense)} all time</span>
            </span>
          </div>
        </div>
        <div className={`${styles.kpi} ${styles.netKpi}`}>
          <div className={styles.kpiLabel}>Net, last 12 months</div>
          <div className={`${styles.kpiValue} num ${lastTwelve.net >= 0 ? styles.pos : styles.neg}`}>
            {lastTwelve.net < 0 ? "\u2212" : ""}
            {money(Math.abs(lastTwelve.net))}
          </div>
          <div className={styles.kpiFoot}>
            <span className={styles.delta}>
              <span className={styles.deltaNote}>
                {lifetime.net < 0 ? "\u2212" : ""}
                {money(Math.abs(lifetime.net))} all time
              </span>
            </span>
          </div>
        </div>
      </section>

      {transactions.length > 0 && (
        <section className={styles.card} style={{ marginTop: 12 }} aria-label="Cash flow">
          <CashFlowChart data={series} />
        </section>
      )}

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Tenants</h2>
          <span className={styles.count}>
            {depositsHeld > 0 ? `${money(depositsHeld)} in deposits held` : ""}
          </span>
        </div>
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          Who&apos;s renting, how to reach them, and when their lease runs out. The due day here is what makes
          unpaid rent show as late on the dashboard.
        </p>

        {tenants.length === 0 ? (
          <div className={styles.ledgerWrap}>
            <div className={styles.emptyState}>
              No tenants on file yet — add one and unpaid rent starts telling you who to call.
            </div>
          </div>
        ) : (
          <div className={styles.tenantGrid}>
            {[...currentTenants, ...pastTenants].map((t) => {
              const status = leaseStatus(t, now);
              const tone =
                status.kind === "past"
                  ? styles.vacant
                  : status.kind === "ok"
                    ? styles.paid
                    : status.kind === "ending"
                      ? styles.owed
                      : styles.bill;
              return (
                <div key={t.id} className={`${styles.tenantCard} ${t.active ? "" : styles.pastTenant}`}>
                  <div className={styles.tenantHead}>
                    <div className={styles.tenantName}>
                      <span className={styles.name}>{t.name}</span>
                      <span className={`${styles.pill} ${tone}`}>{status.label}</span>
                    </div>
                    <div className={styles.addr}>
                      {t.unitId ? unitLabel(t.unitId) : "Whole property"} · rent due on the{" "}
                      {ordinal(t.dueDay)}
                    </div>
                  </div>

                  {(t.phone || t.email) && (
                    <div className={styles.contactRow}>
                      {t.phone && (
                        <>
                          <a className={styles.contactBtn} href={telHref(t.phone)}>
                            Call
                          </a>
                          <a className={styles.contactBtn} href={smsHref(t.phone)}>
                            Text
                          </a>
                        </>
                      )}
                      {t.email && (
                        <a className={styles.contactBtn} href={`mailto:${t.email}`}>
                          Email
                        </a>
                      )}
                    </div>
                  )}

                  <div className={styles.tenantFacts}>
                    <div className={styles.figure}>
                      <span className={styles.figureLabel}>Lease</span>
                      <span className={styles.figureValue}>{leaseRange(t.leaseStart, t.leaseEnd)}</span>
                    </div>
                    <div className={styles.figure}>
                      <span className={styles.figureLabel}>Deposit</span>
                      <span className={styles.figureValue}>{money(t.deposit)}</span>
                    </div>
                  </div>

                  {t.note && <div className={styles.note}>{t.note}</div>}

                  <div className={styles.propActions}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                      onClick={() => openTenant(t)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                      onClick={() => setTenantActive(t, !t.active)}
                    >
                      {t.active ? "Moved out" : "Moved back in"}
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`}
                      onClick={() => removeTenant(t)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => openTenant()}>
            + Add a tenant
          </button>
        </div>
      </section>

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
                      {money(u.monthlyRent)}
                      <RentTrail unitId={u.id} />
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
                        onClick={() => removeUnit(u)}
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
                  <td className={`${styles.amt} num ${styles.neg}`}>{money(r.amount)}</td>
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
                      onClick={() => removeRecurring(r)}
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
      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Recent activity</h2>
          <span className={styles.count}>
            {transactions.length
              ? `${transactions.length} ${transactions.length === 1 ? "entry" : "entries"} all time`
              : ""}
          </span>
        </div>
        {recentEntries.length === 0 ? (
          <div className={styles.ledgerWrap}>
            <div className={styles.emptyState}>
              Nothing recorded against this property yet.
            </div>
          </div>
        ) : (
          <div className={styles.ledgerWrap}>
            <table className={`${styles.ledger} ${styles.txnTable}`}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Applies to</th>
                  <th>Type</th>
                  <th>Details</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentEntries.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDay(t.date)}</td>
                    <td>{unitLabel(t.unitId)}</td>
                    <td>
                      <span className={`${styles.tag} ${t.type === "rent" ? styles.rent : styles.expense}`}>
                        {t.type === "rent" ? "Rent" : "Expense"}
                      </span>
                    </td>
                    <td>
                      {t.category && <div className={styles.categoryTag}>{t.category}</div>}
                      {t.detail}
                      {t.note && <div className={styles.note}>{t.note}</div>}
                      {t.proofCount > 0 && (
                        <div className={styles.note}>
                          {t.proofCount} {t.proofCount === 1 ? "proof" : "proofs"} attached
                        </div>
                      )}
                    </td>
                    <td className={`${styles.amt} num ${t.type === "rent" ? styles.pos : styles.neg}`}>
                      {t.type === "rent" ? "+" : "\u2212"}
                      {money(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {transactions.length > recentEntries.length && (
          <p className={styles.helpText}>
            Showing the {recentEntries.length} most recent. The full ledger, with filters and proof uploads,
            is on the dashboard.
          </p>
        )}
      </section>

      <Modal
        open={tenantOpen}
        title={tenantForm.id ? "Edit tenant" : "Add a tenant"}
        subtitle="Contact details and lease terms. Everything except the name is optional."
        onClose={() => setTenantOpen(false)}
      >
        <form onSubmit={saveTenant}>
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="t-name">Name</label>
              <input
                id="t-name"
                type="text"
                required
                placeholder="e.g. J. Alvarez"
                value={tenantForm.name}
                onChange={(e) => setTenantForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            {units.length > 0 && (
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="t-unit">Unit</label>
                <select
                  id="t-unit"
                  value={tenantForm.unitId}
                  onChange={(e) => setTenantForm((f) => ({ ...f, unitId: e.target.value }))}
                >
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
              <label htmlFor="t-phone">Phone</label>
              <input
                id="t-phone"
                type="tel"
                inputMode="tel"
                placeholder="(555) 010-4477"
                value={tenantForm.phone}
                onChange={(e) => setTenantForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="t-email">Email</label>
              <input
                id="t-email"
                type="email"
                placeholder="name@example.com"
                value={tenantForm.email}
                onChange={(e) => setTenantForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="t-start">Lease starts</label>
              <input
                id="t-start"
                type="date"
                value={tenantForm.leaseStart}
                onChange={(e) => setTenantForm((f) => ({ ...f, leaseStart: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="t-end">Lease ends</label>
              <input
                id="t-end"
                type="date"
                value={tenantForm.leaseEnd}
                onChange={(e) => setTenantForm((f) => ({ ...f, leaseEnd: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="t-deposit">Security deposit ($)</label>
              <input
                id="t-deposit"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={tenantForm.deposit}
                onChange={(e) => setTenantForm((f) => ({ ...f, deposit: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="t-due">Rent due on day</label>
              <input
                id="t-due"
                type="number"
                min="1"
                max="31"
                value={tenantForm.dueDay}
                onChange={(e) => setTenantForm((f) => ({ ...f, dueDay: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="t-note">Note (optional)</label>
              <input
                id="t-note"
                type="text"
                placeholder="e.g. Pays by Zelle, has a dog"
                value={tenantForm.note}
                onChange={(e) => setTenantForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>
          {error && <div className={styles.errorBar}>{error}</div>}
          <div className={styles.formFoot}>
            <button type="button" className={styles.btn} onClick={() => setTenantOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.accent}`} disabled={tenantSaving}>
              {tenantSaving ? "Saving\u2026" : tenantForm.id ? "Save tenant" : "Add tenant"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}

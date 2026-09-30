"use client";

import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type SyntheticEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import Modal from "../../components/Modal";
import { Toasts, useToasts } from "../../components/Toasts";
import StatusBadge from "../../components/ui/StatusBadge";
import EmptyState from "../../components/ui/EmptyState";
import OverflowMenu, { type MenuItem } from "../../components/ui/OverflowMenu";
import SegmentedControl from "../../components/ui/SegmentedControl";
import { SortHeader, TableWrap, tableStyles as t, useSort } from "../../components/ui/Table";
import { IconBuilding, IconCards, IconPencil, IconPlus, IconSearch, IconTable, IconTrash, IconUser } from "../../components/icons";
import { money, signedMoney } from "@/lib/money";
import { owedTone, toneClass } from "@/lib/money-tone";
import { formatDay } from "@/lib/lease";
import { STATUS_RANK, type PropertyStatus } from "@/lib/property-status";
import dash from "../dashboard.module.css";
import styles from "./properties.module.css";

export type PropertyRow = {
  id: string;
  name: string;
  address: string;
  companyId: string;
  company: string;
  tenants: string[];
  units: number;
  /** This month's rent across every unit (after rent changes). */
  rent: number;
  status: PropertyStatus;
  /** Sum of the tenants' statement balances; positive is owed. */
  balance: number;
  /** YYYY-MM-DD of the latest rent entry, or "". */
  lastPaid: string;
  /** Ledger entries, for the remove confirmation. */
  entries: number;
  canRemove: boolean;
  monthlyRent: number;
  vacant: boolean;
};

type Company = { id: string; name: string };
type View = "table" | "cards";
const VIEW_KEY = "rentroll.properties.view";

const COLUMNS = {
  name: (r: PropertyRow) => r.name,
  tenants: (r: PropertyRow) => r.tenants.join(", ") || null,
  company: (r: PropertyRow) => r.company,
  rent: (r: PropertyRow) => r.rent,
  status: (r: PropertyRow) => STATUS_RANK[r.status],
  balance: (r: PropertyRow) => r.balance,
  lastPaid: (r: PropertyRow) => r.lastPaid || null,
};

/**
 * The owner's five badges, plus "Due" — the dashboard's "Rent owed": owed,
 * nothing in yet, not past the due day — as a neutral badge.
 */
function Status({ status }: { status: PropertyStatus }) {
  switch (status) {
    case "paid":
    case "partial":
    case "late":
    case "vacant":
    case "ended":
      return <StatusBadge status={status} />;
    case "due":
      return <StatusBadge status="neutral">Due</StatusBadge>;
    default:
      return <span className={t.muted}>—</span>;
  }
}

function Balance({ value }: { value: number }) {
  return <span className={toneClass(styles, owedTone(value))}>{signedMoney(value)}</span>;
}

const CHIPS: { value: PropertyStatus; label: string }[] = [
  { value: "late", label: "Late" },
  { value: "partial", label: "Partial" },
  { value: "due", label: "Due" },
  { value: "paid", label: "Paid" },
  { value: "ended", label: "Lease ended" },
  { value: "vacant", label: "Vacant" },
];

/** The property's tile: its initials, or the house number ("12 Oak St" → "12"). */
function Tile({ name }: { name: string }) {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? "";
  const text = /^\d/.test(first) ? first.slice(0, 3) : (first[0] ?? "") + (words[1]?.[0] ?? "");
  return (
    <span className={styles.tile} aria-hidden="true">
      {text.toUpperCase() || "?"}
    </span>
  );
}

/** Keeps a click or key inside the menu (and its confirm dialog) from opening the row. */
const stop = (e: SyntheticEvent) => e.stopPropagation();

export default function PropertiesClient({
  rows: data,
  companies,
  openRepairs,
  userLabel,
}: {
  rows: PropertyRow[];
  companies: Company[];
  openRepairs: number;
  userLabel: string;
}) {
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();
  const showCompany = companies.length > 1;

  // Table on a desktop, cards on a phone, unless they picked one before.
  const [view, setView] = useState<View>("table");
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(VIEW_KEY);
    } catch {}
    if (saved === "table" || saved === "cards") setView(saved);
    else if (window.matchMedia("(max-width: 720px)").matches) setView("cards");
  }, []);
  function chooseView(v: View) {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  const [query, setQuery] = useState("");
  const [llc, setLlc] = useState("all");
  const [statusFilter, setStatusFilter] = useState<PropertyStatus | "all">("all");
  // Search and LLC narrow the set; the chips count within it, then filter.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.filter(
      (r) =>
        (llc === "all" || r.companyId === llc) &&
        (!q || [r.name, r.address, r.company, ...r.tenants].some((s) => s.toLowerCase().includes(q)))
    );
  }, [data, query, llc]);
  const chips = useMemo(
    () =>
      CHIPS.map((c) => ({ ...c, count: searched.filter((r) => r.status === c.value).length })).filter(
        (c) => c.count > 0 || c.value === statusFilter
      ),
    [searched, statusFilter]
  );
  const filtered = useMemo(
    () => (statusFilter === "all" ? searched : searched.filter((r) => r.status === statusFilter)),
    [searched, statusFilter]
  );
  const { rows, sort, toggle } = useSort(filtered, COLUMNS, { key: "name", dir: "asc" });

  const open = (r: PropertyRow) => router.push(`/dashboard/properties/${r.id}`);

  // ----- Add (same fields and call as the dashboard's add card) -----
  const [adding, setAdding] = useState(false);
  const [propName, setPropName] = useState("");
  const [propAddress, setPropAddress] = useState("");
  const [propRent, setPropRent] = useState("");
  const [propCompany, setPropCompany] = useState("");
  const [addError, setAddError] = useState("");

  function openAdd() {
    setPropCompany(llc !== "all" ? llc : companies[0]?.id ?? "");
    setAddError("");
    setAdding(true);
  }

  async function addProperty(e: FormEvent) {
    e.preventDefault();
    const name = propName.trim();
    if (!name || !propCompany) return;
    setAddError("");
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
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAddError(body?.error || "Couldn't add that property.");
      return;
    }
    setPropName("");
    setPropAddress("");
    setPropRent("");
    setAdding(false);
    push(`${body.name} added.`);
    router.refresh();
  }

  // ----- Edit (same fields and call as the dashboard card's Edit) -----
  const [editing, setEditing] = useState<PropertyRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editRent, setEditRent] = useState("");
  const [editVacant, setEditVacant] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  function startEdit(r: PropertyRow) {
    setEditing(r);
    setEditName(r.name);
    setEditAddress(r.address);
    setEditRent(r.monthlyRent ? String(r.monthlyRent) : "");
    setEditVacant(r.vacant);
    setEditError("");
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const name = editName.trim();
    if (!name) return;
    setEditError("");
    setEditSaving(true);
    const res = await fetch(`/api/properties/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: editAddress.trim(),
        monthlyRent: parseFloat(editRent) || 0,
        vacant: editVacant,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setEditSaving(false);
    if (!res.ok) {
      setEditError(body?.error || "Couldn't save those changes.");
      return;
    }
    setEditing(null);
    push("Changes saved.");
    router.refresh();
  }

  // ----- Remove (same call and wording as the dashboard) -----
  async function remove(r: PropertyRow) {
    const res = await fetch(`/api/properties/${r.id}`, { method: "DELETE" });
    if (!res.ok) {
      push("Couldn't remove that property.", "bad");
      return;
    }
    push(`${r.name} removed.`);
    router.refresh();
  }

  function menuFor(r: PropertyRow): MenuItem[] {
    const items: MenuItem[] = [{ label: "Edit", icon: IconPencil, onSelect: () => startEdit(r) }];
    // Only an LLC owner can remove a house and the ledger under it.
    if (r.canRemove) {
      const count = r.entries;
      items.push({
        label: "Remove",
        icon: IconTrash,
        destructive: true,
        onSelect: () => void remove(r),
        confirm: {
          title: `Remove ${r.name}?`,
          body: count
            ? `This property has ${count} ledger ${count === 1 ? "entry" : "entries"}. Removing it deletes those entries, its units and its recurring expenses too. This can't be undone.`
            : "Its units and recurring expenses go with it. This can't be undone.",
          confirmLabel: "Remove property",
          danger: true,
        },
      });
    }
    return items;
  }

  const menu = (r: PropertyRow) => (
    <div className={styles.menuCell} onClick={stop} onKeyDown={stop}>
      <OverflowMenu items={menuFor(r)} label={`Actions for ${r.name}`} />
    </div>
  );

  const addButton = (
    <button type="button" className={`${dash.btn} ${dash.primary}`} onClick={openAdd}>
      <IconPlus size={16} />
      Add property
    </button>
  );

  return (
    <AppShell title="Properties" userLabel={userLabel} openRepairs={openRepairs} actions={data.length ? addButton : undefined}>
      {data.length === 0 ? (
        <EmptyState icon={IconBuilding} title="No properties yet" action={addButton} />
      ) : (
        <>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <IconSearch size={16} />
              <input
                type="search"
                placeholder="Search properties, tenants"
                aria-label="Search properties"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {showCompany && (
              <select className={styles.select} aria-label="LLC" value={llc} onChange={(e) => setLlc(e.target.value)}>
                <option value="all">All LLCs</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <span className={styles.count}>
              {filtered.length === data.length ? data.length : `${filtered.length} of ${data.length}`}{" "}
              {data.length === 1 ? "property" : "properties"}
            </span>
            <SegmentedControl
              label="View"
              value={view}
              onChange={chooseView}
              options={[
                { value: "table", label: "Table", icon: IconTable, hideLabel: true },
                { value: "cards", label: "Cards", icon: IconCards, hideLabel: true },
              ]}
            />
          </div>

          <div className={styles.chips} role="group" aria-label="Filter by this month's status">
            <button
              type="button"
              className={`${styles.chip} ${statusFilter === "all" ? styles.chipOn : ""}`}
              aria-pressed={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
            >
              All <span className={styles.chipCount}>{searched.length}</span>
            </button>
            {chips.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`${styles.chip} ${statusFilter === c.value ? styles.chipOn : ""}`}
                aria-pressed={statusFilter === c.value}
                onClick={() => setStatusFilter(statusFilter === c.value ? "all" : c.value)}
              >
                <span className={`${styles.chipDot} ${styles[`dot_${c.value}`] ?? ""}`} aria-hidden="true" />
                {c.label} <span className={styles.chipCount}>{c.count}</span>
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={IconSearch} title="No properties match" compact />
          ) : view === "table" ? (
            <TableWrap>
              <table className={`${t.table} ${styles.table}`}>
                <thead>
                  <tr>
                    <SortHeader label="Property" col="name" sort={sort} onSort={toggle} />
                    <SortHeader label="Tenants" col="tenants" sort={sort} onSort={toggle} />
                    {showCompany && <SortHeader label="LLC" col="company" sort={sort} onSort={toggle} />}
                    <SortHeader label="Rent" col="rent" sort={sort} onSort={toggle} numeric />
                    <SortHeader label="This month" col="status" sort={sort} onSort={toggle} firstDir="asc" />
                    <SortHeader label="Balance" col="balance" sort={sort} onSort={toggle} numeric />
                    <SortHeader label="Last paid" col="lastPaid" sort={sort} onSort={toggle} numeric />
                    <th aria-label="Actions" className={styles.menuHead} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={styles.row}
                      tabIndex={0}
                      aria-label={`Open ${r.name}`}
                      onClick={() => open(r)}
                      onKeyDown={(e: KeyboardEvent) => {
                        if (e.key === "Enter" && e.target === e.currentTarget) open(r);
                      }}
                    >
                      <td data-label="Property">
                        <div className={styles.propCell}>
                          <Tile name={r.name} />
                          <div className={styles.propText}>
                            <Link
                              href={`/dashboard/properties/${r.id}`}
                              className={t.rowLink}
                              tabIndex={-1}
                              onClick={stop}
                            >
                              {r.name}
                            </Link>
                            {r.address && <span className={t.sub}>{r.address}</span>}
                          </div>
                        </div>
                      </td>
                      <td data-label="Tenants" className={r.tenants.length ? styles.tenants : t.muted}>
                        {r.tenants.length ? r.tenants.join(", ") : "—"}
                      </td>
                      {showCompany && (
                        <td data-label="LLC" className={t.muted}>
                          {r.company}
                        </td>
                      )}
                      <td data-label="Rent" className={t.num}>
                        {money(r.rent)}
                      </td>
                      <td data-label="This month">
                        <Status status={r.status} />
                      </td>
                      <td data-label="Balance" className={t.num}>
                        <Balance value={r.balance} />
                      </td>
                      <td data-label="Last paid" className={`${t.num} ${r.lastPaid ? "" : t.muted}`}>
                        {r.lastPaid ? formatDay(r.lastPaid) : "—"}
                      </td>
                      <td className={styles.menuTd} data-label="">
                        {menu(r)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <ul className={styles.cards}>
              {rows.map((r) => (
                <li key={r.id} className={styles.card}>
                  <div className={styles.cardHead}>
                    <Tile name={r.name} />
                    <div className={styles.cardTitle}>
                      <Link href={`/dashboard/properties/${r.id}`} className={styles.cardLink}>
                        {r.name}
                      </Link>
                      {r.address && <span className={styles.cardSub}>{r.address}</span>}
                    </div>
                    {menu(r)}
                  </div>
                  <div className={styles.cardTenant}>
                    <IconUser size={16} />
                    <span className={r.tenants.length ? "" : styles.mutedText}>
                      {r.tenants.length ? r.tenants.join(", ") : "No tenant"}
                    </span>
                    {showCompany && <span className={styles.cardLlc}>{r.company}</span>}
                  </div>
                  <dl className={styles.cardFacts}>
                    <div>
                      <dt>Rent</dt>
                      <dd>{money(r.rent)}</dd>
                    </div>
                    <div>
                      <dt>Balance</dt>
                      <dd>
                        <Balance value={r.balance} />
                      </dd>
                    </div>
                    <div className={styles.cardStatus}>
                      <dt>This month</dt>
                      <dd>
                        <Status status={r.status} />
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Modal open={adding} title="Add a property" onClose={() => setAdding(false)} narrow>
        <form onSubmit={addProperty} className={styles.form}>
          <div className={dash.field}>
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
          <div className={dash.field}>
            <label htmlFor="new-prop-address">Address</label>
            <input
              id="new-prop-address"
              type="text"
              placeholder="142 Birchwood Ave"
              value={propAddress}
              onChange={(e) => setPropAddress(e.target.value)}
            />
          </div>
          <div className={dash.field}>
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
          <div className={dash.field}>
            <label htmlFor="new-prop-company">Owned by</label>
            <select id="new-prop-company" required value={propCompany} onChange={(e) => setPropCompany(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {addError && (
            <p className={styles.error} role="alert">
              {addError}
            </p>
          )}
          <div className={dash.formFoot}>
            <button type="button" className={dash.btn} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className={`${dash.btn} ${dash.primary}`}>
              Add property
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(editing)} title={editing ? `Edit ${editing.name}` : "Edit property"} onClose={() => setEditing(null)} narrow>
        <form onSubmit={saveEdit} className={styles.form}>
          <div className={dash.field}>
            <label htmlFor="edit-prop-name">Property name</label>
            <input id="edit-prop-name" type="text" autoFocus required value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div className={dash.field}>
            <label htmlFor="edit-prop-address">Address</label>
            <input id="edit-prop-address" type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
          </div>
          <div className={dash.field}>
            <label htmlFor="edit-prop-rent">Monthly rent ($)</label>
            <input
              id="edit-prop-rent"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={editRent}
              onChange={(e) => setEditRent(e.target.value)}
            />
          </div>
          <label className={dash.checkboxField}>
            <input type="checkbox" checked={editVacant} onChange={(e) => setEditVacant(e.target.checked)} />
            Vacant
          </label>
          {editError && (
            <p className={styles.error} role="alert">
              {editError}
            </p>
          )}
          <div className={dash.formFoot}>
            <button type="button" className={dash.btn} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" className={`${dash.btn} ${dash.primary}`} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}

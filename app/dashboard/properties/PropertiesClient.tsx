"use client";

import Link from "next/link";
import AppShell from "../../components/AppShell";
import StatusBadge from "../../components/ui/StatusBadge";
import EmptyState from "../../components/ui/EmptyState";
import { SortHeader, TableWrap, tableStyles as t, useSort } from "../../components/ui/Table";
import { IconBuilding } from "../../components/icons";
import { money } from "@/lib/money";
import { monthName } from "@/lib/notices";
import dash from "../dashboard.module.css";

export type PropertyRow = {
  id: string;
  name: string;
  address: string;
  company: string;
  units: number;
  occupied: number;
  expected: number;
  collected: number;
  status: "paid" | "partial" | "unpaid" | "due" | "vacant" | "none";
};

const STATUS_ORDER: Record<PropertyRow["status"], number> = { unpaid: 0, partial: 1, due: 2, paid: 3, vacant: 4, none: 5 };

const COLUMNS = {
  name: (r: PropertyRow) => r.name,
  company: (r: PropertyRow) => r.company,
  units: (r: PropertyRow) => r.units,
  expected: (r: PropertyRow) => r.expected,
  collected: (r: PropertyRow) => r.collected,
  status: (r: PropertyRow) => STATUS_ORDER[r.status],
};

function Status({ row }: { row: PropertyRow }) {
  switch (row.status) {
    case "paid":
      return <StatusBadge status="paid" />;
    case "partial":
      return <StatusBadge status="partial" />;
    case "unpaid":
      return <StatusBadge status="late">Unpaid</StatusBadge>;
    case "due":
      return <StatusBadge status="neutral">Due</StatusBadge>;
    case "vacant":
      return <StatusBadge status="vacant" />;
    default:
      return <span className={t.muted}>—</span>;
  }
}

export default function PropertiesClient({
  rows: data,
  month,
  showCompany,
  openRepairs,
  userLabel,
}: {
  rows: PropertyRow[];
  month: string;
  showCompany: boolean;
  openRepairs: number;
  userLabel: string;
}) {
  const { rows, sort, toggle } = useSort(data, COLUMNS, { key: "name", dir: "asc" });
  const monthLabel = monthName(month);

  return (
    <AppShell title="Properties" userLabel={userLabel} openRepairs={openRepairs}>
      {data.length === 0 ? (
        <EmptyState
          icon={IconBuilding}
          title="No properties yet"
          action={
            <Link href="/dashboard" className={`${dash.btn} ${dash.primary}`}>
              Add a property on Overview
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <table className={t.table}>
            <thead>
              <tr>
                <SortHeader label="Property" col="name" sort={sort} onSort={toggle} />
                {showCompany && <SortHeader label="LLC" col="company" sort={sort} onSort={toggle} />}
                <SortHeader label="Units" col="units" sort={sort} onSort={toggle} numeric />
                <SortHeader label="Rent / month" col="expected" sort={sort} onSort={toggle} numeric />
                <SortHeader label={`Collected (${monthLabel})`} col="collected" sort={sort} onSort={toggle} numeric />
                <SortHeader label="Status" col="status" sort={sort} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Property">
                    <Link href={`/dashboard/properties/${r.id}`} className={t.rowLink}>
                      {r.name}
                      {r.address && <span className={t.sub}>{r.address}</span>}
                    </Link>
                  </td>
                  {showCompany && (
                    <td data-label="LLC" className={t.muted}>
                      {r.company}
                    </td>
                  )}
                  <td data-label="Units" className={t.num}>
                    {r.units > 1 ? `${r.occupied} of ${r.units} let` : r.occupied ? "Let" : "Empty"}
                  </td>
                  <td data-label="Rent / month" className={t.num}>
                    {money(r.expected)}
                  </td>
                  <td data-label={`Collected (${monthLabel})`} className={`${t.num} ${r.collected ? "" : t.muted}`}>
                    {money(r.collected)}
                  </td>
                  <td data-label="Status">
                    <Status row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </AppShell>
  );
}

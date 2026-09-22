/**
 * What is due to you on each day of a month.
 *
 * Uses the same model as the overview, so the two never disagree: rent is
 * owed per target — a property with no units, or each unit of one that has
 * them — at what it rented for in that month, on its tenant's due day (the
 * 1st if nobody is on file). Standing "every month" charges from lib/
 * charge-rules ride along on the same day, itemised.
 *
 * Pure: no database and no clock of its own, so "today" is always handed in.
 */

import { monthlyChargesFor, type ChargeRule } from "./charge-rules.ts";

export type CalTarget = {
  key: string;
  propertyId: string;
  unitId: string | null;
  label: string;
  companyId: string;
  vacant: boolean;
};

export type CalTenant = {
  id: string;
  name: string;
  propertyId: string;
  unitId: string | null;
  dueDay: number;
  phone: string;
};

export type CalPayment = {
  propertyId: string;
  unitId: string | null;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
};

export type DueStatus = "paid" | "partial" | "due" | "late";

export type DueItem = {
  key: string;
  propertyId: string;
  label: string;
  tenantId: string;
  tenantName: string;
  phone: string;
  /** YYYY-MM-DD */
  dueDate: string;
  rent: number;
  extras: { label: string; amount: number }[];
  /** Rent plus extras. */
  expected: number;
  /** Rent received for this target this month, whatever day it came in. */
  paid: number;
  status: DueStatus;
  /** Whole days past the due date; 0 when not late. */
  daysLate: number;
};

export type CalDay = {
  date: string;
  day: number;
  /** 0 = Sunday. */
  weekday: number;
  expected: number;
  /** Rent that actually arrived on this date. */
  received: number;
  items: DueItem[];
};

export type CalMonth = {
  month: string;
  days: CalDay[];
  expected: number;
  /** Money in this month, capped per target at what it owed. */
  collected: number;
  /** Everything received this month, uncapped — what the bank sees. */
  received: number;
  outstanding: number;
  /** Of the outstanding, how much is already past its due date. */
  overdue: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Due day clamped into the month: the 31st in February is the 28th. */
export function dueDayIn(month: string, dueDay: number): number {
  return Math.min(Math.max(1, Math.round(dueDay) || 1), daysInMonth(month));
}

const pad = (n: number) => String(n).padStart(2, "0");

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function buildMonth(opts: {
  month: string;
  targets: CalTarget[];
  tenants: CalTenant[];
  /** Expected rent for a target in this month (from the rent history). */
  rentFor: (target: CalTarget) => number;
  rules?: (ChargeRule & { tenantId: string })[];
  payments: CalPayment[];
  /** YYYY-MM-DD in the viewer's own timezone. */
  today: string;
}): CalMonth {
  const { month, targets, tenants, rentFor, rules = [], payments, today } = opts;
  const [y, m] = month.split("-").map(Number);
  const count = daysInMonth(month);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();

  const days: CalDay[] = Array.from({ length: count }, (_, i) => ({
    date: `${month}-${pad(i + 1)}`,
    day: i + 1,
    weekday: (firstWeekday + i) % 7,
    expected: 0,
    received: 0,
    items: [],
  }));

  const same = (a: { propertyId: string; unitId: string | null }, b: { propertyId: string; unitId: string | null }) =>
    a.propertyId === b.propertyId && (a.unitId ?? null) === (b.unitId ?? null);

  const inMonth = payments.filter((p) => p.date.startsWith(month));
  for (const p of inMonth) {
    const d = Number(p.date.slice(8, 10));
    if (d >= 1 && d <= count && targets.some((t) => same(t, p))) {
      days[d - 1].received = cents(days[d - 1].received + Math.max(0, p.amount));
    }
  }

  let expected = 0;
  let collected = 0;
  let overdue = 0;

  for (const t of targets) {
    if (t.vacant) continue;
    const rent = Math.max(0, rentFor(t) || 0);
    if (!(rent > 0)) continue;

    const tenant = tenants.find((x) => same(x, t)) ?? null;
    const extras = tenant
      ? monthlyChargesFor({
          rules: rules.filter((r) => r.tenantId === tenant.id),
          month,
          rentThisMonth: rent,
        }).map((c) => ({ label: c.label, amount: c.amount }))
      : [];
    const due = cents(rent + extras.reduce((s, e) => s + e.amount, 0));
    const paid = cents(inMonth.filter((p) => same(t, p)).reduce((s, p) => s + Math.max(0, p.amount), 0));

    const day = dueDayIn(month, tenant?.dueDay ?? 1);
    const dueDate = `${month}-${pad(day)}`;
    const past = dayDiff(dueDate, today);
    const status: DueStatus =
      paid >= due - 0.005 ? "paid" : past > 0 ? "late" : paid > 0.005 ? "partial" : "due";

    const item: DueItem = {
      key: t.key,
      propertyId: t.propertyId,
      label: t.label,
      tenantId: tenant?.id ?? "",
      tenantName: tenant?.name ?? "",
      phone: tenant?.phone ?? "",
      dueDate,
      rent: cents(rent),
      extras,
      expected: due,
      paid,
      status,
      daysLate: status === "late" ? past : 0,
    };
    days[day - 1].items.push(item);
    days[day - 1].expected = cents(days[day - 1].expected + due);

    expected = cents(expected + due);
    collected = cents(collected + Math.min(paid, due));
    if (status === "late") overdue = cents(overdue + (due - paid));
  }

  // Most urgent first within a day, then by name.
  for (const d of days) {
    const rank = { late: 0, partial: 1, due: 2, paid: 3 } as const;
    d.items.sort((a, b) => rank[a.status] - rank[b.status] || a.label.localeCompare(b.label));
  }

  return {
    month,
    days,
    expected,
    collected,
    received: cents(inMonth.filter((p) => targets.some((t) => same(t, p))).reduce((s, p) => s + Math.max(0, p.amount), 0)),
    outstanding: cents(expected - collected),
    overdue,
  };
}

/** "$12.4k" for a cramped calendar cell; full figures everywhere else. */
export function compactMoney(n: number): string {
  const a = Math.abs(n);
  if (a >= 10_000) return `$${(n / 1000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  if (a >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(n)}`;
}

/** "2026-09" ± n months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

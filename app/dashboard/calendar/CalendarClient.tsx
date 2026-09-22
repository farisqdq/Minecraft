"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import { Toasts, useToasts } from "../../components/Toasts";
import styles from "../dashboard.module.css";
import { money } from "@/lib/money";
import { isoDay, smsHref, telHref } from "@/lib/lease";
import { rentForMonth, type RentChangeDTO } from "@/lib/rent";
import { monthName } from "@/lib/notices";
import type { ChargeRule } from "@/lib/charge-rules";
import {
  buildMonth,
  compactMoney,
  shiftMonth,
  type CalPayment,
  type CalTarget,
  type CalTenant,
  type DueItem,
  type DueStatus,
} from "@/lib/calendar";

type Property = { id: string; name: string; companyId: string; monthlyRent: number; vacant: boolean };
type Unit = { id: string; propertyId: string; name: string; monthlyRent: number; vacant: boolean };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_WORDS: Record<DueStatus, string> = {
  paid: "Paid",
  partial: "Part paid",
  due: "Due",
  late: "Late",
};

const STATUS_PILL: Record<DueStatus, string> = {
  paid: "paid",
  partial: "owed",
  due: "vacant",
  late: "bill",
};

export default function CalendarClient({
  openRepairs,
  serverToday,
  companies,
  properties,
  units,
  rentChanges,
  tenants,
  payments: initialPayments,
  rules,
}: {
  openRepairs: number;
  serverToday: string;
  companies: { id: string; name: string }[];
  properties: Property[];
  units: Unit[];
  rentChanges: RentChangeDTO[];
  tenants: CalTenant[];
  payments: CalPayment[];
  rules: (ChargeRule & { tenantId: string })[];
}) {
  const { toasts, push, dismiss } = useToasts();

  // Same reconciliation as the overview: start on the server's date so the
  // first render matches, then move to the browser's own. Late and due are
  // judged by the viewer's calendar, not a data centre's.
  const [today, setToday] = useState(serverToday);
  useEffect(() => {
    const local = isoDay(new Date());
    if (local !== serverToday) setToday(local);
  }, [serverToday]);

  const [month, setMonth] = useState(serverToday.slice(0, 7));
  const [selected, setSelected] = useState(serverToday);
  const [company, setCompany] = useState("all");
  const [payments, setPayments] = useState(initialPayments);
  const [marking, setMarking] = useState("");

  // If the browser's date turned out to be a different month from the
  // server's, follow it — but only until someone has navigated themselves.
  const [navigated, setNavigated] = useState(false);
  useEffect(() => {
    if (!navigated) {
      setMonth(today.slice(0, 7));
      setSelected(today);
    }
  }, [today, navigated]);

  const targets = useMemo<CalTarget[]>(() => {
    return properties
      .filter((p) => company === "all" || p.companyId === company)
      .flatMap((p): CalTarget[] => {
        const own = units.filter((u) => u.propertyId === p.id);
        if (own.length === 0) {
          return [{ key: p.id, propertyId: p.id, unitId: null, label: p.name, companyId: p.companyId, vacant: p.vacant }];
        }
        return own.map((u) => ({
          key: `${p.id}:${u.id}`,
          propertyId: p.id,
          unitId: u.id,
          label: `${p.name} — ${u.name}`,
          companyId: p.companyId,
          vacant: u.vacant,
        }));
      });
  }, [properties, units, company]);

  const cal = useMemo(() => {
    const currentRent = (t: CalTarget) =>
      t.unitId
        ? (units.find((u) => u.id === t.unitId)?.monthlyRent ?? 0)
        : (properties.find((p) => p.id === t.propertyId)?.monthlyRent ?? 0);
    return buildMonth({
      month,
      targets,
      tenants,
      rentFor: (t) => rentForMonth(rentChanges, t.propertyId, t.unitId, month, currentRent(t)),
      rules,
      payments,
      today,
    });
  }, [month, targets, tenants, rentChanges, rules, payments, today, units, properties]);

  const selectedDay = cal.days.find((d) => d.date === selected) ?? null;
  const agenda = cal.days.filter((d) => d.items.length > 0);
  const leading = cal.days[0]?.weekday ?? 0;

  function go(n: number) {
    const next = shiftMonth(month, n);
    setNavigated(true);
    setMonth(next);
    // Land on today when the month contains it, otherwise its first due day.
    const firstDue = buildMonth({
      month: next, targets, tenants, rentFor: () => 1, payments: [], today,
    }).days.find((d) => d.items.length > 0);
    setSelected(today.startsWith(next) ? today : (firstDue?.date ?? `${next}-01`));
  }

  function jumpToday() {
    setNavigated(false);
    setMonth(today.slice(0, 7));
    setSelected(today);
  }

  async function markPaid(item: DueItem) {
    const owed = Math.round((item.expected - item.paid) * 100) / 100;
    if (!(owed > 0)) return;
    const target = targets.find((t) => t.key === item.key);
    if (!target) return;
    setMarking(item.key);
    const date = today.startsWith(month) ? today : item.dueDate;
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: target.propertyId,
        unitId: target.unitId,
        type: "rent",
        date,
        amount: owed,
        detail: item.tenantName,
        note: `${monthName(month)} rent`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setMarking("");
    if (!res.ok) {
      push(data?.error || "Couldn't record that payment.", "bad");
      return;
    }
    setPayments((prev) => [...prev, { propertyId: target.propertyId, unitId: target.unitId, date, amount: owed }]);
    push(`${money(owed)} recorded for ${item.tenantName || item.label}.`);
  }

  function worst(items: DueItem[]): DueStatus | "" {
    if (items.some((i) => i.status === "late")) return "late";
    if (items.some((i) => i.status === "partial")) return "partial";
    if (items.some((i) => i.status === "due")) return "due";
    if (items.length) return "paid";
    return "";
  }

  // A render function, not a component: declared in here, a component would
  // be a new type every render and React would remount each row, dropping
  // focus from a button someone had just pressed.
  function itemRow(item: DueItem) {
    const owed = item.expected - item.paid;
    return (
      <div key={item.key} className={styles.calItem}>
        <div className={styles.calItemMain}>
          <div className={styles.calItemHead}>
            <Link href={`/dashboard/properties/${item.propertyId}`} className={styles.calItemName}>
              {item.tenantName || item.label}
            </Link>
            <span className={`${styles.pill} ${styles[STATUS_PILL[item.status]]}`}>
              {item.status === "late" ? `${item.daysLate} ${item.daysLate === 1 ? "day" : "days"} late` : STATUS_WORDS[item.status]}
            </span>
          </div>
          <div className={styles.calItemSub}>
            {item.tenantName ? `${item.label} · ` : ""}
            {item.paid > 0 && item.status !== "paid"
              ? `${money(item.paid)} of ${money(item.expected)} in`
              : money(item.expected)}
            {item.extras.length > 0 &&
              ` · rent ${money(item.rent)} + ${item.extras.map((e) => `${e.label.toLowerCase()} ${money(e.amount)}`).join(" + ")}`}
          </div>
        </div>
        <div className={styles.calItemActions}>
          {item.phone && item.status !== "paid" && (
            <>
              <a className={`${styles.btn} ${styles.small} ${styles.quiet}`} href={telHref(item.phone)}>
                Call
              </a>
              <a className={`${styles.btn} ${styles.small} ${styles.quiet}`} href={smsHref(item.phone)}>
                Text
              </a>
            </>
          )}
          {item.status !== "paid" && owed > 0.005 && (
            <button
              type="button"
              className={`${styles.btn} ${styles.small} ${styles.primary}`}
              disabled={marking === item.key}
              onClick={() => markPaid(item)}
            >
              {marking === item.key ? "Saving…" : `Mark ${money(owed)} paid`}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Calendar"
      tagline="What's due to you on each day of the month, and what's come in."
    >
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <div className={styles.contextBar}>
        {companies.length > 1 ? (
          <div className={styles.companyBar}>
            <button
              type="button"
              className={`${styles.chip} ${company === "all" ? styles.active : ""}`}
              onClick={() => setCompany("all")}
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
        ) : (
          <span />
        )}
        <div className={styles.monthBar}>
          <button type="button" className={styles.monthArrow} aria-label="Previous month" onClick={() => go(-1)}>
            ‹
          </button>
          <span className={styles.monthLabel}>{monthName(month)}</span>
          <button type="button" className={styles.monthArrow} aria-label="Next month" onClick={() => go(1)}>
            ›
          </button>
          {!today.startsWith(month) && (
            <button type="button" className={`${styles.btn} ${styles.small} ${styles.quiet}`} onClick={jumpToday}>
              Today
            </button>
          )}
        </div>
      </div>

      <div className={`${styles.kpis} ${styles.calKpis}`}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Due this month</span>
          <span className={`${styles.kpiValue} num`}>{money(cal.expected)}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Collected</span>
          <span className={`${styles.kpiValue} ${styles.pos} num`}>{money(cal.collected)}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Still to come in</span>
          <span className={`${styles.kpiValue} num`}>{money(cal.outstanding)}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Of that, overdue</span>
          <span className={`${styles.kpiValue} ${cal.overdue > 0 ? styles.neg : ""} num`}>{money(cal.overdue)}</span>
        </div>
      </div>

      <div className={styles.calLayout}>
        <div className={styles.calGrid} role="grid" aria-label={`${monthName(month)} rent calendar`}>
          {WEEKDAYS.map((w) => (
            <div key={w} className={styles.calWeekday} role="columnheader">
              {w}
            </div>
          ))}
          {Array.from({ length: leading }, (_, i) => (
            <div key={`blank-${i}`} className={styles.calBlank} aria-hidden="true" />
          ))}
          {cal.days.map((d) => {
            const state = worst(d.items);
            return (
              <button
                key={d.date}
                type="button"
                role="gridcell"
                aria-selected={d.date === selected}
                aria-label={`${d.day} ${monthName(month)}: ${d.expected ? `${money(d.expected)} due` : "nothing due"}${
                  d.received ? `, ${money(d.received)} received` : ""
                }`}
                className={[
                  styles.calDay,
                  d.date === today ? styles.calToday : "",
                  d.date === selected ? styles.calSelected : "",
                  state ? styles[`cal_${state}`] : "",
                ].join(" ")}
                onClick={() => setSelected(d.date)}
              >
                <span className={styles.calNum}>{d.day}</span>
                {d.expected > 0 && (
                  <span className={`${styles.calAmt} num`}>
                    <span className={styles.calFull}>{money(d.expected)}</span>
                    <span className={styles.calShort}>
                      <span className={styles.calCur}>$</span>
                      {compactMoney(d.expected).slice(1)}
                    </span>
                  </span>
                )}
                {d.received > 0 && (
                  <span className={`${styles.calIn} num`}>
                    +<span className={styles.calFull}>{money(d.received)}</span>
                    <span className={styles.calShort}>
                      <span className={styles.calCur}>$</span>
                      {compactMoney(d.received).slice(1)}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <aside className={styles.calDetail} aria-live="polite">
          {selectedDay && (
            <>
              <h3>
                {new Date(`${selectedDay.date}T12:00:00Z`).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </h3>
              <p className={styles.helpText} style={{ marginTop: 2 }}>
                {selectedDay.expected > 0 ? `${money(selectedDay.expected)} due` : "Nothing due"}
                {selectedDay.received > 0 ? ` · ${money(selectedDay.received)} came in` : ""}
              </p>
              {selectedDay.items.length > 0 ? (
                selectedDay.items.map(itemRow)
              ) : (
                <p className={styles.helpText}>No rent falls due on this day.</p>
              )}
            </>
          )}
        </aside>
      </div>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Every due date in {monthName(month).split(" ")[0]}</h2>
        </div>
        {agenda.length === 0 ? (
          <div className={styles.ledgerWrap}>
            <div className={styles.emptyState}>No rent is due this month.</div>
          </div>
        ) : (
          agenda.map((d) => (
            <div key={d.date} className={styles.calAgendaDay}>
              <div className={styles.calAgendaHead}>
                <span>
                  {new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </span>
                <span className="num">{money(d.expected)}</span>
              </div>
              {d.items.map(itemRow)}
            </div>
          ))
        )}
      </section>
    </AppShell>
  );
}

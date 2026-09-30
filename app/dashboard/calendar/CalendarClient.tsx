"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RecordEntrySheet, { type EntryDraft, type SavedEntry } from "../../components/RecordEntrySheet";
import { amountOwed, owedLine, rentPrefill } from "@/lib/quick-record";
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
  lateFees = {},
  storageReady = false,
}: {
  /** Late fees on the books, keyed "tenantId|YYYY-MM". */
  lateFees?: Record<string, number>;
  storageReady?: boolean;
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
  const router = useRouter();
  // "Mark paid" opens the rent form; a counter remounts it per opening.
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [draftSeq, setDraftSeq] = useState(0);
  const [recording, setRecording] = useState(false);

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

  const feesFor = (item: DueItem) => (item.tenantId ? lateFees[`${item.tenantId}|${month}`] ?? 0 : 0);

  /**
   * "Mark paid" used to record what's owed straight away. It opens the same
   * rent form as the overview's instead — tenant, place, what's owed
   * (charges and late fees included), dated today in this month or on the
   * due date of another — with the amount selected, so Enter records what
   * the button did and anything else (a part payment, proof, a waived fee)
   * goes in first. The overview's sheet is reused rather than navigating
   * there, so you stay on the calendar.
   */
  function markPaid(item: DueItem) {
    const target = targets.find((t) => t.key === item.key);
    if (!target) return;
    const fees = feesFor(item);
    setDraft({
      mode: "quick",
      targetKey: target.key,
      prefill: rentPrefill({
        month,
        today,
        expected: item.expected,
        paid: item.paid,
        fees,
        tenantName: item.tenantName,
        fallbackDate: item.dueDate,
      }),
      context: `${item.tenantName ? `${item.tenantName} · ` : ""}${monthName(month)} · ${owedLine(
        { expected: item.expected, paid: item.paid, fees },
        item.extras.length ? "due" : "rent"
      )}`,
    });
    setDraftSeq((n) => n + 1);
    setRecording(true);
  }

  function entrySaved({ entry, waive }: { entry: SavedEntry; created: boolean; waive: boolean | null }) {
    if (entry.type === "rent") {
      setPayments((prev) => [
        ...prev,
        { propertyId: entry.propertyId, unitId: entry.unitId, date: entry.date, amount: entry.amount },
      ]);
    }
    push(
      `${money(entry.amount)} recorded${entry.detail ? ` for ${entry.detail}` : ""}.${
        waive === null ? "" : waive ? " Late fee waived for the month." : " Late fees apply again from today."
      }`
    );
    // The late fees come from the server; a waiver changes them.
    if (waive !== null) router.refresh();
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
    const owed = amountOwed({ expected: item.expected, paid: item.paid, fees: feesFor(item) });
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
              onClick={() => markPaid(item)}
            >
              {`Mark ${money(owed)} paid`}
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
    >
      <Toasts toasts={toasts} onDismiss={dismiss} />

      {draft && (
        <RecordEntrySheet
          key={draftSeq}
          open={recording}
          draft={draft}
          targets={targets}
          storageReady={storageReady}
          onClose={() => setRecording(false)}
          onSaved={entrySaved}
          onProof={() => {}}
        />
      )}

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
          <span className={`${styles.kpiValue} num`}>{money(cal.collected)}</span>
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

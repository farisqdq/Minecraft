"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import KpiTile, { KpiRow } from "../../components/ui/KpiTile";
import EmptyState from "../../components/ui/EmptyState";
import SegmentedControl from "../../components/ui/SegmentedControl";
import { TableWrap, tableStyles } from "../../components/ui/Table";
import ConfirmDialog, { type ConfirmRequest } from "../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../components/Toasts";
import { useViewOnly } from "../../components/ViewOnly";
import styles from "../dashboard.module.css";
import { money } from "@/lib/money";
import { PURPOSES, centsLabel, deductionFor, rateOn, yearSummary } from "@/lib/mileage";
import type { TripDTO } from "@/lib/trips-db";

type Property = { id: string; name: string; companyId: string; writable: boolean };

function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const milesLabel = (m: number) => `${m.toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`;

/**
 * The mileage log. Logging a trip should take less time than the drive's
 * last red light, so the form remembers how far each property is (the last
 * trip's miles), offers the usual reasons, and any past trip can be logged
 * again for today with one tap.
 */
export default function MileageClient({
  openRepairs,
  userLabel,
  today,
  companies,
  properties,
  initialTrips,
  preselect,
}: {
  openRepairs: number;
  userLabel: string;
  today: string;
  companies: { id: string; name: string }[];
  properties: Property[];
  initialTrips: TripDTO[];
  preselect: string;
}) {
  const viewOnly = useViewOnly();
  const { toasts, push, dismiss } = useToasts();
  const [trips, setTrips] = useState(initialTrips);
  const writable = properties.filter((p) => p.writable);
  const firstProperty = writable.find((p) => p.id === preselect)?.id ?? writable[0]?.id ?? "";
  const lastMiles = (propertyId: string) => trips.find((t) => t.propertyId === propertyId)?.miles;
  const [form, setForm] = useState(() => ({
    date: today,
    propertyId: firstProperty,
    miles: firstProperty && initialTrips.find((t) => t.propertyId === firstProperty) ? String(initialTrips.find((t) => t.propertyId === firstProperty)!.miles) : "",
    purpose: "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  const years = useMemo(() => {
    const set = new Set(trips.map((t) => Number(t.date.slice(0, 4))));
    set.add(Number(today.slice(0, 4)));
    return [...set].sort((a, b) => b - a);
  }, [trips, today]);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const summary = useMemo(() => yearSummary(trips, year), [trips, year]);
  const shown = trips.filter((t) => t.date.startsWith(`${year}-`));
  const nameOf = new Map(properties.map((p) => [p.id, p.name]));
  const companyOf = new Map(companies.map((c) => [c.id, c.name]));
  const rateToday = rateOn(today);
  const formRate = rateOn(form.date);
  const formMiles = Number(form.miles);
  const multiLlc = companies.length > 1;

  function pickProperty(propertyId: string) {
    const last = lastMiles(propertyId);
    setForm((f) => ({ ...f, propertyId, miles: last !== undefined ? String(last) : "" }));
  }

  async function save(body: { propertyId: string; date: string; miles: string | number; purpose: string }) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/properties/${body.propertyId}/trips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res || !res.ok) {
      const message = data?.error || "Couldn't save that — check the connection and try again.";
      setError(message);
      push(message, "bad");
      return null;
    }
    setTrips((prev) => [data as TripDTO, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    return data as TripDTO;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trip = await save(form);
    if (!trip) return;
    setYear(Number(trip.date.slice(0, 4)));
    setForm((f) => ({ ...f, purpose: "" }));
    const d = deductionFor([trip]);
    push(`${milesLabel(trip.miles)} to ${nameOf.get(trip.propertyId)} logged — ${money(d.amount)} deductible.`);
  }

  async function repeat(t: TripDTO) {
    const trip = await save({ propertyId: t.propertyId, date: today, miles: t.miles, purpose: t.purpose });
    if (trip) {
      setYear(Number(today.slice(0, 4)));
      push(`Logged again for today: ${milesLabel(t.miles)} to ${nameOf.get(t.propertyId)}.`);
    }
  }

  function remove(t: TripDTO) {
    setConfirming({
      title: `Remove the ${milesLabel(t.miles)} trip on ${dayLabel(t.date)}?`,
      body: "It comes out of the log and the tax export.",
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        setConfirming(null);
        const res = await fetch(`/api/trips/${t.id}`, { method: "DELETE" }).catch(() => null);
        if (!res || !res.ok) {
          push("Couldn't remove that.", "bad");
          return;
        }
        setTrips((prev) => prev.filter((x) => x.id !== t.id));
      },
    });
  }

  const byProperty = [...summary.byProperty.entries()]
    .map(([id, d]) => ({ id, name: nameOf.get(id) ?? "", ...d, trips: shown.filter((t) => t.propertyId === id).length }))
    .sort((a, b) => b.amount - a.amount);

  return (
    <AppShell
      title="Mileage"
      tagline="Driving to your rentals is deductible on Schedule E — log each trip"
      userLabel={userLabel}
      openRepairs={openRepairs}
    >
      {years.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <SegmentedControl
            label="Tax year"
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
            value={String(year)}
            onChange={(v) => setYear(Number(v))}
          />
        </div>
      )}

      <KpiRow>
        <KpiTile label={`Deduction, ${year}`} value={money(summary.amount)} hint={summary.unpublished ? "At the latest known rate" : "Standard mileage rate"} />
        <KpiTile label="Miles" value={milesLabel(summary.miles)} hint={`${summary.trips} trip${summary.trips === 1 ? "" : "s"}`} />
        <KpiTile
          label="Rate today"
          value={rateToday ? `${centsLabel(rateToday.cents)} a mile` : "—"}
          hint={rateToday ? (rateToday.published ? `Since ${dayLabel(rateToday.from)} · IRS ${rateToday.source}` : "This year's rate isn't in the app yet") : ""}
        />
      </KpiRow>

      {!viewOnly && writable.length > 0 && (
        <section className={styles.card} style={{ marginTop: 16, padding: 16 }} aria-label="Log a trip">
          <form onSubmit={submit}>
            {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 12 }}>{error}</div>}
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label htmlFor="trip-date">Date</label>
                <input id="trip-date" type="date" required max={today} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="trip-property">To</label>
                <select id="trip-property" required value={form.propertyId} onChange={(e) => pickProperty(e.target.value)}>
                  {writable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {multiLlc ? ` — ${companyOf.get(p.companyId) ?? ""}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="trip-miles">Miles, there and back</label>
                <input
                  id="trip-miles"
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="2000"
                  step="0.1"
                  required
                  value={form.miles}
                  onChange={(e) => setForm((f) => ({ ...f, miles: e.target.value }))}
                />
              </div>
              <div className={`${styles.field} ${styles.span4}`}>
                <label htmlFor="trip-purpose">What for</label>
                <input
                  id="trip-purpose"
                  type="text"
                  list="trip-purposes"
                  required
                  maxLength={200}
                  placeholder="Repair or maintenance, a showing, supplies…"
                  value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                />
                <datalist id="trip-purposes">
                  {PURPOSES.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className={styles.formFoot} style={{ alignItems: "center" }}>
              <span className={styles.note} style={{ marginRight: "auto", marginTop: 0 }}>
                {formRate && formMiles > 0
                  ? `${milesLabel(Math.round(formMiles * 10) / 10)} × ${centsLabel(formRate.cents)} = ${money(deductionFor([{ date: form.date, miles: formMiles }]).amount)}`
                  : lastMiles(form.propertyId) !== undefined
                    ? `Last time: ${milesLabel(lastMiles(form.propertyId)!)}`
                    : "Use the odometer or a map, there and back."}
              </span>
              <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
                {busy ? "Saving…" : "Log trip"}
              </button>
            </div>
          </form>
        </section>
      )}

      {properties.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title="No properties yet" detail="Add a property from the overview, then log the drives to it here." />
        </div>
      ) : shown.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            title={`No trips logged for ${year}`}
            detail="Every drive to a rental for its business counts — a repair, a showing, a run for supplies."
            compact
          />
        </div>
      ) : (
        <>
          {byProperty.length > 1 && (
            <div style={{ marginTop: 16 }}>
              <TableWrap>
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      <th>Property</th>
                      <th className={tableStyles.num}>Trips</th>
                      <th className={tableStyles.num}>Miles</th>
                      <th className={tableStyles.num}>Deduction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byProperty.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Property">{p.name}</td>
                        <td className={tableStyles.num} data-label="Trips">{p.trips}</td>
                        <td className={tableStyles.num} data-label="Miles">{milesLabel(p.miles)}</td>
                        <td className={tableStyles.num} data-label="Deduction">{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <TableWrap>
              <table className={tableStyles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>To</th>
                    <th>What for</th>
                    <th className={tableStyles.num}>Miles</th>
                    <th className={tableStyles.num}>Rate</th>
                    <th className={tableStyles.num}>Deduction</th>
                    {!viewOnly && <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => {
                    const rate = rateOn(t.date);
                    const canEdit = !viewOnly && properties.find((p) => p.id === t.propertyId)?.writable;
                    return (
                      <tr key={t.id}>
                        <td data-label="Date">{dayLabel(t.date)}</td>
                        <td data-label="To">{nameOf.get(t.propertyId)}</td>
                        <td data-label="What for">{t.purpose}</td>
                        <td className={tableStyles.num} data-label="Miles">{milesLabel(t.miles)}</td>
                        <td className={tableStyles.num} data-label="Rate">{rate ? centsLabel(rate.cents) : "—"}</td>
                        <td className={tableStyles.num} data-label="Deduction">{money(deductionFor([t]).amount)}</td>
                        {!viewOnly && (
                          <td className={tableStyles.num} data-label="">
                            {canEdit && (
                              <span style={{ display: "inline-flex", gap: 12 }}>
                                <button type="button" className={styles.portalLink} disabled={busy} onClick={() => repeat(t)}>
                                  Again today
                                </button>
                                <button type="button" className={`${styles.portalLink}`} onClick={() => remove(t)} aria-label="Remove trip">
                                  Remove
                                </button>
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </div>
        </>
      )}

      <p className={styles.helpText} style={{ marginTop: 16 }}>
        Each line&apos;s deduction is its miles at the rate in force that day; the year&apos;s total multiplies each
        rate&apos;s miles once, the way an accountant would, so it can differ from the lines by a cent. The standard rate
        can&apos;t be used for a car whose actual costs or depreciation you deduct. Parking and tolls are deductible on
        top — record them in the ledger as expenses. Trips are on the{" "}
        <Link className={styles.portalLink} href="/dashboard/export">
          tax export
        </Link>
        , per property, with this log listed in full.
      </p>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}

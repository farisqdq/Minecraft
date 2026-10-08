"use client";

import { useState } from "react";
import Modal from "./Modal";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import styles from "../dashboard/dashboard.module.css";
import { money, moneyRound } from "@/lib/money";
import {
  ASSET_CLASSES,
  CLASS_LABEL,
  accumulatedThrough,
  depreciationFor,
  finalYear,
  type AssetClass,
} from "@/lib/depreciation";
import type { AssetDTO } from "@/lib/assets-db";
import { useViewOnly } from "./ViewOnly";

const EMPTY = {
  id: "",
  kind: "building" as "building" | "improvement",
  label: "",
  cls: "residential" as AssetClass,
  basis: "",
  inService: "",
  note: "",
};

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A property's building and improvements, and what each is worth as a
 * deduction this year — the Schedule E line that no ledger shows.
 */
export default function DepreciationPanel({
  propertyId,
  initial,
  year,
  canDelete,
  onToast,
}: {
  propertyId: string;
  initial: AssetDTO[];
  /** The tax year to show, from the parent's idea of today. */
  year: number;
  canDelete: boolean;
  onToast: (message: string, tone?: "bad") => void;
}) {
  const viewOnly = useViewOnly();
  const [assets, setAssets] = useState(initial);
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  const hasBuilding = assets.some((a) => a.kind === "building");
  const thisYear = assets.reduce((sum, a) => sum + depreciationFor(a, year), 0);
  const taken = assets.reduce((sum, a) => sum + accumulatedThrough(a, year), 0);
  const basis = assets.reduce((sum, a) => sum + a.basis, 0);
  const sorted = [...assets].sort(
    (a, b) => Number(b.kind === "building") - Number(a.kind === "building") || a.inService.localeCompare(b.inService)
  );

  function openNew(kind: "building" | "improvement") {
    const cls = assets.find((a) => a.kind === "building")?.cls ?? "residential";
    setForm({ ...EMPTY, kind, cls, label: kind === "building" ? "Building" : "" });
    setError("");
    setOpen(true);
  }

  function openEdit(a: AssetDTO) {
    setForm({
      id: a.id,
      kind: a.kind,
      label: a.label,
      cls: a.cls,
      basis: String(a.basis),
      inService: a.inService,
      note: a.note,
    });
    setError("");
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { id, ...fields } = form;
    const res = await fetch(id ? `/api/assets/${id}` : `/api/properties/${propertyId}/assets`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that.");
      return;
    }
    setAssets((prev) => (id ? prev.map((a) => (a.id === id ? data : a)) : [...prev, data]));
    setOpen(false);
    onToast(id ? "Saved." : `${data.label} added — ${money(depreciationFor(data, year))} to deduct for ${year}.`);
  }

  function remove(a: AssetDTO) {
    setConfirming({
      title: `Remove ${a.label}?`,
      body: "Its depreciation comes out of every year's tax export, including years already filed.",
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/assets/${a.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        setConfirming(null);
        if (!res.ok) {
          onToast(data?.error || "Couldn't remove that.", "bad");
          return;
        }
        setAssets((prev) => prev.filter((x) => x.id !== a.id));
        setOpen(false);
        onToast(`${a.label} removed.`);
      },
    });
  }

  return (
    <>
      {assets.length > 0 && (
        <div className={styles.depSummary}>
          <div>
            <span className={styles.figureLabel}>To deduct for {year}</span>
            <span className={`${styles.depFigure} num`}>{money(Math.round(thisYear * 100) / 100)}</span>
          </div>
          <div>
            <span className={styles.figureLabel}>Taken through {year}</span>
            <span className={`${styles.figureValue} num`}>
              {moneyRound(taken)} <span className={styles.note}>of {moneyRound(basis)}</span>
            </span>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className={styles.ledgerWrap}>
          <div className={styles.emptyState}>
            {viewOnly ? "Nothing on file." : "Nothing on file. Add the building to start taking the deduction."}
          </div>
        </div>
      ) : (
        <ul className={styles.assetList}>
          {sorted.map((a) => {
            const now = depreciationFor(a, year);
            const done = accumulatedThrough(a, year) >= a.basis;
            const [startYear] = a.inService.split("-").map(Number);
            return (
              <li key={a.id}>
                <div className={styles.assetMain}>
                  <span className={styles.assetLabel}>{a.label}</span>
                  <span className={styles.note} style={{ marginTop: 0 }}>
                    {money(a.basis)} · in service {monthLabel(a.inService)} ·{" "}
                    {a.cls === "commercial" ? "39 years" : "27.5 years"}
                    {done ? " · fully depreciated" : year < startYear ? "" : ` · through ${finalYear(a)}`}
                  </span>
                </div>
                <span className={`${styles.assetAmt} num`}>{now > 0 ? money(now) : "—"}</span>
                {!viewOnly && (
                  <button type="button" className={styles.portalLink} onClick={() => openEdit(a)}>
                    Edit
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!viewOnly && <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!hasBuilding && (
          <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => openNew("building")}>
            + Add the building
          </button>
        )}
        <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => openNew("improvement")}>
          + Add an improvement
        </button>
      </div>}

      <Modal
        open={open}
        title={form.id ? `Edit ${form.label}` : form.kind === "building" ? "Add the building" : "Add an improvement"}
        subtitle={
          form.kind === "building"
            ? "What you paid for the building — the purchase price plus closing costs, less the land, which never depreciates. Your county's tax assessment splits the two; use its ratio."
            : "Something that adds value or life to the building — a roof, a furnace, a remodel — rather than a repair that keeps it running. If it's already in the ledger as a repair, it's being deducted twice."
        }
        onClose={() => setOpen(false)}
      >
        <form onSubmit={save}>
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            {form.kind === "improvement" && (
              <div className={`${styles.field} ${styles.span4}`}>
                <label htmlFor="asset-label">What was it</label>
                <input
                  id="asset-label"
                  type="text"
                  required
                  placeholder="e.g. New roof"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
            )}
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="asset-basis">{form.kind === "building" ? "Building cost, without land ($)" : "Cost ($)"}</label>
              <input
                id="asset-basis"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                required
                value={form.basis}
                onChange={(e) => setForm((f) => ({ ...f, basis: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="asset-in-service">First ready to rent</label>
              <input
                id="asset-in-service"
                type="month"
                required
                value={form.inService}
                onChange={(e) => setForm((f) => ({ ...f, inService: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="asset-cls">Kind of property</label>
              <select
                id="asset-cls"
                value={form.cls}
                onChange={(e) => setForm((f) => ({ ...f, cls: e.target.value as AssetClass }))}
              >
                {ASSET_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {CLASS_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="asset-note">Note</label>
              <input
                id="asset-note"
                type="text"
                placeholder="Closing statement, contractor…"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>
          {Number(form.basis) > 0 && /^\d{4}-\d{2}$/.test(form.inService) && (
            <p className={styles.helpText}>
              {money(depreciationFor({ basis: Number(form.basis), inService: form.inService, cls: form.cls }, year))}{" "}
              to deduct for {year}, then about{" "}
              {moneyRound(Number(form.basis) / (form.cls === "commercial" ? 39 : 27.5))} a year through{" "}
              {finalYear({ basis: Number(form.basis), inService: form.inService, cls: form.cls })}.
            </p>
          )}
          <div className={styles.formFoot}>
            {form.id && canDelete && (
              <button
                type="button"
                className={`${styles.btn} ${styles.quiet} ${styles.danger}`}
                style={{ marginRight: "auto" }}
                onClick={() => {
                  const a = assets.find((x) => x.id === form.id);
                  if (a) remove(a);
                }}
              >
                Remove
              </button>
            )}
            <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
              {busy ? "Saving…" : form.id ? "Save" : "Add"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
    </>
  );
}

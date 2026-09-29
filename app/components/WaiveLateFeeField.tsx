"use client";

import { useEffect, useState } from "react";
import { monthName } from "@/lib/notices";
import styles from "../dashboard/dashboard.module.css";

type Lookup = {
  tenant: { id: string; name: string } | null;
  month: string;
  waiver: { waived: boolean; waivedByName: string; waivedAt: string } | null;
};

/**
 * "Waive late fee for this month" on a rent form (late fee waivers, a21).
 *
 * Shown only when the entry maps to one current tenant — a property or unit
 * with someone renting it — which it asks the server about as the place and
 * date change. `value` is null until the box is touched, so saving an edit
 * without touching it never waives or un-waives anything; the parent sends
 * `waiveLateFee: value` only when it isn't null. Ticked, the save removes that
 * month's late fees and stops more; unticked on a waived month, fees start
 * again from today (lib/late-fee-waiver.ts has the whole rule).
 */
export default function WaiveLateFeeField({
  propertyId,
  unitId,
  date,
  value,
  onChange,
  className,
}: {
  propertyId: string;
  unitId: string | null;
  /** The entry's date, YYYY-MM-DD; its month is the one waived. */
  date: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  className?: string;
}) {
  const month = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "";
  const [info, setInfo] = useState<Lookup | null>(null);

  useEffect(() => {
    if (!propertyId || !month) {
      setInfo(null);
      return;
    }
    let live = true;
    const q = new URLSearchParams({ propertyId, unitId: unitId ?? "", month });
    fetch(`/api/late-fee-waivers?${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Lookup | null) => live && setInfo(d))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [propertyId, unitId, month]);

  if (!info?.tenant || info.month !== month) return null;
  const already = Boolean(info.waiver?.waived);
  const checked = value ?? already;
  return (
    <label className={`${styles.checkboxField} ${className ?? ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked === already ? null : e.target.checked)}
      />
      <span>
        Waive late fee for this month
        <span className={styles.note} style={{ display: "block" }}>
          {already && value !== false
            ? `${monthName(month)} is waived for ${info.tenant.name}${
                info.waiver?.waivedByName ? ` (by ${info.waiver.waivedByName})` : ""
              }. Untick to let late fees apply again from today.`
            : checked
              ? `Removes ${info.tenant.name}'s ${monthName(month)} late fees and stops any more. Other months still get theirs.`
              : `${info.tenant.name}, ${monthName(month)}.`}
        </span>
      </span>
    </label>
  );
}

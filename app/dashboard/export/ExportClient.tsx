"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/money";
import { formatDay } from "@/lib/lease";
import type { Row1099 } from "@/lib/tax1099";
import AppShell from "../../components/AppShell";
import styles from "../dashboard.module.css";

type Company = { id: string; name: string };

export default function ExportClient({
  openRepairs,
  companies,
  earliestYear,
}: {
  /** Repairs waiting on you, for the nav badge. */
  openRepairs?: number;
  companies: Company[];
  earliestYear: number | null;
}) {
  const currentYear = new Date().getFullYear();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [year, setYear] = useState(currentYear);

  // The 1099-NEC review for the same LLC and year (a26).
  const [nec, setNec] = useState<{ year: number; threshold: number; due: string; rows: Row1099[] } | null>(null);
  const [necError, setNecError] = useState("");
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    setNecError("");
    fetch(`/api/export/1099?companyId=${encodeURIComponent(companyId)}&year=${year}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setNecError(data.error || "Couldn't load the 1099 review.");
        else setNec(data);
      })
      .catch(() => live && setNecError("Couldn't reach the server."));
    return () => {
      live = false;
    };
  }, [companyId, year]);
  const necRows = nec && nec.year === year ? nec.rows : null;
  const toFile = necRows?.filter((r) => r.status === "file").length ?? 0;
  const toCheck = necRows?.filter((r) => r.status === "check").length ?? 0;

  const startYear = earliestYear ?? currentYear;
  const years: number[] = [];
  for (let y = currentYear; y >= startYear; y--) years.push(y);
  if (years.length === 0) years.push(currentYear);

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Export"
      tagline="Download a year of one LLC's ledger, ready for taxes."
    >
      {companies.length === 0 ? (
        <div className={styles.firstRun}>
          <h2>No LLCs yet</h2>
          <p>Add an LLC on the dashboard first, then come back here to export its numbers.</p>
        </div>
      ) : (
        <section className={styles.block}>
          <div className={styles.formCard}>
            <p className={styles.helpText} style={{ marginTop: 0 }}>
              Produces a CSV with every rent payment and expense for the year, categorized the way a Schedule E is —
              plus a summary totalling rental income and each expense category — and, when the LLC owns more
              than one house, the same breakdown per property, which is how Schedule E is filled in. Each mortgage
              gets a line with the year&apos;s interest, to check against the lender&apos;s Form 1098. Hand it straight to an accountant or open it in a spreadsheet.
            </p>
            <div className={styles.twoCol}>
              <div className={styles.field}>
                <label htmlFor="export-company">LLC</label>
                <select id="export-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="export-year">Year</label>
                <select id="export-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={styles.formFoot} style={{ justifyContent: "flex-start", marginTop: 14 }}>
              <a
                className={`${styles.btn} ${styles.primary}`}
                href={`/api/export?companyId=${encodeURIComponent(companyId)}&year=${year}`}
                download
              >
                Download CSV
              </a>
            </div>
          </div>
        </section>
      )}

      {companies.length > 0 && (
        <section className={styles.block}>
          <div className={styles.blockHead}>
            <h2>1099-NEC · {year}</h2>
            {nec && nec.year === year && (
              <span className={styles.count}>
                Due {formatDay(nec.due)} · over {money(nec.threshold)}
              </span>
            )}
          </div>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            The LLC files a 1099-NEC for each person or partnership it paid {nec ? money(nec.threshold) : "the threshold"} or
            more for services in {year} — from the expenses that name someone in the{" "}
            <Link href="/dashboard/repairs/vendors">vendor book</Link>. Corporations are exempt, except for legal services.
            Payments made by card or PayPal are reported by the processor on a 1099-K, so leave those out. Not tax advice.
          </p>
          {necError && <div className={styles.errorBar}>{necError}</div>}
          {necRows && necRows.length === 0 && (
            <div className={`${styles.formCard} ${styles.emptyState}`}>
              No payments to anyone in the vendor book in {year}. An expense counts here when it names its vendor —
              recording a repair&apos;s cost does that, and the bank import fills it in when it recognises one.
            </div>
          )}
          {necRows && necRows.length > 0 && (
            <div className={styles.formCard}>
              <p className={styles.necSummary}>
                {toFile > 0 ? `${toFile} to file` : "Nothing to file"}
                {toCheck > 0 && ` · ${toCheck} to check — set their tax class from their W-9`}
              </p>
              <ul className={styles.necList}>
                {necRows.map((r) => (
                  <li key={r.vendorId} className={r.status === "below" || r.status === "exempt" ? styles.necQuiet : ""}>
                    <div className={styles.necMain}>
                      <span className={styles.necName}>{r.name}</span>
                      <span
                        className={`${styles.pill} ${
                          r.status === "file" ? styles.owed : r.status === "check" ? styles.bill : r.status === "exempt" ? styles.paid : styles.vacant
                        }`}
                      >
                        {r.status === "file" ? "1099 due" : r.status === "check" ? "Check" : r.status === "exempt" ? "Exempt" : "Under"}
                      </span>
                      <span className={`${styles.necAmt} num`}>{money(r.total)}</span>
                    </div>
                    <div className={styles.necWhy}>
                      {r.status !== "below" && <span>{r.w9 ? "W-9 on file" : "No W-9 on file"} · </span>}
                      {r.why}
                    </div>
                  </li>
                ))}
              </ul>
              <div className={styles.formFoot} style={{ justifyContent: "flex-start" }}>
                <a
                  className={styles.btn}
                  href={`/api/export/1099?companyId=${encodeURIComponent(companyId)}&year=${year}&format=csv`}
                  download
                >
                  Download 1099 review (CSV)
                </a>
                <Link className={`${styles.btn} ${styles.quiet}`} href="/dashboard/repairs/vendors">
                  Open the vendor book
                </Link>
              </div>
            </div>
          )}
        </section>
      )}
    </AppShell>
  );
}

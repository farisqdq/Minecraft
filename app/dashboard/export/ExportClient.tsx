"use client";

import { useState } from "react";
import AppShell from "../../components/AppShell";
import styles from "../dashboard.module.css";

type Company = { id: string; name: string };

export default function ExportClient({
  companies,
  earliestYear,
}: {
  companies: Company[];
  earliestYear: number | null;
}) {
  const currentYear = new Date().getFullYear();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [year, setYear] = useState(currentYear);

  const startYear = earliestYear ?? currentYear;
  const years: number[] = [];
  for (let y = currentYear; y >= startYear; y--) years.push(y);
  if (years.length === 0) years.push(currentYear);

  return (
    <AppShell
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
              plus a summary block totaling rental income and each expense category. Hand it straight to an
              accountant or open it in a spreadsheet.
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
    </AppShell>
  );
}

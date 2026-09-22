"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import styles from "../dashboard.module.css";

type Counts = {
  companies: number;
  properties: number;
  units: number;
  recurring: number;
  transactions: number;
  tenants: number;
  requests: number;
};

export default function BackupClient({
  counts,
  openRepairs,
}: {
  counts: Counts;
  /** Repairs waiting on you, for the nav badge. */
  openRepairs?: number;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [importing, setImporting] = useState(false);

  // "2 LLCs, 4 properties, 3 tenants and 118 ledger entries" — built as a list
  // so an empty category is left out rather than printed as "0 tenants".
  const summary = (() => {
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const parts = [
      plural(counts.companies, "LLC", "LLCs"),
      plural(counts.properties, "property", "properties"),
    ];
    if (counts.units) parts.push(plural(counts.units, "unit", "units"));
    if (counts.tenants) parts.push(plural(counts.tenants, "tenant", "tenants"));
    if (counts.recurring) parts.push(plural(counts.recurring, "recurring expense", "recurring expenses"));
    if (counts.requests) parts.push(plural(counts.requests, "repair report", "repair reports"));
    parts.push(plural(counts.transactions, "ledger entry", "ledger entries"));
    return parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
      : parts[0];
  })();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setResult("");
    setImporting(true);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch("/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Couldn't import that file.");
        return;
      }
      const parts = [
        `${data.companies} ${data.companies === 1 ? "LLC" : "LLCs"}`,
        `${data.properties} ${data.properties === 1 ? "property" : "properties"}`,
      ];
      if (data.units) parts.push(`${data.units} ${data.units === 1 ? "unit" : "units"}`);
      parts.push(`${data.transactions} ledger ${data.transactions === 1 ? "entry" : "entries"}`);
      if (data.recurring) {
        parts.push(`${data.recurring} recurring ${data.recurring === 1 ? "expense" : "expenses"}`);
      }
      if (data.tenants) parts.push(`${data.tenants} ${data.tenants === 1 ? "tenant" : "tenants"}`);
      if (data.requests) {
        parts.push(`${data.requests} repair ${data.requests === 1 ? "report" : "reports"}`);
      }
      if (data.charges) {
        parts.push(`${data.charges} ${data.charges === 1 ? "charge" : "charges"}`);
      }
      if (data.rules) {
        parts.push(`${data.rules} billing ${data.rules === 1 ? "rule" : "rules"}`);
      }
      parts.push(`${data.attachments} ${data.attachments === 1 ? "proof" : "proofs"}`);
      setResult(`Restored ${parts.join(", ")}.`);
      router.refresh();
    } catch {
      setError("That file isn't valid JSON — pick a backup file you downloaded from here.");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Backup"
      tagline="Download a copy of everything, or restore one back into the app."
    >

      {error && <div className={styles.errorBar}>{error}</div>}
      {result && <div className={styles.successBar}>{result}</div>}

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Download a backup</h2>
        </div>
        <div className={styles.formCard}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Saves {summary} to a single file on your computer. Keep it somewhere
            safe — it&apos;s a full copy of your records.
          </p>
          <p className={styles.helpText}>
            Tenants&apos; portal logins are deliberately left out. The file lands in your downloads
            and gets emailed around, and passwords have no business in it — after a restore you
            invite them again from their card, and everything they ever reported is already there
            waiting.
          </p>
          <div className={styles.formFoot} style={{ justifyContent: "flex-start", marginTop: 14 }}>
            <a className={`${styles.btn} ${styles.primary}`} href="/api/backup" download>
              Download backup
            </a>
          </div>
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Restore from a backup</h2>
        </div>
        <div className={styles.formCard}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Importing only ever <strong>adds</strong> — it never overwrites or deletes what&apos;s already here. Each
            LLC in the file comes back in as a new LLC you own, with its properties and ledger. If a name is already
            taken, the restored copy is renamed so you can compare the two before removing either.
          </p>
          <div className={styles.formFoot} style={{ justifyContent: "flex-start", marginTop: 14 }}>
            <input
              id="backup-file"
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              onChange={onFile}
              disabled={importing}
              className={styles.fileInput}
            />
          </div>
          {importing && <p className={styles.helpText}>Restoring…</p>}
        </div>
      </section>
    </AppShell>
  );
}

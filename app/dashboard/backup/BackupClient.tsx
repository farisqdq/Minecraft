"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../dashboard.module.css";

type Counts = { companies: number; properties: number; transactions: number };

export default function BackupClient({ counts }: { counts: Counts }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [importing, setImporting] = useState(false);

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
      setResult(
        `Restored ${data.companies} ${data.companies === 1 ? "LLC" : "LLCs"}, ` +
          `${data.properties} ${data.properties === 1 ? "property" : "properties"}, and ` +
          `${data.transactions} ledger ${data.transactions === 1 ? "entry" : "entries"}.`
      );
      router.refresh();
    } catch {
      setError("That file isn't valid JSON — pick a backup file you downloaded from here.");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <h1>Backup</h1>
          <div className={styles.tagline}>Download a copy of everything, or restore one back into the app.</div>
        </div>
        <div className={styles.userBar}>
          <a href="/dashboard" className={styles.textLink}>
            Back to dashboard
          </a>
        </div>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}
      {result && <div className={styles.successBar}>{result}</div>}

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Download a backup</h2>
        </div>
        <div className={styles.formCard}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Saves {counts.companies} {counts.companies === 1 ? "LLC" : "LLCs"}, {counts.properties}{" "}
            {counts.properties === 1 ? "property" : "properties"}, and {counts.transactions} ledger{" "}
            {counts.transactions === 1 ? "entry" : "entries"} to a single file on your computer. Keep it somewhere
            safe — it&apos;s a full copy of your records.
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
    </div>
  );
}

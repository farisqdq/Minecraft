"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import BackupBrowser, { type BrowserUrls } from "../../components/BackupBrowser";
import styles from "../dashboard.module.css";

/** Browse any phone's photos and videos. */
export default function GalleryClient({
  openRepairs, configured, phones, down = false,
}: {
  openRepairs?: number;
  configured: boolean;
  phones: { id: string; name: string }[];
  down?: boolean;
}) {
  const router = useRouter();
  const [phoneId, setPhoneId] = useState(phones[0]?.id || "");
  useEffect(() => { if (!phoneId && phones[0]) setPhoneId(phones[0].id); }, [phones, phoneId]);
  // If the backup server didn't answer, quietly try again every 15 seconds.
  useEffect(() => {
    if (!down) return;
    const t = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(t);
  }, [down, router]);

  const urls: BrowserUrls = {
    listUrl: (dir) => `/api/phones/${phoneId}/files?dir=${encodeURIComponent(dir)}`,
    fileUrl: (path, download) => `/api/phones/${phoneId}/file?p=${encodeURIComponent(path)}${download ? "&download=1" : ""}`,
  };

  return (
    <AppShell openRepairs={openRepairs} title="Gallery" tagline="Photos and videos from the company phones.">
      {!configured ? (
        <section className={styles.block}><div className={styles.formCard}>
          <p className={styles.helpText} style={{ margin: 0 }}>The backup server isn&apos;t connected yet.</p>
        </div></section>
      ) : down ? (
        <section className={styles.block}><div className={styles.formCard}>
          <p className={styles.helpText} style={{ margin: 0 }}>
            The backup server on your VPS isn&apos;t answering right now. Your photos are safe — this page will retry on its own.
          </p>
        </div></section>
      ) : phones.length === 0 ? (
        <section className={styles.block}><div className={styles.formCard}>
          <p className={styles.helpText} style={{ margin: 0 }}>No set-up phones yet. Add one on the Phones page.</p>
        </div></section>
      ) : (
        <>
          <section className={styles.block}>
            <div className={styles.formCard}>
              <label className={styles.helpText} style={{ marginTop: 0, display: "block" }}>Phone</label>
              <select
                value={phoneId}
                onChange={(e) => setPhoneId(e.target.value)}
                style={{ padding: "10px 12px", border: "1px solid var(--line,#e4e2da)", borderRadius: 10, font: "inherit", background: "var(--card,#fff)", color: "inherit", minWidth: 220 }}
              >
                {phones.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </section>
          <section className={styles.block}>
            <div className={styles.formCard}>
              {phoneId && <BackupBrowser key={phoneId} urls={urls} startDir="Photos" />}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}

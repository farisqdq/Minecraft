"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import { useAppearance } from "../../components/appearance/AppearanceContext";
import { LAYOUT_LABELS, THEME_LABELS } from "@/lib/appearance";
import styles from "./settings.module.css";

type Item = { href: string; title: string; detail: string; adminOnly?: boolean };

const ITEMS: Item[] = [
  { href: "/dashboard/account", title: "Account & security", detail: "Password, two-factor sign-in, notifications on this device." },
  { href: "/dashboard/team", title: "Team", detail: "Who can see each LLC, invites and late-fee rules." },
  { href: "/dashboard/reminders", title: "Reminders", detail: "What gets sent to you and your tenants, and when." },
  { href: "/dashboard/backup", title: "Backup", detail: "Download everything, or restore from a backup." },
  { href: "/dashboard/export", title: "Export", detail: "Spreadsheets for your accountant." },
  { href: "/dashboard/phones", title: "Phones", detail: "Company phone backups — status, texts, calls, contacts, restore links.", adminOnly: true },
  { href: "/dashboard/gallery", title: "Gallery", detail: "Photos and videos from the company phones.", adminOnly: true },
  { href: "/dashboard/admin", title: "Admin", detail: "Site-wide accounts, mail and devices.", adminOnly: true },
];

export default function SettingsClient({ openRepairs, userLabel, admin }: { openRepairs: number; userLabel: string; admin: boolean }) {
  const { appearance } = useAppearance();
  const items = ITEMS.filter((i) => !i.adminOnly || admin);
  // Only inside the Rent Roll Android app (which tags its browser) can we open
  // the phone's own Backup screen; in a normal browser the link does nothing.
  const [inApp, setInApp] = useState(false);
  useEffect(() => {
    try { setInApp(navigator.userAgent.includes("RentRollApp")); } catch { /* ignore */ }
  }, []);
  return (
    <AppShell openRepairs={openRepairs} userLabel={userLabel} title="Settings">
      <ul className={styles.list}>
        {inApp && (
          <li>
            <a href="rentroll://backup" className={styles.row}>
              <span className={styles.text}>
                <span className={styles.title}>Phone backup</span>
                <span className={styles.detail}>Back up this phone — photos, videos, contacts, texts and more.</span>
              </span>
              <span className={styles.chev} aria-hidden="true">›</span>
            </a>
          </li>
        )}
        <li>
          <Link href="/dashboard/settings/appearance" className={styles.row}>
            <span className={styles.text}>
              <span className={styles.title}>Appearance</span>
              <span className={styles.detail}>
                {LAYOUT_LABELS[appearance.layout].name} · {THEME_LABELS[appearance.theme]}
              </span>
            </span>
            <span className={styles.chev} aria-hidden="true">
              ›
            </span>
          </Link>
        </li>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className={styles.row}>
              <span className={styles.text}>
                <span className={styles.title}>{i.title}</span>
                <span className={styles.detail}>{i.detail}</span>
              </span>
              <span className={styles.chev} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}

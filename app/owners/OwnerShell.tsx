"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutTo } from "../components/sign-out";
import styles from "./owners.module.css";

const TABS = [
  { href: "/owners", label: "Overview" },
  { href: "/owners/money", label: "Income & expenses" },
  { href: "/owners/statement", label: "Statement" },
  { href: "/owners/account", label: "Account" },
];

/** The owner frame: a brand, four tabs, who you are, and the way out. */
export default function OwnerShell({ who, children }: { who: string; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const isOn = (href: string) => (href === "/owners" ? pathname === "/owners" : pathname.startsWith(href));
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/owners" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            R
          </span>
          Rent Roll
          <span className={styles.brandTag}>Owner</span>
        </Link>
        <span className={styles.spacer} />
        {who && <span className={styles.who}>{who}</span>}
        <button type="button" className={styles.signOut} onClick={() => signOutTo("/owners/login")}>
          Sign out
        </button>
      </header>
      <nav className={styles.tabs} aria-label="Sections">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`${styles.tab} ${isOn(t.href) ? styles.tabOn : ""}`}
            aria-current={isOn(t.href) ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

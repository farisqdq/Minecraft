"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import styles from "./shell.module.css";

function IconHome(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3 10.2 12 3l9 7.2" />
      <path d="M5.6 9v11h12.8V9" />
      <path d="M10 20v-5.2h4V20" />
    </svg>
  );
}

function IconTeam(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M15.5 20v-1.6a3.8 3.8 0 0 0-3.8-3.8H6.3A3.8 3.8 0 0 0 2.5 18.4V20" />
      <circle cx="9" cy="7.2" r="3.4" />
      <path d="M21.5 20v-1.6a3.8 3.8 0 0 0-2.9-3.7" />
      <path d="M16.4 4a3.4 3.4 0 0 1 0 6.4" />
    </svg>
  );
}

function IconBackup(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="2.8" y="4" width="18.4" height="4.4" rx="1.4" />
      <path d="M4.8 8.4V19a1 1 0 0 0 1 1h12.4a1 1 0 0 0 1-1V8.4" />
      <path d="M10 12.4h4" />
    </svg>
  );
}

function IconExport(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 3.5v11" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 19.5h16" />
    </svg>
  );
}

const NAV = [
  { href: "/dashboard", label: "Overview", short: "Home", Icon: IconHome },
  { href: "/dashboard/team", label: "Team", short: "Team", Icon: IconTeam },
  { href: "/dashboard/backup", label: "Backup", short: "Backup", Icon: IconBackup },
  { href: "/dashboard/export", label: "Export", short: "Export", Icon: IconExport },
];

/**
 * Every signed-in page shares this frame so navigation never moves: a sticky
 * bar on desktop, and on a phone a bottom tab bar within thumb reach instead
 * of links buried in a header you have to scroll back up to.
 */
export default function AppShell({
  title,
  tagline,
  actions,
  back,
  userLabel,
  children,
}: {
  title: string;
  tagline?: string;
  actions?: ReactNode;
  back?: { href: string; label: string };
  userLabel?: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";

  // "/dashboard" must not light up for every page nested under it.
  const isOn = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <Link href="/dashboard" className={styles.brand}>
            <span className={styles.mark} aria-hidden="true">
              R
            </span>
            <span className={styles.brandFull}>Rent Roll</span>
            <span className={styles.brandShort}>Rent Roll</span>
          </Link>

          <nav className={styles.nav} aria-label="Sections">
            {NAV.map(({ href, label, Icon }) => (
              <Link key={href} href={href} className={`${styles.navLink} ${isOn(href) ? styles.on : ""}`}>
                <Icon className={styles.navIcon} />
                {label}
              </Link>
            ))}
          </nav>

          <span className={styles.spacer} />
          {userLabel && <span className={styles.who}>{userLabel}</span>}
          <button type="button" className={styles.signOut} onClick={() => signOut({ callbackUrl: "/login" })}>
            Sign out
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.pageHead}>
          <div>
            {back && (
              <Link href={back.href} className={styles.back}>
                ← {back.label}
              </Link>
            )}
            <h1>{title}</h1>
            {tagline && <p className={styles.tagline}>{tagline}</p>}
          </div>
          {actions && <div className={styles.headActions}>{actions}</div>}
        </div>
        {children}
      </main>

      <nav className={styles.tabBar} aria-label="Sections">
        {NAV.map(({ href, short, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`${styles.tab} ${isOn(href) ? styles.on : ""}`}
            aria-current={isOn(href) ? "page" : undefined}
          >
            <Icon className={styles.tabIcon} />
            {short}
          </Link>
        ))}
      </nav>
    </div>
  );
}

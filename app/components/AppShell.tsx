"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutTo } from "./sign-out";
import PropertySearch from "./PropertySearch";
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

function IconShield(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </svg>
  );
}

function IconCalendar(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4M16 3v4" />
      <path d="M8 14h2M14 14h2M8 17h2" />
    </svg>
  );
}

function IconRepairs(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14.1 6.5a3.9 3.9 0 0 0 5 5l-8.3 8.3a2 2 0 0 1-2.8 0l-2.2-2.2a2 2 0 0 1 0-2.8Z" />
      <path d="M14.1 6.5 17 3.6a4.4 4.4 0 0 1 3.4 3.4l-2.3 4.5" />
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
  { href: "/dashboard/calendar", label: "Calendar", short: "Calendar", Icon: IconCalendar },
  { href: "/dashboard/repairs", label: "Repairs", short: "Repairs", Icon: IconRepairs, badge: true },
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
  openRepairs = 0,
  children,
}: {
  title: string;
  tagline?: string;
  actions?: ReactNode;
  back?: { href: string; label: string };
  userLabel?: string;
  /** Unresolved repair requests, shown as a count on the Repairs tab. */
  openRepairs?: number;
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
            {NAV.map(({ href, label, Icon, badge }) => (
              <Link key={href} href={href} className={`${styles.navLink} ${isOn(href) ? styles.on : ""}`}>
                <Icon className={styles.navIcon} />
                {label}
                {badge && openRepairs > 0 && <span className={styles.badge}>{openRepairs}</span>}
              </Link>
            ))}
          </nav>

          <span className={styles.spacer} />
          <PropertySearch />
          {userLabel && (
            <Link href="/dashboard/account" className={styles.who} title="Account & security">
              {userLabel}
            </Link>
          )}
          <Link
            href="/dashboard/account"
            className={`${styles.accountBtn} ${isOn("/dashboard/account") ? styles.on : ""}`}
            aria-label="Account & security"
            title="Account & security"
          >
            <IconShield className={styles.accountIcon} />
          </Link>
          <button type="button" className={styles.signOut} onClick={() => signOutTo("/login")}>
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
        {NAV.map(({ href, short, Icon, badge }) => (
          <Link
            key={href}
            href={href}
            className={`${styles.tab} ${isOn(href) ? styles.on : ""}`}
            aria-current={isOn(href) ? "page" : undefined}
          >
            <span className={styles.tabIconWrap}>
              <Icon className={styles.tabIcon} />
              {badge && openRepairs > 0 && <span className={styles.tabBadge}>{openRepairs}</span>}
            </span>
            {short}
          </Link>
        ))}
      </nav>
    </div>
  );
}

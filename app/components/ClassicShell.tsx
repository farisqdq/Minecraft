"use client";

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { signOutTo } from "./sign-out";
import PropertySearch from "./PropertySearch";
import InstallBanner from "./InstallBanner";
import TabBar from "./TabBar";
import { useShellInfo } from "./ShellContext";
import { useViewOnly } from "./ViewOnly";
import { useLivePulse } from "./useLivePulse";
import { MESSAGES_READ_EVENT } from "./messages-client";
import styles from "./shell.module.css";

/** The pill beside a page title that opens its edit form. */
export function TitleEditButton({ label, onClick }: { label: string; onClick: () => void }) {
  if (useViewOnly()) return null;
  return (
    <button type="button" className={styles.titleEdit} onClick={onClick} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      Edit
    </button>
  );
}

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

function IconUser(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

function IconSettings(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
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

function IconAdmin(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h12M20 17h0" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="18" cy="17" r="2" />
    </svg>
  );
}

function IconFiles(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z" />
      <path d="M3.5 12h17" />
    </svg>
  );
}

function IconMessages(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4.5 3.5V16.5H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5Z" />
      <path d="M7.5 9.5h9M7.5 12.5h6" />
    </svg>
  );
}

/** Which count a tab carries: repairs waiting on you, or messages you haven't read. */
type Badge = "repairs" | "messages";

const NAV: {
  href: string;
  label: string;
  short: string;
  Icon: ComponentType<{ className?: string }>;
  badge?: Badge;
  adminOnly?: boolean;
}[] = [
  { href: "/dashboard", label: "Overview", short: "Home", Icon: IconHome },
  { href: "/dashboard/calendar", label: "Calendar", short: "Calendar", Icon: IconCalendar },
  { href: "/dashboard/repairs", label: "Repairs", short: "Repairs", Icon: IconRepairs, badge: "repairs" },
  { href: "/dashboard/messages", label: "Messages", short: "Inbox", Icon: IconMessages, badge: "messages" },
  { href: "/dashboard/files", label: "Files", short: "Files", Icon: IconFiles },
  { href: "/dashboard/team", label: "Team", short: "Team", Icon: IconTeam },
  { href: "/dashboard/backup", label: "Backup", short: "Backup", Icon: IconBackup },
  { href: "/dashboard/export", label: "Export", short: "Export", Icon: IconExport },
  // Site admins only; the layout says who those are.
  { href: "/dashboard/admin", label: "Admin", short: "Admin", Icon: IconAdmin, adminOnly: true },
];

/**
 * Every signed-in page shares this frame so navigation never moves: a sticky
 * bar on desktop, and on a phone a bottom tab bar within thumb reach instead
 * of links buried in a header you have to scroll back up to. The phone bar
 * swipes sideways and steps aside while reading; see TabBar.
 */
export type ShellProps = {
  title: string;
  tagline?: string;
  /** A small control that sits beside the title — "Edit" for the thing the page is about. */
  titleAction?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  userLabel?: string;
  /** Unresolved repair requests, shown as a count on the Repairs tab. */
  openRepairs?: number;
  children: ReactNode;
};

/**
 * The Classic layout's frame — the app exactly as it was before layouts
 * became a per-person choice. AppShell picks it (or another layout's shell).
 */
export default function ClassicShell({
  title,
  tagline,
  titleAction,
  actions,
  back,
  userLabel,
  openRepairs = 0,
  children,
}: ShellProps) {
  const pathname = usePathname() ?? "";
  const { data: session } = useSession();
  const who = userLabel || session?.user?.name || session?.user?.email || "";
  const accountLabel = who ? `${who} — account` : "Account";
  const { admin } = useShellInfo();
  const nav = NAV.filter((item) => !item.adminOnly || admin);

  // Unread messages, fetched here so no page has to know about them. It
  // rides on the repairs heartbeat at a gentle pace, and drops the moment
  // a thread page marks itself read.
  const [unreadMessages, setUnreadMessages] = useState(0);
  const refreshUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/messages/unread", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.count === "number") setUnreadMessages(data.count);
    } catch {
      // Offline: keep whatever the badge said.
    }
  }, []);
  useEffect(() => {
    void refreshUnread();
    window.addEventListener(MESSAGES_READ_EVENT, refreshUnread);
    return () => window.removeEventListener(MESSAGES_READ_EVENT, refreshUnread);
  }, [refreshUnread, pathname]);
  useLivePulse("/api/requests/pulse", refreshUnread, 30000);

  const countFor = (badge?: Badge) =>
    badge === "repairs" ? openRepairs : badge === "messages" ? unreadMessages : 0;

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

          <nav className={`${styles.nav} ${nav.length > 8 ? styles.navCrowded : ""}`} aria-label="Sections">
            {nav.map(({ href, label, Icon, badge }) => (
              <Link key={href} href={href} className={`${styles.navLink} ${isOn(href) ? styles.on : ""}`} title={label}>
                <Icon className={styles.navIcon} />
                <span className={styles.navLabel}>{label}</span>
                {countFor(badge) > 0 && <span className={styles.badge}>{countFor(badge)}</span>}
              </Link>
            ))}
          </nav>

          <span className={styles.spacer} />
          <PropertySearch />
          {/* On every page: pages that don't pass a name get it from the
              session, and failing both it's simply "Account". */}
          <Link
            href="/dashboard/account"
            className={`${styles.accountBtn} ${isOn("/dashboard/account") ? styles.on : ""}`}
            aria-label={accountLabel}
            title={accountLabel}
          >
            <IconUser className={styles.accountIcon} />
          </Link>
          {/* Settings lists Account & security, Appearance (where a Classic
              user can switch layouts) and the rest. */}
          <Link
            href="/dashboard/settings"
            className={`${styles.accountBtn} ${
              isOn("/dashboard/settings") || isOn("/dashboard/account") ? styles.on : ""
            }`}
            aria-label="Settings"
            title="Settings"
          >
            <IconSettings className={styles.accountIcon} />
          </Link>
          <button type="button" className={styles.signOut} onClick={() => signOutTo("/login")}>
            Sign out
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <InstallBanner audience="user" />
        <div className={styles.pageHead}>
          <div>
            {back && (
              <Link href={back.href} className={styles.back}>
                ← {back.label}
              </Link>
            )}
            {titleAction ? (
              <div className={styles.titleRow}>
                <h1>{title}</h1>
                {titleAction}
              </div>
            ) : (
              <h1>{title}</h1>
            )}
            {tagline && <p className={styles.tagline}>{tagline}</p>}
          </div>
          {actions && <div className={styles.headActions}>{actions}</div>}
        </div>
        {children}
      </main>

      <TabBar label="Sections">
        {nav.map(({ href, short, Icon, badge }) => (
          <Link
            key={href}
            href={href}
            className={`${styles.tab} ${isOn(href) ? styles.on : ""}`}
            aria-current={isOn(href) ? "page" : undefined}
          >
            <span className={styles.tabIconWrap}>
              <Icon className={styles.tabIcon} />
              {countFor(badge) > 0 && <span className={styles.tabBadge}>{countFor(badge)}</span>}
            </span>
            {short}
          </Link>
        ))}
      </TabBar>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutTo } from "./sign-out";
import PropertySearch from "./PropertySearch";
import InstallBanner from "./InstallBanner";
import TabBar from "./TabBar";
import Modal from "./Modal";
import { useShellInfo } from "./ShellContext";
import { useLivePulse } from "./useLivePulse";
import { MESSAGES_READ_EVENT } from "./messages-client";
import PageHeader from "./ui/PageHeader";
import OverflowMenu, { type MenuItem } from "./ui/OverflowMenu";
import {
  IconArchive,
  IconBell,
  IconBuilding,
  IconCalendar,
  IconChevronUpDown,
  IconDownload,
  IconFolder,
  IconGrid,
  IconKey,
  IconLogOut,
  IconMessage,
  IconOverview,
  IconPencil,
  IconShield,
  IconSidebar,
  IconSliders,
  IconUsers,
  IconWrench,
  type IconProps,
} from "./icons";
import styles from "./shell.module.css";

/** The small control beside a page title that opens its edit form. */
export function TitleEditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.titleEdit} onClick={onClick} aria-label={label} title={label}>
      <IconPencil size={14} />
      Edit
    </button>
  );
}

/** Which count a link carries: repairs waiting on you, or messages you haven't read. */
type Badge = "repairs" | "messages";

type NavItem = {
  href: string;
  label: string;
  /** The tab bar's shorter word, where it differs. */
  short?: string;
  Icon: ComponentType<IconProps>;
  badge?: Badge;
  adminOnly?: boolean;
};

/** The day-to-day places: the sidebar on a desktop. */
const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Overview", Icon: IconOverview },
  { href: "/dashboard/properties", label: "Properties", Icon: IconBuilding },
  { href: "/dashboard/calendar", label: "Calendar", Icon: IconCalendar },
  { href: "/dashboard/repairs", label: "Repairs", Icon: IconWrench, badge: "repairs" },
  { href: "/dashboard/messages", label: "Messages", Icon: IconMessage, badge: "messages" },
  { href: "/dashboard/files", label: "Files", Icon: IconFolder },
];

/** Settings and occasional tools: the account menu (desktop) and More (phone). */
const SETTINGS: NavItem[] = [
  { href: "/dashboard/team", label: "Team", Icon: IconUsers },
  { href: "/dashboard/owners", label: "Owners", Icon: IconKey },
  { href: "/dashboard/reminders", label: "Reminders", Icon: IconBell },
  // Site admins only; the layout says who those are.
  { href: "/dashboard/admin", label: "Admin", Icon: IconSliders, adminOnly: true },
  { href: "/dashboard/backup", label: "Backup", Icon: IconArchive },
  { href: "/dashboard/export", label: "Export", Icon: IconDownload },
  { href: "/dashboard/account", label: "Account & security", Icon: IconShield },
];

/** The phone's bottom bar: four places and More. */
const TABS = ["/dashboard", "/dashboard/properties", "/dashboard/repairs", "/dashboard/messages"];

const COLLAPSED_KEY = "rentroll.sidebar.collapsed";
const WIDE = "(min-width: 1024px)";

function initialsOf(name: string | null, email: string | null) {
  const src = (name || email || "?").trim();
  const words = src.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

/**
 * Every signed-in page shares this frame so navigation never moves.
 * Desktop (≥1024px): a left sidebar — the six day-to-day sections, with
 * settings and tools under the account menu at its foot; it folds to an
 * icon rail and remembers that. Smaller screens: a slim top bar and a
 * bottom tab bar (four sections + More, which opens a sheet with the rest).
 */
export default function AppShell({
  title,
  tagline,
  titleAction,
  actions,
  back,
  userLabel,
  openRepairs = 0,
  children,
}: {
  title: string;
  /** Factual context under the title only (an address, an email) — no taglines. */
  tagline?: string;
  /** A small control that sits beside the title — "Edit" for the thing the page is about. */
  titleAction?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  userLabel?: string;
  /** Unresolved repair requests, shown as a count on Repairs. */
  openRepairs?: number;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const { admin, name, email } = useShellInfo();
  const settings = SETTINGS.filter((item) => !item.adminOnly || admin);

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
    href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(`${href}/`);

  // The sidebar's folded state is a per-browser preference.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Storage blocked: start expanded.
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // Not remembered, but still folds.
      }
      return !c;
    });
  };

  // Which layout is live decides which search box answers ⌘K and "/".
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);

  const who = name || userLabel || email || "Account";
  const initials = initialsOf(name || userLabel || null, email);

  const accountItems: MenuItem[] = [
    ...settings.map((item) => ({ label: item.label, href: item.href, icon: item.Icon })),
    { label: "Sign out", icon: IconLogOut, destructive: true, onSelect: () => void signOutTo("/login") },
  ];

  const navLink = (item: NavItem) => {
    const count = countFor(item.badge);
    const on = isOn(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`${styles.navLink} ${on ? styles.on : ""}`}
        aria-current={on ? "page" : undefined}
        data-tip={item.label}
      >
        <item.Icon size={18} className={styles.navIcon} />
        <span className={styles.navLabel}>{item.label}</span>
        {count > 0 && (
          <span className={styles.badge} aria-label={`${count} ${item.badge === "repairs" ? "open" : "unread"}`}>
            {count}
          </span>
        )}
      </Link>
    );
  };

  const moreOn = !TABS.some((t) => isOn(t));

  return (
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ""}`}>
      <aside className={styles.sidebar} aria-label="Main">
        <div className={styles.sideTop}>
          <Link href="/dashboard" className={styles.brand} aria-label="Rent Roll — Overview">
            <span className={styles.mark} aria-hidden="true">
              R
            </span>
            <span className={styles.brandName}>Rent Roll</span>
          </Link>
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <IconSidebar size={18} />
          </button>
        </div>

        <div className={styles.sideSearch}>
          <PropertySearch variant="side" shortcuts={wide !== false} />
        </div>

        <nav className={styles.nav} aria-label="Sections">
          {PRIMARY.map(navLink)}
        </nav>

        <div className={styles.sideFoot}>
          <OverflowMenu
            label={`Account and settings — ${who}`}
            items={accountItems}
            align="start"
            triggerClassName={styles.account}
            menuClassName={styles.accountMenu}
            header={email ? <>Signed in as <strong>{email}</strong></> : undefined}
            trigger={
              <>
                <span className={styles.avatar} aria-hidden="true">
                  {initials}
                </span>
                <span className={styles.accountText}>
                  <span className={styles.accountName}>{who}</span>
                  {email && email !== who && <span className={styles.accountEmail}>{email}</span>}
                </span>
                <IconChevronUpDown size={16} className={styles.accountChevron} />
              </>
            }
          />
        </div>
      </aside>

      <header className={styles.topbar}>
        <Link href="/dashboard" className={styles.brand} aria-label="Rent Roll — Overview">
          <span className={styles.mark} aria-hidden="true">
            R
          </span>
          <span className={styles.brandName}>Rent Roll</span>
        </Link>
        <span className={styles.spacer} />
        <PropertySearch variant="bar" shortcuts={wide === false} />
        <Link
          href="/dashboard/account"
          className={styles.topAvatar}
          aria-label="Account & security"
          title="Account & security"
        >
          {initials}
        </Link>
      </header>

      <div className={styles.content}>
        <main className={styles.main}>
          <InstallBanner audience="user" />
          <PageHeader title={title} subtitle={tagline} back={back} titleAction={titleAction} actions={actions} />
          {children}
        </main>
      </div>

      <TabBar label="Sections">
        {PRIMARY.filter((item) => TABS.includes(item.href)).map((item) => {
          const count = countFor(item.badge);
          const on = isOn(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.tab} ${on ? styles.on : ""}`}
              aria-current={on ? "page" : undefined}
            >
              <span className={styles.tabIconWrap}>
                <item.Icon size={22} />
                {count > 0 && <span className={styles.tabBadge}>{count}</span>}
              </span>
              {item.short ?? item.label}
            </Link>
          );
        })}
        <button
          type="button"
          className={`${styles.tab} ${moreOn ? styles.on : ""}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <span className={styles.tabIconWrap}>
            <IconGrid size={22} />
          </span>
          More
        </button>
      </TabBar>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} email={email}>
        {[...PRIMARY.filter((item) => !TABS.includes(item.href)), ...settings].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.sheetRow} ${isOn(item.href) ? styles.on : ""}`}
            aria-current={isOn(item.href) ? "page" : undefined}
            // Moving to another page closes the sheet (see the pathname
            // effect); closing it here as well would race the navigation
            // with the sheet's own history.back().
            onClick={() => {
              if (isOn(item.href)) setMoreOpen(false);
            }}
          >
            <item.Icon size={20} />
            {item.label}
          </Link>
        ))}
        <button type="button" className={`${styles.sheetRow} ${styles.sheetDanger}`} onClick={() => void signOutTo("/login")}>
          <IconLogOut size={20} />
          Sign out
        </button>
      </MoreSheet>
    </div>
  );
}

/**
 * The phone's "More" sheet. A bottom sheet (Modal's phone form) that also
 * closes on the Back button: opening it adds a history entry carrying the
 * router's own state, so Back just pops it rather than leaving the page.
 */
function MoreSheet({
  open,
  onClose,
  email,
  children,
}: {
  open: boolean;
  onClose: () => void;
  email: string | null;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    let popped = false;
    try {
      window.history.pushState({ ...(window.history.state ?? {}), moreSheet: true }, "");
    } catch {
      return;
    }
    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed some other way (Escape, the scrim, a link): drop our entry,
      // unless a link has already moved the page on.
      if (!popped && window.history.state?.moreSheet) window.history.back();
    };
  }, [open]);

  return (
    <Modal open={open} title="More" subtitle={email ?? undefined} onClose={onClose} narrow>
      <nav className={styles.sheet} aria-label="More sections">
        {children}
      </nav>
    </Modal>
  );
}

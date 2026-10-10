"use client";

import { useCallback, useEffect, useId, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ShellProps } from "../../ClassicShell";
import PropertySearch from "../../PropertySearch";
import InstallBanner from "../../InstallBanner";
import OverflowMenu, { type MenuItem } from "../../ui/OverflowMenu";
import { signOutTo } from "../../sign-out";
import { useShellInfo } from "../../ShellContext";
import { useLivePulse } from "../../useLivePulse";
import { MESSAGES_READ_EVENT } from "../../messages-client";
import {
  IconArchive,
  IconBell,
  IconBuilding,
  IconCalendar,
  IconTrend,
  IconChevronDown,
  IconDownload,
  IconFolder,
  IconHome,
  IconLogOut,
  IconMessage,
  IconMore,
  IconKey,
  IconSettings,
  IconShield,
  IconSliders,
  IconUser,
  IconUsers,
  IconWrench,
  IconX,
  type IconProps,
} from "../../icons";
import { initialsOf, isNavOn } from "@/lib/layouts/ledger-nav";
import styles from "./ledger-shell.module.css";

type Badge = "repairs" | "messages";
type NavItem = { href: string; label: string; Icon: ComponentType<IconProps>; badge?: Badge; match?: string };

/**
 * The five sections that get a place in the bar. There is no properties
 * index page: the Overview's rent roll is the list of every property, so
 * "Properties" goes there and stays lit on any property page.
 */
const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Overview", Icon: IconHome },
  { href: "/dashboard#rent-roll", label: "Properties", Icon: IconBuilding, match: "/dashboard/properties" },
  { href: "/dashboard/repairs", label: "Repairs", Icon: IconWrench, badge: "repairs" },
  { href: "/dashboard/messages", label: "Messages", Icon: IconMessage, badge: "messages" },
  { href: "/dashboard/files", label: "Files", Icon: IconFolder },
];

const APPEARANCE_HREF = "/dashboard/settings/appearance";

/** Everything else, in the "More" menu (and the phone's More sheet). */
function secondary(admin: boolean): NavItem[] {
  return [
    { href: "/dashboard/calendar", label: "Calendar", Icon: IconCalendar },
    { href: "/dashboard/returns", label: "Returns", Icon: IconTrend },
    { href: "/dashboard/team", label: "Team", Icon: IconUsers },
    { href: "/dashboard/reminders", label: "Reminders", Icon: IconBell },
    { href: "/dashboard/backup", label: "Backup", Icon: IconArchive },
    { href: "/dashboard/export", label: "Export", Icon: IconDownload },
    ...(admin ? [{ href: "/dashboard/admin", label: "Admin", Icon: IconKey }] : []),
    { href: "/dashboard/account", label: "Account & security", Icon: IconShield },
    { href: "/dashboard/settings", label: "Settings", Icon: IconSettings },
  ];
}

/**
 * The Ledger layout's frame (Mercury-like): a slim top bar with five
 * sections, a More menu, search, a bell and the account menu; the page's
 * title row beneath it; content centred at a generous width. On a phone the
 * bar keeps only the brand, search, bell and avatar, and the sections move to
 * a bottom tab bar whose fifth tab opens a sheet with the rest.
 */
export default function LedgerShell({
  title,
  titleAction,
  actions,
  back,
  userLabel,
  openRepairs = 0,
  children,
}: ShellProps) {
  const pathname = usePathname() ?? "";
  const { admin } = useShellInfo();
  const more = secondary(admin);

  // Unread messages, exactly as the Classic frame fetches them: on load, on
  // every page change, when a thread marks itself read, and on the pulse.
  const [unread, setUnread] = useState(0);
  const refreshUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/messages/unread", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.count === "number") setUnread(data.count);
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

  const countFor = (badge?: Badge) => (badge === "repairs" ? openRepairs : badge === "messages" ? unread : 0);
  const on = (item: { href: string; match?: string }) => isNavOn(pathname, item.href, item.match);
  const moreOn = more.some(on);

  const [sheet, setSheet] = useState(false);
  useEffect(() => setSheet(false), [pathname]);

  const accountItems: MenuItem[] = [
    { label: "Account & security", icon: IconShield, href: "/dashboard/account" },
    { label: "Appearance", icon: IconSliders, href: APPEARANCE_HREF },
    { label: "Sign out", icon: IconLogOut, onSelect: () => void signOutTo("/login") },
  ];

  return (
    <div className={styles.shell}>

      <header className={styles.bar}>
        <div className={styles.barInner}>
          <Link href="/dashboard" className={styles.brand} aria-label="Rent Roll — Overview">
            <span className={styles.mark} aria-hidden="true">
              R
            </span>
            <span className={styles.brandName}>Rent Roll</span>
          </Link>

          <nav className={styles.nav} aria-label="Sections">
            {PRIMARY.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`${styles.navLink} ${on(item) ? styles.on : ""}`}
                aria-current={on(item) ? "page" : undefined}
              >
                {item.label}
                {countFor(item.badge) > 0 && (
                  <span className={styles.count} aria-label={`${countFor(item.badge)} ${item.badge === "repairs" ? "open" : "unread"}`}>
                    {countFor(item.badge)}
                  </span>
                )}
              </Link>
            ))}
            <OverflowMenu
              label="More sections"
              align="start"
              items={more.map((m) => ({ label: m.label, icon: m.Icon, href: m.href }))}
              triggerClassName={`${styles.navLink} ${styles.moreTrigger} ${moreOn ? styles.on : ""}`}
              trigger={
                <>
                  More <IconChevronDown size={14} />
                </>
              }
            />
          </nav>

          <span className={styles.spacer} />
          <div className={styles.searchWrap}>
            <PropertySearch />
          </div>
          <Bell repairs={openRepairs} unread={unread} />
          <OverflowMenu
            label="Account"
            items={accountItems}
            triggerClassName={styles.avatarBtn}
            header={
              userLabel ? (
                <div className={styles.who}>
                  <span className={styles.whoLabel}>Signed in as</span>
                  <span className={styles.whoName}>{userLabel}</span>
                </div>
              ) : undefined
            }
            trigger={
              <span className={styles.avatar} aria-hidden="true">
                {userLabel ? initialsOf(userLabel) : <IconUser size={16} />}
              </span>
            }
          />
        </div>
      </header>

      <main className={styles.main}>
        <InstallBanner audience="user" />
        <div className={styles.head}>
          <div className={styles.headText}>
            {back && (
              <Link href={back.href} className={styles.back}>
                ← {back.label}
              </Link>
            )}
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{title}</h1>
              {titleAction}
            </div>
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
        {children}
      </main>

      <nav className={styles.tabs} aria-label="Sections">
        {PRIMARY.slice(0, 4).map((item) => {
          const Icon = item.Icon;
          const n = countFor(item.badge);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`${styles.tab} ${on(item) ? styles.on : ""}`}
              aria-current={on(item) ? "page" : undefined}
            >
              <span className={styles.tabIcon}>
                <Icon size={22} />
                {n > 0 && <span className={styles.tabCount}>{n > 99 ? "99+" : n}</span>}
              </span>
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          className={`${styles.tab} ${sheet || moreOn || on(PRIMARY[4]) ? styles.on : ""}`}
          aria-haspopup="dialog"
          aria-expanded={sheet}
          onClick={() => setSheet(true)}
        >
          <span className={styles.tabIcon}>
            <IconMore size={22} />
          </span>
          More
        </button>
      </nav>

      {sheet && (
        <MoreSheet
          items={[PRIMARY[4], ...more]}
          isOn={on}
          userLabel={userLabel}
          onClose={() => setSheet(false)}
        />
      )}
    </div>
  );
}

/** Repairs waiting and messages unread, each a link to where they're dealt with. */
function Bell({ repairs, unread }: { repairs: number; unread: number }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const total = repairs + unread;
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = total
    ? `Notifications: ${repairs} open ${repairs === 1 ? "repair" : "repairs"}, ${unread} unread ${unread === 1 ? "message" : "messages"}`
    : "Notifications";

  return (
    <div ref={wrap} className={styles.bellWrap}>
      <button
        ref={button}
        type="button"
        className={styles.iconBtn}
        aria-label={label}
        title="Notifications"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <IconBell size={18} />
        {total > 0 && <span className={styles.bellDot}>{total > 99 ? "99+" : total}</span>}
      </button>
      {open && (
        <div id={id} className={styles.popover} role="dialog" aria-label="Notifications">
          <div className={styles.popHead}>Waiting on you</div>
          <Link href="/dashboard/repairs" className={styles.popRow} onClick={() => setOpen(false)}>
            <span className={styles.popIcon}>
              <IconWrench size={16} />
            </span>
            <span className={styles.popText}>
              <span className={styles.popTitle}>Repairs</span>
              <span className={styles.popSub}>
                {repairs ? `${repairs} open ${repairs === 1 ? "request" : "requests"}` : "Nothing open"}
              </span>
            </span>
            {repairs > 0 && <span className={styles.count}>{repairs}</span>}
          </Link>
          <Link href="/dashboard/messages" className={styles.popRow} onClick={() => setOpen(false)}>
            <span className={styles.popIcon}>
              <IconMessage size={16} />
            </span>
            <span className={styles.popText}>
              <span className={styles.popTitle}>Messages</span>
              <span className={styles.popSub}>
                {unread ? `${unread} unread` : "All read"}
              </span>
            </span>
            {unread > 0 && <span className={styles.count}>{unread}</span>}
          </Link>
          {total === 0 && <p className={styles.popEmpty}>You&apos;re all caught up.</p>}
        </div>
      )}
    </div>
  );
}

/** The phone's fifth tab: every section the tab bar has no room for. */
function MoreSheet({
  items,
  isOn,
  userLabel,
  onClose,
}: {
  items: NavItem[];
  isOn: (item: NavItem) => boolean;
  userLabel?: string;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [onClose]);

  return (
    <div className={styles.sheetScrim} onClick={onClose}>
      <div
        ref={panel}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="More"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.sheetHead}>
          <span className={styles.sheetTitle}>More</span>
          <button type="button" className={styles.iconBtn} aria-label="Close" onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>
        <div className={styles.sheetGrid}>
          {items.map((item) => {
            const Icon = item.Icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`${styles.sheetItem} ${isOn(item) ? styles.on : ""}`}
                onClick={onClose}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
        <div className={styles.sheetFoot}>
          {userLabel && <span className={styles.sheetWho}>{userLabel}</span>}
          <button type="button" className={styles.signOut} onClick={() => void signOutTo("/login")}>
            <IconLogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

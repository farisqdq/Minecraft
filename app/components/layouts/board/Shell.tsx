"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ShellProps } from "../../ClassicShell";
import { signOutTo } from "../../sign-out";
import PropertySearch from "../../PropertySearch";
import InstallBanner from "../../InstallBanner";
import Modal from "../../Modal";
import OverflowMenu, { type MenuItem } from "../../ui/OverflowMenu";
import { useShellInfo } from "../../ShellContext";
import { useLivePulse } from "../../useLivePulse";
import { MESSAGES_READ_EVENT } from "../../messages-client";
import {
  IconArchive,
  IconBuilding,
  IconCalendar,
  IconTrend,
  IconChevronLeft,
  IconDownload,
  IconFolder,
  IconGrid,
  IconLogOut,
  IconMessage,
  IconMore,
  IconShield,
  IconSettings,
  IconSliders,
  IconUsers,
  IconWrench,
  IconBell,
  IconKey,
  type IconProps,
} from "../../icons";
import styles from "./Shell.module.css";

type Badge = "repairs" | "messages";
type NavItem = { href: string; label: string; short: string; Icon: ComponentType<IconProps>; badge?: Badge };

/** The rail, top to bottom. Properties is the board's own list further down the Overview. */
const RAIL: NavItem[] = [
  { href: "/dashboard", label: "Overview", short: "Board", Icon: IconGrid },
  { href: "/dashboard#properties", label: "Properties", short: "Properties", Icon: IconBuilding },
  { href: "/dashboard/calendar", label: "Calendar", short: "Calendar", Icon: IconCalendar },
  { href: "/dashboard/returns", label: "Returns", short: "Returns", Icon: IconTrend },
  { href: "/dashboard/repairs", label: "Repairs", short: "Repairs", Icon: IconWrench, badge: "repairs" },
  { href: "/dashboard/messages", label: "Messages", short: "Inbox", Icon: IconMessage, badge: "messages" },
  { href: "/dashboard/files", label: "Files", short: "Files", Icon: IconFolder },
];

/** On a phone four of those sit in the tab bar; the rest live under More. */
const TABS = ["/dashboard", "/dashboard/calendar", "/dashboard/repairs", "/dashboard/messages"];

function settingsItems(admin: boolean): MenuItem[] {
  return [
    { label: "Appearance", href: "/dashboard/settings/appearance", icon: IconSliders },
    { label: "Team", href: "/dashboard/team", icon: IconUsers },
    { label: "Reminders", href: "/dashboard/reminders", icon: IconBell },
    { label: "Backup", href: "/dashboard/backup", icon: IconArchive },
    { label: "Export", href: "/dashboard/export", icon: IconDownload },
    ...(admin ? [{ label: "Admin", href: "/dashboard/admin", icon: IconKey }] : []),
    { label: "Account & security", href: "/dashboard/account", icon: IconShield },
  ];
}

const SETTINGS_PATHS = [
  "/dashboard/settings",
  "/dashboard/team",
  "/dashboard/reminders",
  "/dashboard/backup",
  "/dashboard/export",
  "/dashboard/admin",
  "/dashboard/account",
  "/dashboard/owners",
];

function initials(label?: string) {
  const words = (label ?? "").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words[0][0] + (words[1]?.[0] ?? "")).toUpperCase();
}

/**
 * The Status Board's frame: a dark icon rail down the left that stays dark in
 * either mode, so the page itself is all board. On a phone the rail becomes a
 * slim top bar and a five-slot tab bar in thumb reach, with everything that
 * didn't fit behind More.
 */
export default function BoardShell({ title, titleAction, actions, back, userLabel, openRepairs = 0, children }: ShellProps) {
  const pathname = usePathname() ?? "";
  const { admin } = useShellInfo();
  const [moreOpen, setMoreOpen] = useState(false);
  // One search box, in whichever bar is showing: two would both answer "/".
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Unread messages, exactly as the Classic frame fetches them: on load, on
  // each navigation, when a thread marks itself read, and on the repairs
  // heartbeat.
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

  // A route change closes the More sheet behind it.
  useEffect(() => setMoreOpen(false), [pathname]);

  const countFor = (badge?: Badge) => (badge === "repairs" ? openRepairs : badge === "messages" ? unread : 0);
  const isOn = (href: string) => {
    if (href.includes("#")) return false;
    return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
  };
  const settings = settingsItems(admin);
  const settingsOn = SETTINGS_PATHS.some((p) => pathname.startsWith(p));
  const tabs = TABS.map((href) => RAIL.find((r) => r.href === href)!);
  const moreOn = !tabs.some((t) => isOn(t.href));

  const badge = (n: number, cls: string) =>
    n > 0 ? (
      <span className={cls} aria-label={`${n} waiting`}>
        {n > 99 ? "99+" : n}
      </span>
    ) : null;

  const accountMenu: MenuItem[] = [
    { label: "Account & security", href: "/dashboard/account", icon: IconShield },
    { label: "Sign out", icon: IconLogOut, onSelect: () => void signOutTo("/login") },
  ];

  return (
    <div className={`${styles.shell}`}>
      <aside className={styles.rail} aria-label="Sections">
        <Link href="/dashboard" className={styles.mark} aria-label="Rent Roll — Overview">
          R
        </Link>
        <nav className={styles.railNav}>
          {RAIL.map(({ href, label, Icon, badge: b }) => (
            <Link
              key={href}
              href={href}
              className={`${styles.railLink} ${isOn(href) ? styles.on : ""}`}
              aria-label={countFor(b) > 0 ? `${label}, ${countFor(b)} waiting` : label}
              aria-current={isOn(href) ? "page" : undefined}
              data-tip={label}
            >
              <Icon size={20} />
              {badge(countFor(b), styles.railBadge)}
            </Link>
          ))}
        </nav>
        <div className={styles.railFoot}>
          <div className={styles.tipWrap} data-tip="Settings">
            <OverflowMenu
              items={settings}
              label="Settings"
              align="start"
              icon={IconSettings}
              trigger={<IconSettings size={20} />}
              triggerClassName={`${styles.railLink} ${settingsOn ? styles.on : ""}`}
              menuClassName={styles.railMenu}
            />
          </div>
          <div className={styles.tipWrap} data-tip={userLabel || "Account"}>
            <OverflowMenu
              items={accountMenu}
              label="Account"
              align="start"
              trigger={<span className={styles.avatar}>{initials(userLabel)}</span>}
              triggerClassName={styles.avatarBtn}
              menuClassName={styles.railMenu}
              header={userLabel ? <span className={styles.menuWho}>{userLabel}</span> : undefined}
            />
          </div>
        </div>
      </aside>

      <header className={styles.topbar}>
        <Link href="/dashboard" className={styles.topBrand}>
          <span className={styles.mark} aria-hidden="true">
            R
          </span>
          Rent Roll
        </Link>
        <span className={styles.spacer} />
        {phone && <PropertySearch />}
        <OverflowMenu
          items={accountMenu}
          label="Account"
          trigger={<span className={styles.avatar}>{initials(userLabel)}</span>}
          triggerClassName={styles.avatarBtn}
          header={userLabel ? <span className={styles.menuWho}>{userLabel}</span> : undefined}
        />
      </header>

      <div className={styles.main}>
        <div className={styles.page}>
          <InstallBanner audience="user" />
          <div className={styles.head}>
            <div className={styles.headText}>
              {back && (
                <Link href={back.href} className={styles.back}>
                  <IconChevronLeft size={16} />
                  {back.label}
                </Link>
              )}
              <div className={styles.titleRow}>
                <h1 className={styles.title}>{title}</h1>
                {titleAction}
              </div>
            </div>
            <div className={styles.headTools}>
              {!phone && <PropertySearch />}
              {actions && <div className={styles.actions}>{actions}</div>}
            </div>
          </div>
          {children}
        </div>
      </div>

      <nav className={styles.tabbar} aria-label="Sections">
        {tabs.map(({ href, short, Icon, badge: b }) => (
          <Link
            key={href}
            href={href}
            className={`${styles.tab} ${isOn(href) ? styles.on : ""}`}
            aria-current={isOn(href) ? "page" : undefined}
          >
            <span className={styles.tabIcon}>
              <Icon size={22} />
              {badge(countFor(b), styles.tabBadge)}
            </span>
            {short}
          </Link>
        ))}
        <button
          type="button"
          className={`${styles.tab} ${moreOn ? styles.on : ""}`}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
        >
          <span className={styles.tabIcon}>
            <IconMore size={22} />
          </span>
          More
        </button>
      </nav>

      <Modal open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <div className={styles.sheetGrid}>
          {[
            { href: "/dashboard#properties", label: "Properties", Icon: IconBuilding },
            { href: "/dashboard/files", label: "Files", Icon: IconFolder },
          ].map(({ href, label, Icon }) => (
            <Link key={href} href={href} className={styles.sheetLink} onClick={() => setMoreOpen(false)}>
              <Icon size={20} />
              {label}
            </Link>
          ))}
        </div>
        <div className={styles.sheetHead}>Settings</div>
        <div className={styles.sheetList}>
          {/* The same gear that opens Settings in every layout. */}
          <Link
            href="/dashboard/settings"
            className={`${styles.sheetRow} ${pathname === "/dashboard/settings" ? styles.sheetOn : ""}`}
            onClick={() => setMoreOpen(false)}
          >
            <IconSettings size={20} />
            All settings
          </Link>
          {settings.map(({ href, label, icon: Icon }) => (
            <Link
              key={label}
              href={href!}
              className={`${styles.sheetRow} ${href && pathname.startsWith(href) ? styles.sheetOn : ""}`}
              onClick={() => setMoreOpen(false)}
            >
              {Icon && <Icon size={20} />}
              {label}
            </Link>
          ))}
        </div>
        <div className={styles.sheetFoot}>
          {userLabel && <span className={styles.sheetWho}>{userLabel}</span>}
          <button type="button" className={styles.signOut} onClick={() => void signOutTo("/login")}>
            <IconLogOut size={18} />
            Sign out
          </button>
        </div>
      </Modal>
    </div>
  );
}

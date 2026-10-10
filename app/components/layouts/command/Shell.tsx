"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ShellProps } from "../../ClassicShell";
import { signOutTo } from "../../sign-out";
import InstallBanner from "../../InstallBanner";
import { useShellInfo } from "../../ShellContext";
import { useViewOnly } from "../../ViewOnly";
import { useLivePulse } from "../../useLivePulse";
import { MESSAGES_READ_EVENT } from "../../messages-client";
import OverflowMenu, { type MenuItem } from "../../ui/OverflowMenu";
import {
  IconArchive,
  IconBell,
  IconBuilding,
  IconCalendar,
  IconTrend,
  IconCar,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconDownload,
  IconFolder,
  IconGrid,
  IconKey,
  IconLogOut,
  IconMessage,
  IconMore,
  IconOverview,
  IconPlus,
  IconReceipt,
  IconShield,
  IconSidebar,
  IconSettings,
  IconUser,
  IconUsers,
  IconWrench,
  IconX,
  type IconProps,
} from "../../icons";
import { initialsOf } from "@/lib/layouts/command-search";
import { resolveCompany } from "@/lib/layouts/command-month";
import CommandSearch from "./CommandSearch";
import { setLlcSelection, useCommandPage, useLlcSelection, useShellCompanies } from "./context";
import styles from "./shell.module.css";

type Badge = "repairs" | "messages";
type NavItem = {
  href: string;
  label: string;
  Icon: ComponentType<IconProps>;
  badge?: Badge;
  /** Which paths light this item up. */
  match: (path: string, hash: string) => boolean;
};

// There is no properties index, tenants page or payments page on this app:
// Properties and Tenants land on the overview's properties table, Payments on
// its transactions tab. Each property page lights up Properties.
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", Icon: IconOverview, match: (p, h) => p === "/dashboard" && !h },
  {
    href: "/dashboard#properties",
    label: "Properties",
    Icon: IconBuilding,
    match: (p, h) => p.startsWith("/dashboard/properties") || (p === "/dashboard" && h === "#properties"),
  },
  { href: "/dashboard#tenants", label: "Tenants", Icon: IconUsers, match: (p, h) => p === "/dashboard" && h === "#tenants" },
  { href: "/dashboard#payments", label: "Payments", Icon: IconReceipt, match: (p, h) => p === "/dashboard" && h === "#payments" },
  { href: "/dashboard/calendar", label: "Calendar", Icon: IconCalendar, match: (p) => p.startsWith("/dashboard/calendar") },
  { href: "/dashboard/returns", label: "Returns", Icon: IconTrend, match: (p) => p.startsWith("/dashboard/returns") },
  { href: "/dashboard/mileage", label: "Mileage", Icon: IconCar, match: (p) => p.startsWith("/dashboard/mileage") },
  { href: "/dashboard/repairs", label: "Repairs", Icon: IconWrench, badge: "repairs", match: (p) => p.startsWith("/dashboard/repairs") },
  {
    href: "/dashboard/messages",
    label: "Messages",
    Icon: IconMessage,
    badge: "messages",
    match: (p) => p.startsWith("/dashboard/messages"),
  },
  { href: "/dashboard/files", label: "Files", Icon: IconFolder, match: (p) => p.startsWith("/dashboard/files") },
];

const SETTINGS: { href: string; label: string; Icon: ComponentType<IconProps>; adminOnly?: boolean }[] = [
  { href: "/dashboard/settings/appearance", label: "Appearance", Icon: IconGrid },
  { href: "/dashboard/team", label: "Team", Icon: IconUsers },
  { href: "/dashboard/reminders", label: "Reminders", Icon: IconBell },
  { href: "/dashboard/backup", label: "Backup", Icon: IconArchive },
  { href: "/dashboard/export", label: "Export", Icon: IconDownload },
  { href: "/dashboard/admin", label: "Admin", Icon: IconKey, adminOnly: true },
  { href: "/dashboard/account", label: "Account & security", Icon: IconShield },
];

// Phone tabs: the four most-used places, then everything else in More.
const TABS = ["/dashboard", "/dashboard#properties", "/dashboard/repairs", "/dashboard/messages"];

const RAIL_KEY = "rr-command-rail";

/** The URL hash, kept in step with in-page anchor jumps. */
function useHash() {
  const [hash, setHash] = useState("");
  const pathname = usePathname();
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [pathname]);
  return hash;
}

/**
 * The Command Center frame: a sidebar (LLC switcher, sections, settings and
 * the account) that folds to an icon rail, and a header bar with the page
 * title, the page's own controls, ⌘K search and "+ Record payment". On a
 * phone: a top bar and a bottom tab bar, with the rest in a More sheet.
 * Taglines are not shown in this layout.
 */
export default function CommandShell({ title, titleAction, actions, back, userLabel, openRepairs = 0, children }: ShellProps) {
  const pathname = usePathname() ?? "";
  const hash = useHash();
  const router = useRouter();
  const { admin } = useShellInfo();
  const viewOnly = useViewOnly();
  const page = useCommandPage();
  const companies = useShellCompanies();
  const stored = useLlcSelection();
  const llc = resolveCompany(stored, companies);
  const current = companies.find((c) => c.id === llc) ?? null;

  const [rail, setRail] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    try {
      setRail(window.localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      // No storage: start expanded.
    }
  }, []);
  function toggleRail() {
    setRail((r) => {
      try {
        window.localStorage.setItem(RAIL_KEY, r ? "0" : "1");
      } catch {
        // Only this visit remembers it.
      }
      return !r;
    });
  }

  // Unread messages, exactly as the Classic shell fetches them.
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

  useEffect(() => setMore(false), [pathname, hash]);

  const countFor = (badge?: Badge) => (badge === "repairs" ? openRepairs : badge === "messages" ? unreadMessages : 0);
  const settings = SETTINGS.filter((s) => !s.adminOnly || admin);
  const onSettings = settings.some((s) => pathname.startsWith(s.href));

  function pickLlc(id: string) {
    setLlcSelection(id);
    if (pathname !== "/dashboard") router.push(id === "all" ? "/dashboard" : `/dashboard?llc=${encodeURIComponent(id)}`);
  }

  const llcItems: MenuItem[] = [
    ...(companies.length > 1 ? [{ label: "All LLCs", icon: llc === "all" ? IconCheck : undefined, onSelect: () => pickLlc("all") }] : []),
    ...companies.map((c) => ({ label: c.name, icon: llc === c.id ? IconCheck : undefined, onSelect: () => pickLlc(c.id) })),
  ];
  const llcName = current?.name ?? (companies.length ? "All LLCs" : "Rent Roll");

  const recordButton = (compact: boolean) =>
    viewOnly ? null : page.onRecord ? (
      <button
        type="button"
        className={compact ? styles.iconBtnPrimary : styles.primaryBtn}
        onClick={page.onRecord}
        aria-label="Record payment"
      >
        <IconPlus size={compact ? 20 : 16} />
        {!compact && <span>Record payment</span>}
      </button>
    ) : (
      <Link
        href="/dashboard?record=rent"
        className={compact ? styles.iconBtnPrimary : styles.primaryBtn}
        aria-label="Record payment"
      >
        <IconPlus size={compact ? 20 : 16} />
        {!compact && <span>Record payment</span>}
      </Link>
    );

  const jumps = [
    ...NAV.map((n) => ({ href: n.href, label: n.label })),
    ...settings.map((s) => ({ href: s.href, label: s.label })),
  ];

  const navLink = (item: NavItem, extraClass = "") => {
    const on = item.match(pathname, hash);
    const count = countFor(item.badge);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`${styles.navLink} ${on ? styles.on : ""} ${extraClass}`}
        aria-current={on ? "page" : undefined}
        title={rail ? item.label : undefined}
      >
        <item.Icon size={18} className={styles.navIcon} />
        <span className={styles.navLabel}>{item.label}</span>
        {count > 0 && <span className={styles.count}>{count}</span>}
      </Link>
    );
  };

  return (
    <div className={`${styles.shell} ${rail ? styles.railMode : ""}`}>
      <aside className={styles.sidebar} aria-label="Sidebar">
        <div className={styles.sideTop}>
          <div className={styles.llcSlot}>
            <OverflowMenu
              items={llcItems}
              align="start"
              label={`LLC: ${llcName}. Switch LLC`}
              triggerClassName={styles.llcTrigger}
              trigger={
                <>
                  <span className={styles.llcMark} aria-hidden="true">
                    {initialsOf(llcName === "All LLCs" ? "All" : llcName).slice(0, 1)}
                  </span>
                  <span className={styles.llcName}>{llcName}</span>
                  <IconChevronDown size={14} className={styles.llcChevron} />
                </>
              }
            />
          </div>
          <button
            type="button"
            className={styles.railToggle}
            onClick={toggleRail}
            aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
            title={rail ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={rail}
          >
            <IconSidebar size={18} />
          </button>
        </div>

        <nav className={styles.nav} aria-label="Sections">
          {NAV.map((item) => navLink(item))}
        </nav>

        <div className={styles.sideBottom}>
          <div className={styles.menuSlot}>
            <OverflowMenu
              items={settings.map((s) => ({ label: s.label, icon: s.Icon, href: s.href }))}
              align="start"
              label="Settings"
              triggerClassName={`${styles.navLink} ${onSettings ? styles.on : ""}`}
              trigger={
                <>
                  <IconSettings size={18} className={styles.navIcon} />
                  <span className={styles.navLabel}>Settings</span>
                </>
              }
            />
          </div>
          <div className={styles.menuSlot}>
            <OverflowMenu
              align="start"
              label="Account"
              triggerClassName={styles.account}
              header={userLabel}
              items={[
                { label: "Account & security", icon: IconShield, href: "/dashboard/account" },
                { label: "Appearance", icon: IconGrid, href: "/dashboard/settings/appearance" },
                { label: "Sign out", icon: IconLogOut, onSelect: () => void signOutTo("/login") },
              ]}
              trigger={
                <>
                  <span className={styles.avatar} aria-hidden="true">
                    {userLabel ? initialsOf(userLabel) : <IconUser size={14} />}
                  </span>
                  <span className={styles.accountName}>{userLabel || "Account"}</span>
                </>
              }
            />
          </div>
        </div>
      </aside>

      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.headTitle}>
            {back && (
              <Link href={back.href} className={styles.back} aria-label={back.label} title={back.label}>
                <IconChevronLeft size={16} />
                <span className={styles.backLabel}>{back.label}</span>
              </Link>
            )}
            <h1 className={styles.title}>{title}</h1>
            {titleAction && <span className={styles.titleAction}>{titleAction}</span>}
          </div>
          <div className={styles.headRight}>
            {actions && <div className={styles.actions}>{actions}</div>}
            <CommandSearch jumps={jumps} />
            {recordButton(false)}
          </div>
        </header>

        <header className={styles.topbar}>
          {back ? (
            <Link href={back.href} className={styles.iconBtn} aria-label={back.label}>
              <IconChevronLeft size={20} />
            </Link>
          ) : (
            <span className={styles.topMark} aria-hidden="true">
              {initialsOf(llcName === "All LLCs" ? "All" : llcName).slice(0, 1)}
            </span>
          )}
          <span className={styles.topTitle}>{title}</span>
          <CommandSearch jumps={jumps} compact />
          {recordButton(true)}
        </header>

        <main className={styles.content}>
          {(titleAction || actions) && (
            <div className={styles.phoneHead}>
              {titleAction}
              {actions && <div className={styles.phoneActions}>{actions}</div>}
            </div>
          )}
          <InstallBanner audience="user" />
          {children}
        </main>
      </div>

      <nav className={styles.tabbar} aria-label="Sections">
        {TABS.map((href) => {
          const item = NAV.find((n) => n.href === href)!;
          const on = item.match(pathname, hash);
          const count = countFor(item.badge);
          return (
            <Link key={href} href={href} className={`${styles.tab} ${on ? styles.on : ""}`} aria-current={on ? "page" : undefined}>
              <span className={styles.tabIcon}>
                <item.Icon size={22} />
                {count > 0 && <span className={styles.tabCount}>{count}</span>}
              </span>
              {item.label}
            </Link>
          );
        })}
        <button type="button" className={`${styles.tab} ${more ? styles.on : ""}`} onClick={() => setMore(true)} aria-expanded={more}>
          <span className={styles.tabIcon}>
            <IconMore size={22} />
          </span>
          More
        </button>
      </nav>

      {more && (
        <div className={styles.sheetScrim} onClick={() => setMore(false)}>
          <div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label="More"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setMore(false)}
          >
            <div className={styles.sheetHead}>
              <span className={styles.sheetTitle}>More</span>
              <button type="button" className={styles.iconBtn} onClick={() => setMore(false)} aria-label="Close" autoFocus>
                <IconX size={20} />
              </button>
            </div>
            {companies.length > 1 && (
              <div className={styles.sheetGroup}>
                <div className={styles.sheetLabel}>LLC</div>
                <div className={styles.llcChips}>
                  {[{ id: "all", name: "All LLCs" }, ...companies].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`${styles.llcChip} ${llc === c.id ? styles.on : ""}`}
                      aria-pressed={llc === c.id}
                      onClick={() => {
                        pickLlc(c.id);
                        setMore(false);
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={styles.sheetGroup}>
              {NAV.filter((n) => !TABS.includes(n.href)).map((item) => navLink(item, styles.sheetLink))}
            </div>
            <div className={styles.sheetGroup}>
              <div className={styles.sheetLabel}>Settings</div>
              {/* The same gear that opens Settings in every layout. */}
              <Link
                href="/dashboard/settings"
                className={`${styles.navLink} ${styles.sheetLink} ${pathname === "/dashboard/settings" ? styles.on : ""}`}
              >
                <IconSettings size={18} className={styles.navIcon} />
                <span className={styles.navLabel}>All settings</span>
              </Link>
              {settings.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className={`${styles.navLink} ${styles.sheetLink} ${pathname.startsWith(s.href) ? styles.on : ""}`}
                >
                  <s.Icon size={18} className={styles.navIcon} />
                  <span className={styles.navLabel}>{s.label}</span>
                </Link>
              ))}
            </div>
            <div className={styles.sheetAccount}>
              <span className={styles.avatar} aria-hidden="true">
                {userLabel ? initialsOf(userLabel) : <IconUser size={14} />}
              </span>
              <span className={styles.accountName}>{userLabel || "Account"}</span>
              <button type="button" className={styles.signOut} onClick={() => void signOutTo("/login")}>
                <IconLogOut size={16} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

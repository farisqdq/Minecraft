import Link from "next/link";
import type { ReactNode } from "react";
import { IconChevronLeft } from "../icons";
import styles from "./PageHeader.module.css";

/**
 * The top of every page: title on the left, the page's actions on the right.
 *
 * `subtitle` is for factual context only — an address, an email, "moved out"
 * — never a tagline explaining what the page is for.
 */
export default function PageHeader({
  title,
  subtitle,
  back,
  titleAction,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** A link back up the hierarchy, shown above the title. */
  back?: { href: string; label: string };
  /** A small control that sits beside the title (e.g. "Edit"). */
  titleAction?: ReactNode;
  /** Buttons, right-aligned; the primary one goes last. */
  actions?: ReactNode;
  /** Anything that belongs to the header row below the title (tabs, filters). */
  children?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <div className={styles.titles}>
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
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {children}
    </header>
  );
}

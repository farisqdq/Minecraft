"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import ConfirmDialog, { type ConfirmRequest } from "../ConfirmDialog";
import { IconMore, type IconProps } from "../icons";
import styles from "./OverflowMenu.module.css";

export type MenuItem = {
  label: string;
  icon?: ComponentType<IconProps>;
  /** Runs on choose (after the confirmation, when there is one). */
  onSelect?: () => void;
  /** Makes the item a link instead. */
  href?: string;
  disabled?: boolean;
  /** Red, and listed after a divider. */
  destructive?: boolean;
  /**
   * Ask first, in the app's ConfirmDialog. Everything but onConfirm, which is
   * this item's onSelect.
   */
  confirm?: Omit<ConfirmRequest, "onConfirm">;
};

/**
 * "…" — the secondary actions for a row or card, so only the primary action
 * needs to be a visible button. A real menu: arrow keys move, Home/End jump,
 * Escape closes and hands focus back to the button, Tab leaves.
 */
export default function OverflowMenu({
  items,
  label = "More actions",
  align = "end",
  icon: Icon = IconMore,
  trigger,
  triggerClassName,
  menuClassName = "",
  header,
}: {
  items: MenuItem[];
  /** The button's accessible name — say what it's for: "Actions for 412 Maple St". */
  label?: string;
  align?: "start" | "end";
  icon?: ComponentType<IconProps>;
  /** Custom button content (e.g. an avatar and a name) instead of the "…" icon. */
  trigger?: ReactNode;
  triggerClassName?: string;
  menuClassName?: string;
  /** Non-interactive content at the top of the menu (e.g. who is signed in). */
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const regular = items.filter((i) => !i.destructive);
  const destructive = items.filter((i) => i.destructive);

  const focusItem = useCallback((index: number) => {
    const els = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    if (!els?.length) return;
    els[(index + els.length) % els.length].focus();
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  // Open upward when there's no room below (a row near the bottom of the screen).
  useLayoutEffect(() => {
    if (!open || !menu.current || !button.current) return;
    const b = button.current.getBoundingClientRect();
    const h = menu.current.offsetHeight;
    setUp(b.bottom + h + 12 > window.innerHeight && b.top - h - 12 > 0);
    focusItem(0);
  }, [open, focusItem]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open, close]);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(at - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(-1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  function choose(item: MenuItem) {
    if (item.disabled) return;
    close(false);
    if (item.confirm && item.onSelect) {
      setConfirming({ ...item.confirm, onConfirm: item.onSelect });
    } else {
      item.onSelect?.();
    }
  }

  const renderItem = (item: MenuItem) => {
    const Icon = item.icon;
    const cls = `${styles.item} ${item.destructive ? styles.danger : ""}`;
    const content = (
      <>
        {Icon && <Icon size={16} />}
        <span>{item.label}</span>
      </>
    );
    return item.href && !item.disabled ? (
      <Link key={item.label} href={item.href} role="menuitem" tabIndex={-1} className={cls} onClick={() => close(false)}>
        {content}
      </Link>
    ) : (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={cls}
        aria-disabled={item.disabled || undefined}
        onClick={() => choose(item)}
      >
        {content}
      </button>
    );
  };

  return (
    <div ref={wrap} className={styles.wrap}>
      <button
        ref={button}
        type="button"
        className={triggerClassName ?? styles.trigger}
        aria-label={label}
        title={trigger ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger ?? <Icon size={18} />}
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          className={`${styles.menu} ${align === "start" ? styles.start : styles.end} ${up ? styles.up : ""} ${menuClassName}`}
          onKeyDown={onMenuKey}
        >
          {header && <div className={styles.header}>{header}</div>}
          {regular.map(renderItem)}
          {regular.length > 0 && destructive.length > 0 && <div role="separator" className={styles.sep} />}
          {destructive.map(renderItem)}
        </div>
      )}
      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
    </div>
  );
}

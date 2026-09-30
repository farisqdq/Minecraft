"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { initialBarState, nextBarState } from "../../lib/nav-scroll";
import styles from "./shell.module.css";

/** Where the bottom bar is used instead of the sidebar (see shell.module.css). */
const COMPACT = "(max-width: 1023px)";

/**
 * The bottom tab bar on phones and tablets: five fixed tabs, and it tucks
 * itself away while the page is being read downward so the content gets the
 * whole screen. A pill stays at the bottom edge while it's away; tapping it,
 * scrolling back up, reaching the end of the page or moving to another page
 * all bring the bar back.
 *
 * On a desktop the bar is display:none and none of this runs.
 */
export default function TabBar({ label, children }: { label: string; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const navRef = useRef<HTMLElement>(null);
  const scrollState = useRef(initialBarState());
  const [visible, setVisible] = useState(true);

  const show = useCallback(() => {
    scrollState.current = initialBarState(window.scrollY);
    setVisible(true);
  }, []);

  // Vertical page scroll decides whether the bar is out. Passive listener,
  // one measurement per frame, and state only changes when the answer does.
  useEffect(() => {
    const compact = window.matchMedia(COMPACT);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = nextBarState(scrollState.current, {
        y: window.scrollY,
        viewport: window.innerHeight,
        content: document.documentElement.scrollHeight,
      });
      scrollState.current = next;
      setVisible(next.visible);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const sync = () => {
      window.removeEventListener("scroll", onScroll);
      scrollState.current = initialBarState(window.scrollY);
      setVisible(true);
      if (compact.matches) window.addEventListener("scroll", onScroll, { passive: true });
    };
    sync();
    compact.addEventListener("change", sync);
    return () => {
      compact.removeEventListener("change", sync);
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Off-screen links must not be tabbed to or read out. `inert` does both;
  // React 18 doesn't know the attribute, so it's set on the element.
  useEffect(() => {
    const nav = navRef.current;
    if (nav) nav.inert = !visible;
  }, [visible]);

  // Every navigation brings the bar back.
  useEffect(() => {
    show();
  }, [pathname, show]);

  const reveal = (e: MouseEvent<HTMLButtonElement>) => {
    show();
    // From a keyboard (Enter/Space report detail 0), carry focus into the
    // bar, since the pill is about to disappear from under it.
    if (e.detail === 0) {
      requestAnimationFrame(() => {
        const nav = navRef.current;
        (nav?.querySelector<HTMLElement>('[aria-current="page"]') ?? nav?.querySelector<HTMLElement>("a"))?.focus();
      });
    }
  };

  return (
    <>
      <nav
        ref={navRef}
        className={`${styles.tabBar} ${visible ? "" : styles.tabBarHidden}`}
        aria-label={label}
        // Belt and braces for browsers without `inert`: a focused link shows the bar.
        onFocus={show}
      >
        <div className={styles.tabRow}>{children}</div>
      </nav>
      <button
        type="button"
        className={`${styles.tabHandle} ${visible ? "" : styles.tabHandleOn}`}
        aria-label="Show navigation"
        aria-hidden={visible ? true : undefined}
        tabIndex={visible ? -1 : 0}
        onClick={reveal}
      >
        <span className={styles.tabHandlePill} aria-hidden="true" />
      </button>
    </>
  );
}

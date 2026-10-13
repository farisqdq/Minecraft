"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Fired by a page that has just dealt with something, so the bell catches up at once. */
export const NOTIFICATIONS_CHANGED_EVENT = "rentroll:notifications-changed";

export function IconBell(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9Z" />
      <path d="M10.3 20.5a1.9 1.9 0 0 0 3.4 0" />
    </svg>
  );
}

/**
 * The bell in the top bar (a34): opens the notification center, and carries
 * the number of things that need doing now. It asks for that number itself
 * — on load, on every page change, when the tab comes back into view, and
 * once a minute while it's showing — so no page has to pass it in.
 */
export default function NotificationBell({
  className,
  onClassName,
  iconClassName,
  badgeClassName,
}: {
  className?: string;
  onClassName?: string;
  iconClassName?: string;
  badgeClassName?: string;
}) {
  const pathname = usePathname() ?? "";
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/notifications?count=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.count === "number") setCount(data.count);
    } catch {
      // Offline: keep the last number.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    const onVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onVisible);
    };
  }, [refresh]);

  const on = pathname.startsWith("/dashboard/notifications");
  const label = count > 0 ? `Notifications — ${count} need${count === 1 ? "s" : ""} you` : "Notifications";
  return (
    <Link
      href="/dashboard/notifications"
      className={`${className ?? ""} ${on && onClassName ? onClassName : ""}`}
      aria-label={label}
      title={label}
      style={{ position: "relative" }}
    >
      <IconBell className={iconClassName} />
      {count > 0 && (
        <span
          className={badgeClassName}
          style={{
            position: "absolute",
            top: -5,
            right: -6,
            minWidth: 17,
            height: 17,
            padding: "0 4px",
            borderRadius: 999,
            background: "#d93025",
            color: "#fff",
            fontSize: 10.5,
            fontWeight: 700,
            lineHeight: "17px",
            textAlign: "center",
            boxShadow: "0 0 0 2px var(--surface, #fff)",
          }}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

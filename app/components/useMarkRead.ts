"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Call `onSeen` once the thing has actually been looked at: there is
 * something unread, the element is in the viewport, the tab is in front,
 * and all of that has held for a short pause.
 *
 * "Read" then means read, not merely delivered — which is the distinction
 * that matters if a conversation is ever produced as evidence. The pause
 * means a page you open and immediately leave doesn't count.
 *
 * Fires again only when `unread` changes, so a new message arriving on a
 * thread that's already on screen gets its own pause and its own stamp.
 * The "done it" flag is set when the request goes out, not when the timer
 * is scheduled — see PortalNotices for why: React remounts effects, and a
 * flag set up front would be seen by the second run and stop it.
 */
export function useMarkRead(
  ref: RefObject<HTMLElement | null>,
  unread: number,
  onSeen: () => void,
  delayMs = 2500
) {
  const seen = useRef(onSeen);
  useEffect(() => {
    seen.current = onSeen;
  });

  useEffect(() => {
    if (unread === 0) return;
    const el = ref.current;
    if (!el) return;
    let visible = false;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function fire() {
      if (done) return;
      done = true;
      seen.current();
    }

    function reconsider() {
      clearTimeout(timer);
      if (done) return;
      if (visible && document.visibilityState === "visible") timer = setTimeout(fire, delayMs);
    }

    // Older browsers without the observer: treat "mounted" as "visible".
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(
        (entries) => {
          visible = entries.some((e) => e.isIntersecting);
          reconsider();
        },
        { threshold: 0.25 }
      );
      observer.observe(el);
    } else {
      visible = true;
      reconsider();
    }
    document.addEventListener("visibilitychange", reconsider);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", reconsider);
    };
  }, [ref, unread, delayMs]);
}

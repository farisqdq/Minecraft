"use client";

import { useEffect, useRef } from "react";

/**
 * Watch a cheap "has anything changed" endpoint and call back when it has.
 *
 * Polling rather than a socket: this app runs on serverless functions, which
 * can't hold a connection open, and a hosted pub/sub service would be a bill
 * and a dependency for something a six-second fetch of two integers covers.
 *
 * The endpoint returns a short signature — counts and newest timestamps — so
 * the common answer is "same as last time" and nothing is re-fetched. The
 * first reply only records the signature; a callback then means a real change
 * since the page loaded.
 *
 * Polling stops while the tab is hidden, which is most of the time on a
 * phone, and fires once immediately when you come back to it — so picking the
 * phone up shows the new message straight away rather than up to six seconds
 * later.
 */
export function useLivePulse(url: string, onChanged: () => void, everyMs = 6000) {
  // Callers pass an inline function, so it's a new identity every render.
  // Holding it in a ref keeps the effect below from tearing the timer down
  // and rebuilding it on every keystroke elsewhere on the page.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  });

  const last = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (res.ok) {
            const { pulse } = await res.json();
            if (typeof pulse === "string") {
              if (last.current !== null && pulse !== last.current) changed.current();
              last.current = pulse;
            }
          }
        } catch {
          // Offline or a dropped request: say nothing and try again next tick.
        }
      }
      if (!stopped) timer = setTimeout(tick, everyMs);
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void tick();
      }
    }

    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [url, everyMs]);
}

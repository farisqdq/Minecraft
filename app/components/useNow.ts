"use client";

import { useEffect, useState } from "react";

/**
 * A clock that doesn't break hydration.
 *
 * Anything that renders "3 days ago" reads the current time, and a client
 * component is rendered twice — once on the server, once in the browser. The
 * two clocks are never identical, so reading `new Date()` directly makes the
 * second render disagree with the first and React throws the whole tree away
 * and rebuilds it. With a slow phone that is a visible flash; with a clock a
 * few minutes out it happens every single load.
 *
 * So the first render uses the timestamp the server rendered with, which both
 * sides agree on by definition, and the browser's own clock takes over on
 * mount — the same trick the dashboard already uses for today's date.
 *
 * `serverNow` is an ISO timestamp from the server component.
 */
export function useNow(serverNow: string) {
  const [now, setNow] = useState(() => new Date(serverNow));

  useEffect(() => {
    setNow(new Date());
  }, [serverNow]);

  return now;
}

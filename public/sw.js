/*
 * The service worker: the part of the site that stays installed on a phone
 * so a push notification can arrive while the site is closed. It does
 * nothing else — no caching, no offline pages — so an update to the site is
 * never served stale by it.
 *
 * Bump SW_VERSION with any change here: a changed file is what makes an
 * installed app swap in the new worker.
 */
const SW_VERSION = "2026-09-30.push-2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Whatever arrived — JSON from the site, plain text, or nothing at all — as a notification. */
function readPush(event) {
  if (!event.data) return {};
  try {
    const data = event.data.json();
    return data && typeof data === "object" ? data : { body: String(data) };
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

self.addEventListener("push", (event) => {
  // Everything happens inside waitUntil: a push handler that returns before
  // showing something is what gets a site's notifications throttled or
  // replaced by the browser's own "This site has been updated in the
  // background" message.
  event.waitUntil(
    (async () => {
      const data = readPush(event);
      const title = (typeof data.title === "string" && data.title) || "Rent Roll";
      const options = {
        body: typeof data.body === "string" ? data.body : "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: typeof data.url === "string" && data.url ? data.url : "/", v: SW_VERSION },
      };
      if (typeof data.tag === "string" && data.tag) {
        // A tag replaces the earlier notification with the same one; without
        // renotify the replacement arrives silently, so a second test (or a
        // second rent reminder) looked like nothing happened.
        options.tag = data.tag;
        options.renotify = true;
      }
      try {
        await self.registration.showNotification(title, options);
      } catch {
        // Some browsers refuse an option they don't know; show the plain version.
        await self.registration.showNotification(title, { body: options.body, data: options.data });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/";
  let url;
  try {
    url = new URL(raw, self.location.origin);
  } catch {
    url = new URL("/", self.location.origin);
  }
  event.waitUntil(
    (async () => {
      // A link to another site opens on its own; a page here reuses an open window.
      if (url.origin !== self.location.origin) return self.clients.openWindow(url.href);
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          const focused = await client.focus();
          if ("navigate" in (focused || client)) {
            try {
              await (focused || client).navigate(url.href);
            } catch {
              /* an uncontrolled window can't be navigated; it is focused at least */
            }
          }
          return focused;
        }
      }
      return self.clients.openWindow(url.href);
    })()
  );
});

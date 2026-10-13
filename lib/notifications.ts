/**
 * The notification center (a34): one list of everything waiting on the
 * landlord, gathered from the places it already lives — applications on a
 * listing, tenant messages, repair requests, documents running out, leases
 * ending. Nothing is stored twice: an item goes away when the thing behind
 * it is dealt with (the application decided, the thread read, the repair
 * seen, the document renewed).
 *
 * Client-safe: types and labels only. The queries are in notifications-db.
 */

export type NotificationKind = "application" | "message" | "repair" | "document" | "lease";

export type NotificationItem = {
  /** Stable across refreshes, so the list doesn't flicker. */
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  /** When it happened, or for a date-driven item, the date it's about. */
  at: string;
  href: string;
  /** Needs doing now. Counted on the bell; the rest is a heads-up. */
  action: boolean;
  urgent?: boolean;
};

export const KIND_LABEL: Record<NotificationKind, string> = {
  application: "Applications",
  message: "Messages",
  repair: "Repairs",
  document: "Documents",
  lease: "Leases",
};

/** Action items first, then newest. Date-driven items sort by how soon. */
export function sortNotifications(items: NotificationItem[]): NotificationItem[] {
  return [...items].sort((a, b) => {
    if (a.action !== b.action) return a.action ? -1 : 1;
    if (Boolean(a.urgent) !== Boolean(b.urgent)) return a.urgent ? -1 : 1;
    const datey = (k: NotificationKind) => k === "document" || k === "lease";
    if (datey(a.kind) && datey(b.kind)) return a.at.localeCompare(b.at);
    return b.at.localeCompare(a.at);
  });
}

export function actionCount(items: NotificationItem[]): number {
  return items.filter((i) => i.action).length;
}

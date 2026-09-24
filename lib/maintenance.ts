/** Shared vocabulary for maintenance requests, used by both sides. */

// Written for a mixed portfolio: houses and storefronts. "Parking lot" and
// "Signage" matter to a laundromat in a way they never do to a duplex, and a
// tenant who can't find their problem in the list picks the wrong one.
/**
 * Ceilings on what one tenant can send, so a compromised or angry account
 * can't bury the landlord's queue. Far above anything a real tenant does:
 * ten new reports in a day is a burst pipe, a broken lock and seven more.
 */
export const MAX_REPORTS_PER_DAY = 10;
export const MAX_MESSAGES_PER_HOUR = 30;

export const REQUEST_CATEGORIES = [
  "Plumbing",
  "Heating / AC",
  "Electrical",
  "Appliance",
  "Roof / leak",
  "Doors, windows & locks",
  "Pests",
  "Parking lot / exterior",
  "Signage",
  "Common area",
  "Other",
] as const;

export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

export function normalizeCategory(value: unknown): RequestCategory | null {
  if (typeof value !== "string") return null;
  const match = REQUEST_CATEGORIES.find((c) => c.toLowerCase() === value.trim().toLowerCase());
  return match ?? null;
}

export const STATUSES = ["open", "seen", "scheduled", "done", "declined"] as const;
export type RequestStatus = (typeof STATUSES)[number];

/**
 * What each status says to the two different people reading it. The tenant's
 * wording answers "is anyone doing anything"; the landlord's is a queue label.
 */
export const STATUS_LABEL: Record<RequestStatus, { tenant: string; landlord: string }> = {
  open: { tenant: "Sent — not looked at yet", landlord: "New" },
  seen: { tenant: "Your landlord has seen this", landlord: "Seen" },
  scheduled: { tenant: "Someone's booked to come out", landlord: "Scheduled" },
  done: { tenant: "Marked fixed", landlord: "Done" },
  declined: { tenant: "Closed without a repair", landlord: "Declined" },
};

/** Statuses that still need something from the landlord. */
export const OPEN_STATUSES: RequestStatus[] = ["open", "seen", "scheduled"];

export function isOpen(status: string) {
  return OPEN_STATUSES.includes(status as RequestStatus);
}

export function normalizeStatus(value: unknown): RequestStatus | null {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
    ? (value as RequestStatus)
    : null;
}

export const URGENCIES = ["normal", "urgent"] as const;
export type Urgency = (typeof URGENCIES)[number];

export const MAX_PHOTOS = 6;

export type RequestPhotoDTO = {
  id: string;
  url: string;
  filename: string;
  contentType: string;
};

export type RequestUpdateDTO = {
  id: string;
  /** "tenant" | "landlord" | "system" — decides which side of the thread it sits on. */
  from: "tenant" | "landlord" | "system";
  authorName: string;
  body: string;
  statusTo: RequestStatus | null;
  createdAt: string;
};

export type RequestDTO = {
  id: string;
  propertyId: string;
  propertyName: string;
  unitName: string;
  tenantName: string;
  title: string;
  detail: string;
  category: string;
  place: string;
  urgency: Urgency;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string;
  loggedAsExpense: boolean;
  photos: RequestPhotoDTO[];
  updates: RequestUpdateDTO[];
};

/** Trimmed text, capped, or "" — the same shape the tenant helpers use. */
export function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** "3 days ago", for a list where the exact minute never matters. */
export function ago(iso: string, now = new Date()) {
  const then = new Date(iso);
  const mins = Math.round((now.getTime() - then.getTime()) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

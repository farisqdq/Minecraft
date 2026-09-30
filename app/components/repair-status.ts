import type { Status } from "./ui/StatusBadge";

/**
 * One colour story for a repair's status, wherever it's shown (landlord list,
 * repair sheet, tenant portal): new = needs a look (amber), seen / scheduled
 * = in progress (accent), done = green, declined = closed (muted).
 */
export const REPAIR_BADGE: Record<string, Status> = {
  open: "partial",
  seen: "info",
  scheduled: "info",
  done: "paid",
  declined: "ended",
};

export function repairBadge(status: string): Status {
  return REPAIR_BADGE[status] ?? "neutral";
}

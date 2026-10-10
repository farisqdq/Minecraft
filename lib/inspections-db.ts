import type { Inspection, InspectionItem, InspectionPhoto, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fileLink } from "@/lib/file-links";
import {
  defaultItems,
  itemsFrom,
  normalizeCondition,
  normalizeKind,
  progress,
  statusOf,
  type Condition,
  type InspectionKind,
  type ItemDraft,
  type Progress,
  type Status,
} from "@/lib/inspections";

export type InspectionPhotoDTO = { id: string; url: string; filename: string; contentType: string };

export type InspectionItemDTO = {
  id: string;
  room: string;
  name: string;
  condition: Condition;
  note: string;
  position: number;
  photos: InspectionPhotoDTO[];
};

export type InspectionDTO = {
  id: string;
  tenantId: string;
  kind: InspectionKind;
  /** YYYY-MM-DD */
  inspectedOn: string;
  note: string;
  sharedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedName: string;
  tenantComment: string;
  items: InspectionItemDTO[];
};

/** One line per inspection, for a tenant's card. */
export type InspectionSummary = {
  id: string;
  kind: InspectionKind;
  inspectedOn: string;
  status: Status;
  progress: Progress;
};

export const inspectionInclude = {
  items: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { photos: { orderBy: { createdAt: "asc" } } } },
} as const satisfies Prisma.InspectionInclude;

type Full = Inspection & { items: (InspectionItem & { photos: InspectionPhoto[] })[] };

export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function serializeItem(i: InspectionItem & { photos: InspectionPhoto[] }): InspectionItemDTO {
  return {
    id: i.id,
    room: i.room,
    name: i.name,
    condition: normalizeCondition(i.condition),
    note: i.note ?? "",
    position: i.position,
    photos: i.photos.map(serializePhoto),
  };
}

export function serializePhoto(p: InspectionPhoto): InspectionPhotoDTO {
  return { id: p.id, url: fileLink("inspection", p.id), filename: p.filename, contentType: p.contentType };
}

export function serializeInspection(i: Full): InspectionDTO {
  return {
    id: i.id,
    tenantId: i.tenantId,
    kind: normalizeKind(i.kind) ?? "move_in",
    inspectedOn: dayOf(i.inspectedOn),
    note: i.note ?? "",
    sharedAt: i.sharedAt ? i.sharedAt.toISOString() : null,
    acknowledgedAt: i.acknowledgedAt ? i.acknowledgedAt.toISOString() : null,
    acknowledgedName: i.acknowledgedName ?? "",
    tenantComment: i.tenantComment ?? "",
    items: i.items.map(serializeItem),
  };
}

export function summarize(i: Inspection & { items: { condition: string }[] }): InspectionSummary {
  const dto = { sharedAt: i.sharedAt?.toISOString() ?? null, acknowledgedAt: i.acknowledgedAt?.toISOString() ?? null };
  return {
    id: i.id,
    kind: normalizeKind(i.kind) ?? "move_in",
    inspectedOn: dayOf(i.inspectedOn),
    status: statusOf(dto),
    progress: progress(i.items.map((x) => ({ condition: normalizeCondition(x.condition) }))),
  };
}

/** Every inspection for these tenants, oldest first, as card lines keyed by tenant id. */
export async function summariesFor(tenantIds: string[]): Promise<Record<string, InspectionSummary[]>> {
  if (tenantIds.length === 0) return {};
  const rows = await prisma.inspection.findMany({
    where: { tenantId: { in: tenantIds } },
    include: { items: { select: { condition: true } } },
    orderBy: [{ inspectedOn: "asc" }, { createdAt: "asc" }],
  });
  const out: Record<string, InspectionSummary[]> = {};
  for (const r of rows) (out[r.tenantId] ??= []).push(summarize(r));
  return out;
}

export async function loadInspection(id: string) {
  const row = await prisma.inspection.findUnique({ where: { id }, include: inspectionInclude });
  return row ? serializeInspection(row) : null;
}

/**
 * The move-in inspection a move-out one is compared with: the tenant's
 * latest move-in, acknowledged or not.
 */
export async function moveInFor(tenantId: string) {
  const row = await prisma.inspection.findFirst({
    where: { tenantId, kind: "move_in" },
    orderBy: [{ inspectedOn: "desc" }, { createdAt: "desc" }],
    include: inspectionInclude,
  });
  return row ? serializeInspection(row) : null;
}

/** The checklist a new inspection starts with. */
export async function startingItems(tenantId: string, kind: InspectionKind): Promise<ItemDraft[]> {
  if (kind === "move_out") {
    const moveIn = await moveInFor(tenantId);
    if (moveIn && moveIn.items.length > 0) return itemsFrom(moveIn.items);
  }
  return defaultItems();
}

/** The refusal every write gives once the tenant has signed. */
export function lockedMessage(acknowledgedAt: Date): string {
  const day = acknowledgedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `The tenant acknowledged this on ${day}, so it can't be changed. Start a new inspection if something needs recording.`;
}

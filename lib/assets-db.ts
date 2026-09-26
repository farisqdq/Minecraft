import type { DepreciableAsset } from "@prisma/client";
import { normalizeClass, type AssetClass } from "@/lib/depreciation";

export type AssetDTO = {
  id: string;
  propertyId: string;
  kind: "building" | "improvement";
  label: string;
  cls: AssetClass;
  basis: number;
  inService: string;
  note: string;
};

export function serializeAsset(a: DepreciableAsset): AssetDTO {
  return {
    id: a.id,
    propertyId: a.propertyId,
    kind: a.kind === "improvement" ? "improvement" : "building",
    label: a.label,
    cls: normalizeClass(a.cls),
    basis: a.basis,
    inService: a.inService,
    note: a.note ?? "",
  };
}

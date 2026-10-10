import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { requireInspection } from "@/lib/access";
import { loadInspection, moveInFor } from "@/lib/inspections-db";
import InspectionReport from "../../../../components/InspectionReport";
import PrintButton from "../../../move-outs/[id]/PrintButton";
import styles from "../../../move-outs/[id]/statement.module.css";

/** The inspection laid out to print or save as a PDF — for the file, or for a tenant to sign on paper. */
export default async function InspectionReportPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const { id } = await params;
  const found = await requireInspection(userId, id, "viewer");
  if (!found) notFound();
  const tenant = found.tenant;

  const [inspection, company, unit] = await Promise.all([
    loadInspection(id),
    prisma.company.findUnique({ where: { id: tenant.property.companyId } }),
    tenant.unitId ? prisma.unit.findUnique({ where: { id: tenant.unitId }, select: { name: true } }) : null,
  ]);
  if (!inspection) notFound();
  const moveIn = inspection.kind === "move_out" ? await moveInFor(tenant.id) : null;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Link href={`/dashboard/inspections/${id}`}>&larr; Back to the inspection</Link>
        <PrintButton />
      </div>
      <InspectionReport
        inspection={inspection}
        moveIn={moveIn && moveIn.id !== inspection.id ? moveIn : null}
        companyName={company?.name ?? ""}
        companyContact={[company?.contactPhone, company?.contactEmail].filter((x): x is string => Boolean(x))}
        tenantName={tenant.name}
        placeLabel={[tenant.property.name, unit?.name].filter(Boolean).join(", ")}
        address={tenant.property.address ?? ""}
      />
    </div>
  );
}

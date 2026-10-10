import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { inspectionInclude, moveInFor, serializeInspection } from "@/lib/inspections-db";
import InspectionReport from "../../../components/InspectionReport";
import PortalShell from "../../PortalShell";
import Acknowledge from "./Acknowledge";
import styles from "../../portal.module.css";

export const dynamic = "force-dynamic";

/** A shared inspection, read-only, with the sign-off underneath until it's given. */
export default async function PortalInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantSession();
  if (!me) redirect("/portal/login");
  const { id } = await params;

  // Theirs, and shared: nothing else exists as far as this page is concerned.
  const row = await prisma.inspection.findFirst({
    where: { id, tenantId: me.tenant.id, sharedAt: { not: null } },
    include: inspectionInclude,
  });
  if (!row) notFound();
  const inspection = serializeInspection(row);
  const moveIn = inspection.kind === "move_out" ? await moveInFor(me.tenant.id) : null;
  const { property, unit } = me;

  return (
    <PortalShell who={me.tenant.name}>
      <p style={{ margin: "4px 0 16px" }}>
        <Link href="/portal" className={styles.factLabel} style={{ fontSize: 14, fontWeight: 600 }}>
          &larr; Back
        </Link>
      </p>
      <InspectionReport
        inspection={inspection}
        // Compared only with a move-in they were shown: their own record of it.
        moveIn={moveIn && moveIn.id !== inspection.id && moveIn.sharedAt ? moveIn : null}
        companyName={property.company.name}
        companyContact={[property.company.contactPhone, property.company.contactEmail].filter((x): x is string => Boolean(x))}
        tenantName={me.tenant.name}
        placeLabel={[property.name, unit?.name].filter(Boolean).join(", ")}
        address={property.address ?? ""}
        paperSignature={false}
      />
      {!inspection.acknowledgedAt && <Acknowledge inspectionId={inspection.id} tenantName={me.tenant.name} />}
    </PortalShell>
  );
}

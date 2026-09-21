import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { blobConfigured } from "@/lib/blob";
import { formatPhone, isoDay, leaseRange, leaseStatus, ordinal, smsHref, telHref } from "@/lib/lease";
import { money } from "@/lib/money";
import { requestInclude, serializeRequest } from "@/lib/requests";
import PortalShell from "./PortalShell";
import PortalRequests from "./PortalRequests";
import styles from "./portal.module.css";

export const dynamic = "force-dynamic";

export default async function PortalHome() {
  // Everything below comes from this one call, which resolves the tenant from
  // the session. No id is read from the URL, so there is no id to tamper with.
  const me = await requireTenantSession();
  if (!me) redirect("/portal/login");

  const { tenant, property, unit } = me;
  // A dispatch line or an office inbox the LLC chose to publish — never a
  // person's own details. Either can be blank; both blank and there is no
  // card at all.
  const contactPhone = property.company.contactPhone ?? "";
  const contactEmail = property.company.contactEmail ?? "";

  // Only this tenant's own reports, scoped by the session.
  const requests = await prisma.maintenanceRequest.findMany({
    where: { tenantId: tenant.id },
    include: requestInclude,
    orderBy: { createdAt: "desc" },
  });

  const status = leaseStatus(
    {
      active: tenant.active,
      dueDay: tenant.dueDay,
      leaseStart: tenant.leaseStart ? isoDay(tenant.leaseStart) : "",
      leaseEnd: tenant.leaseEnd ? isoDay(tenant.leaseEnd) : "",
    },
    new Date()
  );

  return (
    <PortalShell who={tenant.name}>
      <div className={styles.head}>
        <h1>{property.name}</h1>
        <p>{[unit?.name, property.address].filter(Boolean).join(" · ")}</p>
        <span className={`${styles.pill} ${status.kind === "ending" ? styles.warn : ""}`}>
          {status.label}
        </span>
      </div>

      {/* Reporting first. It is the reason a tenant has this login at all, and
          burying it under the lease details would make them scroll for it. */}
      <PortalRequests
        initial={requests.map(serializeRequest)}
        storageReady={blobConfigured()}
        serverNow={new Date().toISOString()}
        emergencyPhone={contactPhone}
      />

      {(contactPhone || contactEmail) && (
        <section className={styles.card}>
          <h2>Who to contact</h2>
          <div className={styles.facts} style={{ marginBottom: 14 }}>
            <div className={styles.fact}>
              <span className={styles.factLabel}>Managed by</span>
              <span className={styles.factValue}>{property.company.name}</span>
            </div>
          </div>
          <div className={styles.contactRow}>
            {contactPhone && telHref(contactPhone) && (
              <>
                <a className={styles.contactBtn} href={telHref(contactPhone)}>
                  Call {formatPhone(contactPhone)}
                </a>
                <a className={styles.contactBtn} href={smsHref(contactPhone)}>
                  Text
                </a>
              </>
            )}
            {contactEmail && (
              <a className={styles.contactBtn} href={`mailto:${contactEmail}`}>
                Email {contactEmail}
              </a>
            )}
          </div>
        </section>
      )}

      <section className={styles.card}>
        <h2>Your lease</h2>
        <div className={styles.facts}>
          <div className={styles.fact}>
            <span className={styles.factLabel}>Term</span>
            <span className={styles.factValue}>
              {leaseRange(
                tenant.leaseStart ? isoDay(tenant.leaseStart) : "",
                tenant.leaseEnd ? isoDay(tenant.leaseEnd) : ""
              )}
            </span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factLabel}>Rent is due</span>
            <span className={styles.factValue}>the {ordinal(tenant.dueDay)} of the month</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factLabel}>Deposit held</span>
            <span className={styles.factValue}>{money(tenant.deposit)}</span>
          </div>
        </div>
      </section>
    </PortalShell>
  );
}

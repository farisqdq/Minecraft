import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { isoDay, leaseRange, leaseStatus, ordinal, telHref } from "@/lib/lease";
import { money } from "@/lib/money";
import PortalShell from "./PortalShell";
import styles from "./portal.module.css";

export const dynamic = "force-dynamic";

export default async function PortalHome() {
  // Everything below comes from this one call, which resolves the tenant from
  // the session. No id is read from the URL, so there is no id to tamper with.
  const me = await requireTenantSession();
  if (!me) redirect("/portal/login");

  const { tenant, property, unit } = me;

  // Who to shout at when the roof leaks: an owner of the LLC that holds the
  // property. Members can record payments but aren't the people to call.
  const landlord = await prisma.companyMember.findFirst({
    where: { company: { properties: { some: { id: property.id } } }, role: "owner" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { name: true, email: true } } },
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
        <p>
          {[unit?.name, property.address].filter(Boolean).join(" · ") ||
            `Managed by ${property.company.name}`}
        </p>
        <span className={`${styles.pill} ${status.kind === "ending" ? styles.warn : ""}`}>
          {status.label}
        </span>
      </div>

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

      <section className={styles.card}>
        <h2>Who to contact</h2>
        <div className={styles.facts} style={{ marginBottom: 14 }}>
          <div className={styles.fact}>
            <span className={styles.factLabel}>Managed by</span>
            <span className={styles.factValue}>{property.company.name}</span>
          </div>
          {landlord?.user.name && (
            <div className={styles.fact}>
              <span className={styles.factLabel}>Your landlord</span>
              <span className={styles.factValue}>{landlord.user.name}</span>
            </div>
          )}
        </div>
        <div className={styles.contactRow}>
          {landlord?.user.email && (
            <a className={styles.contactBtn} href={`mailto:${landlord.user.email}`}>
              Email {landlord.user.email}
            </a>
          )}
          {tenant.phone && telHref(tenant.phone) && (
            <span className={styles.contactBtn}>We have you on {tenant.phone}</span>
          )}
        </div>
      </section>

      <section className={styles.card}>
        <h2>Report a problem</h2>
        <p className={styles.soon}>
          Reporting a repair from here — with photos, and a status you can watch — is the next
          thing being built. Until it lands, call or email{" "}
          {landlord?.user.name ?? property.company.name} using the details above.
        </p>
      </section>
    </PortalShell>
  );
}

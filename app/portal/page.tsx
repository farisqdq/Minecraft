import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { blobConfigured } from "@/lib/blob";
import { formatDay, formatPhone, isoDay, leaseRange, leaseStatus, ordinal, smsHref, telHref } from "@/lib/lease";
import { money } from "@/lib/money";
import { requestInclude, serializeRequest } from "@/lib/requests";
import { statementForTenant } from "@/lib/statements";
import { monthName } from "@/lib/notices";
import PortalShell from "./PortalShell";
import PortalRequests from "./PortalRequests";
import PortalNotices from "./PortalNotices";
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

  const notices = await prisma.tenantNotice.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  // Only this tenant's own reports, scoped by the session.
  const requests = await prisma.maintenanceRequest.findMany({
    where: { tenantId: tenant.id },
    include: requestInclude,
    orderBy: { createdAt: "desc" },
  });

  // Their own account. Shown only when the books rest on something — see
  // `grounded` in lib/statements.ts. A tenant should never be told they owe
  // money because a ledger happens to be empty.
  const account = await statementForTenant(tenant.id);
  const showAccount = Boolean(
    account && account.grounded && !account.problem && account.statement.rows.length > 0
  );

  // Only documents filed against this tenant AND switched on for the portal.
  // Both conditions are in the query — nothing is fetched and then hidden.
  const sharedDocs = await prisma.document.findMany({
    where: { tenantId: tenant.id, shared: true },
    select: { id: true, title: true, kind: true, url: true, expiresOn: true },
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

      {/* Anything the landlord has asked for goes above everything else — a
          rent chase is the one thing here that needs acting on today. */}
      <PortalNotices
        serverNow={new Date().toISOString()}
        initial={notices.map((n) => ({
          id: n.id,
          kind: n.kind === "note" ? ("note" as const) : ("rent" as const),
          month: n.month ?? "",
          amount: n.amount ?? 0,
          body: n.body,
          // Never the landlord's name: the tenant deals with the company.
          sentBy: "",
          createdAt: n.createdAt.toISOString(),
          readAt: n.readAt ? n.readAt.toISOString() : "",
        }))}
      />

      {/* Reporting next. It is the reason a tenant has this login at all, and
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

      {showAccount && account && (() => {
        const owed = account.statement.balance;
        const state = owed > 0.005 ? "behind" : owed < -0.005 ? "credit" : "square";
        // The last half-year is what anyone actually checks. Older months are
        // still in the running total, so the figure stays right.
        const recent = account.statement.rows.slice(-6);
        const labelsFor = (month: string) =>
          account.charges
            .filter((c) => c.month === month)
            .map((c) => `${c.kind === "credit" ? "less " : ""}${c.label}`)
            .join(", ");
        return (
          <section className={styles.card}>
            <h2>Your account</h2>
            <div className={styles.balanceHead}>
              <span
                className={`${styles.balanceFigure} ${
                  state === "behind" ? styles.balanceOwing : ""
                }`}
              >
                {state === "square" ? "You\u2019re paid up" : money(Math.abs(owed))}
              </span>
              <span className={styles.factLabel}>
                {state === "behind"
                  ? account.statement.behindSince
                    ? `outstanding, going back to ${monthName(account.statement.behindSince)}`
                    : "outstanding"
                  : state === "credit"
                    ? "in credit \u2014 this comes off your next rent"
                    : "nothing outstanding"}
              </span>
            </div>
            <table className={styles.months}>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Charged</th>
                  <th>Paid</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.month}>
                    <td>
                      {monthName(r.month)}
                      {/* A month where the charge isn't just rent says why.
                          An unexplained extra $200 is a phone call. */}
                      {labelsFor(r.month) && (
                        <span className={styles.monthWhy}>{labelsFor(r.month)}</span>
                      )}
                    </td>
                    <td>{money(r.rent + r.fees - r.credits)}</td>
                    <td>{r.paid ? money(r.paid) : "\u2014"}</td>
                    <td className={r.balance > 0.005 ? styles.balanceOwing : ""}>
                      {r.balance < -0.005 ? "\u2212" : ""}
                      {money(Math.abs(r.balance))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.accountNote}>
              This is what your landlord has recorded. If a payment you made isn&apos;t here,
              get in touch rather than paying it again.
            </p>
          </section>
        );
      })()}

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

      {sharedDocs.length > 0 && (
        <section className={styles.card}>
          <h2>Your documents</h2>
          <ul className={styles.docList}>
            {sharedDocs.map((d) => (
              <li key={d.id}>
                <a href={d.url} target="_blank" rel="noopener noreferrer">
                  {d.title}
                </a>
                <span className={styles.factLabel}>
                  {d.kind}
                  {d.expiresOn ? ` · valid through ${formatDay(d.expiresOn.toISOString().slice(0, 10))}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PortalShell>
  );
}

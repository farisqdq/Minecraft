import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOwnerSession } from "@/lib/owner-access";
import { OPEN_STATUSES } from "@/lib/maintenance";
import { fileLink } from "@/lib/file-links";
import { FileLink } from "../components/FileViewer";
import { formatDay } from "@/lib/lease";
import { money } from "@/lib/money";
import { monthName } from "@/lib/notices";
import { OWNER_STATUS_LABEL, monthKeyOf, occupancy, rentRollFor, requestForOwner, totalsFor, vacantForLabel } from "@/lib/owners";
import { ownerTransactions } from "@/lib/owners-db";
import { ago } from "@/lib/maintenance";
import OwnerShell from "./OwnerShell";
import styles from "./owners.module.css";

export const dynamic = "force-dynamic";

export default async function OwnerHome() {
  // Everything below comes from this one call, which resolves the owner
  // from the session. No id is read from the URL, so there is no id to
  // tamper with; every query is filtered by `me.propertyIds`.
  const me = await requireOwnerSession();
  if (!me) redirect("/owners/login");
  const ids = me.propertyIds;
  const now = new Date();
  const thisMonth = monthKeyOf(now);

  const [properties, units, tenants, openRequests, docs, txns] = await Promise.all([
    prisma.property.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, address: true, monthlyRent: true, vacant: true, vacantSince: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.unit.findMany({
      where: { propertyId: { in: ids } },
      select: { id: true, propertyId: true, name: true, monthlyRent: true, vacant: true, vacantSince: true },
      orderBy: { createdAt: "asc" },
    }),
    // Only the columns the privacy rule (occupantForOwner) reads. Phone,
    // email, deposit and notes are never fetched here, let alone shown.
    prisma.tenant.findMany({
      where: { propertyId: { in: ids }, active: true },
      select: { propertyId: true, unitId: true, name: true, leaseEnd: true, active: true },
    }),
    prisma.maintenanceRequest.findMany({
      where: { propertyId: { in: ids }, status: { in: OPEN_STATUSES } },
      select: {
        id: true,
        propertyId: true,
        title: true,
        category: true,
        status: true,
        urgency: true,
        createdAt: true,
        property: { select: { name: true } },
        unit: { select: { name: true } },
      },
      orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
    }),
    // Both conditions are in the query — nothing is fetched and then hidden.
    prisma.document.findMany({
      where: { propertyId: { in: ids }, sharedWithOwners: true },
      select: {
        id: true,
        title: true,
        kind: true,
        expiresOn: true,
        createdAt: true,
        filename: true,
        contentType: true,
        property: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    ownerTransactions(ids, new Date(Date.UTC(now.getUTCFullYear(), 0, 1))),
  ]);

  const roll = properties.map((p) => ({
    property: p,
    rows: rentRollFor(
      { ...p, name: p.name },
      units.filter((u) => u.propertyId === p.id),
      tenants
    ),
  }));
  const all = occupancy(roll.flatMap((r) => r.rows));
  const month = totalsFor(txns, thisMonth);
  const ytd = totalsFor(txns, thisMonth.slice(0, 4));
  const orderedRequests = openRequests.map(requestForOwner);

  return (
    <OwnerShell who={me.name}>
      <div className={styles.head}>
        <h1>{properties.length === 1 ? properties[0].name : `${properties.length} properties`}</h1>
        <p>
          {properties.length === 1
            ? properties[0].address || me.properties[0]?.companyName
            : properties.map((p) => p.name).join(" · ")}
        </p>
      </div>

      {properties.length === 0 ? (
        <section className={styles.card}>
          <h2>Nothing to show yet</h2>
          <p className={styles.empty}>
            You don&apos;t have access to any properties right now. The landlord who invited you can assign some
            from their side.
          </p>
        </section>
      ) : (
        <>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>At a glance</h2>
              <span className={styles.sub}>{monthName(thisMonth)}</span>
            </div>
            <div className={styles.tiles}>
              <div className={styles.tile}>
                <div className={styles.tileLabel}>Occupancy</div>
                <div className={styles.tileValue}>
                  {all.occupied}/{all.total}
                </div>
                <div className={styles.tileNote}>{all.vacant === 0 ? "fully let" : `${all.vacant} vacant`}</div>
              </div>
              <div className={styles.tile}>
                <div className={styles.tileLabel}>Scheduled rent</div>
                <div className={styles.tileValue}>{money(all.scheduledRent)}</div>
                <div className={styles.tileNote}>per month, occupied places</div>
              </div>
              <div className={styles.tile}>
                <div className={styles.tileLabel}>Net this month</div>
                <div className={`${styles.tileValue} ${month.net < 0 ? styles.neg : ""}`}>
                  {month.net < 0 ? "−" : ""}
                  {money(Math.abs(month.net))}
                </div>
                <div className={styles.tileNote}>
                  {money(month.rent + month.other)} in · {money(month.expense)} out
                </div>
              </div>
              <div className={styles.tile}>
                <div className={styles.tileLabel}>Net year to date</div>
                <div className={`${styles.tileValue} ${ytd.net < 0 ? styles.neg : ""}`}>
                  {ytd.net < 0 ? "−" : ""}
                  {money(Math.abs(ytd.net))}
                </div>
                <div className={styles.tileNote}>
                  {money(ytd.rent + ytd.other)} in · {money(ytd.expense)} out
                </div>
              </div>
            </div>
          </section>

          {roll.map(({ property, rows }) => {
            const occ = occupancy(rows);
            return (
              <section key={property.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <h2>{property.name}</h2>
                  <span className={styles.sub}>
                    {rows.length > 1 ? `${occ.occupied} of ${occ.total} let · ` : ""}
                    {money(occ.scheduledRent)}/mo
                  </span>
                </div>
                {property.address && <p className={styles.sub} style={{ marginTop: -6, marginBottom: 8 }}>{property.address}</p>}
                <ul className={styles.roll}>
                  {rows.map((r) => (
                    <li key={r.unitId ?? r.propertyId} className={styles.rollRow}>
                      <div>
                        <div className={styles.rollName}>
                          {rows.length > 1 ? r.label : "Whole property"}{" "}
                          {r.vacant ? (
                            <span className={`${styles.pill} ${styles.pillVacant}`}>Vacant</span>
                          ) : (
                            <span className={styles.pill}>Occupied</span>
                          )}
                        </div>
                        <div className={styles.rollWho}>
                          {r.vacant
                            ? r.vacantSince
                              ? `Empty ${vacantForLabel(r.vacantSince, now)}`
                              : "Nobody in it"
                            : `${r.occupant!.label}${
                                r.occupant!.leaseEndMonth ? ` · lease ends ${monthName(r.occupant!.leaseEndMonth)}` : " · open-ended"
                              }`}
                        </div>
                      </div>
                      <div className={styles.rollRent}>
                        {money(r.monthlyRent)}
                        <span className={styles.rowSub}>asking rent</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>Open repairs</h2>
              <span className={styles.sub}>{orderedRequests.length === 0 ? "none" : `${orderedRequests.length} open`}</span>
            </div>
            {orderedRequests.length === 0 ? (
              <p className={styles.empty}>Nothing is waiting on a repair right now.</p>
            ) : (
              <ul className={styles.list}>
                {orderedRequests.map((r) => (
                  <li key={r.id} className={styles.item}>
                    <span className={styles.itemTitle}>
                      {r.title}{" "}
                      {r.urgency === "urgent" && <span className={`${styles.pill} ${styles.pillVacant}`}>Urgent</span>}
                    </span>
                    <span className={styles.itemMeta}>
                      {[r.propertyName, r.unitName].filter(Boolean).join(" · ")} · {r.category} ·{" "}
                      <span className={`${styles.pill} ${r.status === "open" ? styles.pillQuiet : styles.pillWarn}`}>
                        {OWNER_STATUS_LABEL[r.status] ?? r.status}
                      </span>{" "}
                      · opened {ago(r.createdAt, now)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>Documents</h2>
              <span className={styles.sub}>shared with you</span>
            </div>
            {docs.length === 0 ? (
              <p className={styles.empty}>No documents have been shared with you yet.</p>
            ) : (
              <ul className={styles.list}>
                {docs.map((d) => (
                  <li key={d.id} className={styles.item}>
                    <span className={styles.itemTitle}>
                      <FileLink url={fileLink("document", d.id)} name={d.filename || d.title} mime={d.contentType}>
                        {d.title}
                      </FileLink>
                    </span>
                    <span className={styles.itemMeta}>
                      {d.kind} · {d.property?.name}
                      {d.expiresOn ? ` · valid through ${formatDay(d.expiresOn.toISOString().slice(0, 10))}` : ""}
                      {" · "}
                      <a href={`${fileLink("document", d.id)}?download=1`}>Download</a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </OwnerShell>
  );
}

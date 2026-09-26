import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { requireTenant } from "@/lib/access";
import { statementForTenant } from "@/lib/statements";
import { moveOutInclude, serializeMoveOut } from "@/lib/move-outs-db";
import { formatDay, isoDay } from "@/lib/lease";
import { monthName } from "@/lib/notices";
import { money } from "@/lib/money";
import PrintButton from "./PrintButton";
import styles from "./statement.module.css";

/**
 * The itemized list most states require with a returned deposit: what was
 * held, each thing kept and why, and what's coming back. Laid out as a
 * letter so it can be printed or saved as a PDF and sent as it is.
 */
export default async function MoveOutStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const { id } = await params;
  const row = await prisma.moveOut.findUnique({ where: { id }, include: moveOutInclude });
  if (!row) notFound();
  const tenant = await requireTenant(userId, row.tenantId);
  if (!tenant) notFound();

  const [company, unit, result] = await Promise.all([
    prisma.company.findUnique({ where: { id: tenant.property.companyId } }),
    tenant.unitId ? prisma.unit.findUnique({ where: { id: tenant.unitId }, select: { name: true } }) : null,
    statementForTenant(tenant.id),
  ]);
  const m = serializeMoveOut(row);
  const kept = Math.round((m.deposit - m.refund) * 100) / 100;
  const stillOwed = Math.max(0, result?.statement.balance ?? 0);
  const place = [tenant.property.name, unit?.name].filter(Boolean).join(", ");

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Link href={`/dashboard/properties/${tenant.propertyId}`}>&larr; {tenant.property.name}</Link>
        <PrintButton />
      </div>

      <article className={styles.sheet}>
        <header className={styles.letterhead}>
          <div className={styles.from}>
            <strong>{company?.name}</strong>
            {company?.contactPhone && <span>{company.contactPhone}</span>}
            {company?.contactEmail && <span>{company.contactEmail}</span>}
          </div>
          <div className={styles.dated}>{formatDay(isoDay(new Date()))}</div>
        </header>

        <div className={styles.to}>
          <strong>{tenant.name}</strong>
          {m.forwardingAddress ? <span>{m.forwardingAddress}</span> : <span className={styles.blank}>Forwarding address</span>}
        </div>

        <h1>Security deposit statement</h1>
        <p className={styles.lede}>
          For {place}
          {tenant.property.address ? `, ${tenant.property.address}` : ""}. You moved out on {formatDay(m.movedOutOn)}
          {tenant.leaseStart ? `, after a tenancy that began ${formatDay(tenant.leaseStart.toISOString().slice(0, 10))}` : ""}
          . Rent was charged through {monthName(m.lastRentMonth)}.
        </p>

        <table className={styles.items}>
          <tbody>
            <tr>
              <td>Security deposit held</td>
              <td className={styles.amt}>{money(m.deposit)}</td>
            </tr>
            {m.deductions.map((d, i) => (
              <tr key={i}>
                <td className={styles.less}>
                  {d.kind === "rent" ? `Unpaid rent through ${monthName(m.lastRentMonth)}` : d.label}
                </td>
                <td className={styles.amt}>&minus;{money(d.amount)}</td>
              </tr>
            ))}
            <tr className={styles.total}>
              <td>{m.refund > 0 ? "Amount returned to you" : "Amount returned"}</td>
              <td className={styles.amt}>{money(m.refund)}</td>
            </tr>
          </tbody>
        </table>

        {kept === 0 && <p>The full deposit is being returned. Nothing was deducted.</p>}
        {stillOwed > 0.005 && (
          <p className={styles.owed}>
            After the deposit was applied, {money(stillOwed)} remains owed on your account.
          </p>
        )}
        {m.returnedOn ? (
          <p>
            Sent {formatDay(m.returnedOn)}
            {m.returnNote ? ` — ${m.returnNote}` : ""}.
          </p>
        ) : (
          m.refund > 0 && m.returnBy && <p>To be sent by {formatDay(m.returnBy)}.</p>
        )}

        <footer className={styles.sign}>
          <span>{company?.name}</span>
        </footer>
      </article>
    </div>
  );
}

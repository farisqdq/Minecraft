import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { renewalLetter } from "@/lib/renewals-db";
import { dueDayLong } from "@/lib/renewal";
import { formatDay, ordinal } from "@/lib/lease";
import { money } from "@/lib/money";
import PrintButton from "../../move-outs/[id]/PrintButton";
import paper from "../../move-outs/[id]/statement.module.css";
import styles from "./renewal.module.css";

/**
 * The renewal in writing: the new end date, the rent and when it starts,
 * and a place for both sides to sign. Laid out as a letter to print or save
 * as a PDF, like the deposit statement.
 */
export default async function RenewalLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const { id } = await params;
  const letter = await renewalLetter(id);
  if (!letter || !(await requireTenant(userId, letter.tenant.id, "viewer"))) notFound();
  const { renewal: r, tenant, company, place } = letter;
  const changed = r.newRent !== r.previousRent;
  const first = tenant.name.trim().split(/\s+/)[0] || tenant.name;

  return (
    <div className={paper.page}>
      <div className={paper.toolbar}>
        <Link href={`/dashboard/properties/${tenant.propertyId}#tenant-${tenant.id}`}>&larr; {tenant.property.name}</Link>
        <PrintButton />
      </div>

      <article className={paper.sheet}>
        <header className={paper.letterhead}>
          <div className={paper.from}>
            <strong>{company.name}</strong>
            {company.contactPhone && <span>{company.contactPhone}</span>}
            {company.contactEmail && <span>{company.contactEmail}</span>}
          </div>
          <div className={paper.dated}>{formatDay(r.createdAt.slice(0, 10))}</div>
        </header>

        <div className={paper.to}>
          <strong>{tenant.name}</strong>
          <span>{place}</span>
          {tenant.property.address && <span>{tenant.property.address}</span>}
        </div>

        <h1>{changed ? "Lease renewal and rent change" : "Lease renewal"}</h1>
        <p className={paper.lede}>
          Dear {first}, your lease at {place}
          {r.previousEnd ? `, which runs to ${formatDay(r.previousEnd)},` : ""} is renewed on the terms below.
          Everything else in your lease stays the same.
        </p>

        <table className={`${paper.items} ${styles.terms}`}>
          <tbody>
            <tr>
              <td>Lease ends</td>
              <td className={paper.amt}>
                {formatDay(r.newEnd)}
                {r.previousEnd && <span className={styles.was}>was {formatDay(r.previousEnd)}</span>}
              </td>
            </tr>
            <tr>
              <td>Monthly rent</td>
              <td className={paper.amt}>
                {money(r.newRent)}
                {changed && <span className={styles.was}>now {money(r.previousRent)}</span>}
              </td>
            </tr>
            {changed && (
              <tr>
                <td>New rent starts</td>
                <td className={paper.amt}>with the rent due {dueDayLong(r.rentFrom, tenant.dueDay)}</td>
              </tr>
            )}
            <tr>
              <td>Rent is due</td>
              <td className={paper.amt}>on the {ordinal(tenant.dueDay)} of each month</td>
            </tr>
          </tbody>
        </table>

        {r.note && <p>{r.note}</p>}
        <p>Please sign below and return a copy to keep with your lease.</p>

        <div className={styles.signs}>
          <div>{company.name}</div>
          <div>{tenant.name}</div>
        </div>
        <p className={styles.signNote}>Date signed: ____________________</p>
      </article>
    </div>
  );
}

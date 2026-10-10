import styles from "./inspection-report.module.css";
import { CONDITION_LABEL, KIND_LABEL, compareItems, groupByRoom, progress, type Condition } from "@/lib/inspections";
import type { InspectionDTO } from "@/lib/inspections-db";

function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function momentLabel(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

const tone = (c: Condition) => (c === "poor" || c === "damaged" ? styles.bad : c === "" ? styles.unchecked : "");

/**
 * An inspection as a document: who, where, when, every room and line with
 * its condition, note and photos, and either the tenant's acknowledgement or
 * lines to sign on paper. The landlord prints it; the tenant reads it in the
 * portal. A move-out shows each line's move-in condition beside it.
 */
export default function InspectionReport({
  inspection,
  moveIn,
  companyName,
  companyContact,
  tenantName,
  placeLabel,
  address,
  paperSignature = true,
}: {
  inspection: InspectionDTO;
  moveIn: InspectionDTO | null;
  companyName: string;
  companyContact: string[];
  tenantName: string;
  placeLabel: string;
  address: string;
  /** Lines to sign on paper while it's unsigned; off in the portal, which has its own sign-off. */
  paperSignature?: boolean;
}) {
  const rows = moveIn ? compareItems(inspection.items, moveIn.items) : inspection.items.map((i) => ({ ...i, change: "same" as const, before: null }));
  const rooms = groupByRoom(rows);
  const prog = progress(inspection.items);
  const worse = rows.filter((r) => r.change === "worse").length;

  return (
    <article className={styles.sheet}>
      <header className={styles.letterhead}>
        <div className={styles.from}>
          <strong>{companyName}</strong>
          {companyContact.map((c) => (
            <span key={c} className={styles.muted}>
              {c}
            </span>
          ))}
        </div>
        <div className={styles.muted}>{dayLabel(inspection.inspectedOn)}</div>
      </header>

      <h1>{KIND_LABEL[inspection.kind]}</h1>
      <p className={styles.facts}>
        <strong>{tenantName}</strong> · {placeLabel}
        {address ? ` · ${address}` : ""}
        <br />
        Walk-through on {dayLabel(inspection.inspectedOn)} · {prog.checked} of {prog.total} items checked
        {prog.flagged > 0 ? `, ${prog.flagged} poor or damaged` : ""}
        {moveIn ? ` · compared with the move-in on ${dayLabel(moveIn.inspectedOn)}: ${worse} worse` : ""}
        {inspection.note ? (
          <>
            <br />
            {inspection.note}
          </>
        ) : null}
      </p>

      {rooms.map(({ room, items }) => (
        <section key={room} className={styles.room}>
          <h2>{room}</h2>
          <table className={styles.items}>
            <thead>
              <tr>
                <th style={{ width: "26%" }}>Item</th>
                {moveIn && <th style={{ width: "14%" }}>Move-in</th>}
                <th style={{ width: "14%" }}>{moveIn ? "Now" : "Condition"}</th>
                <th>Notes and photos</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.change === "worse" ? styles.worse : undefined}>
                  <td>{item.name}</td>
                  {moveIn && (
                    <td className={`${styles.cond} ${item.before ? tone(item.before.condition) : ""}`}>
                      {item.before ? CONDITION_LABEL[item.before.condition] : "—"}
                    </td>
                  )}
                  <td className={`${styles.cond} ${tone(item.condition)}`}>
                    {CONDITION_LABEL[item.condition]}
                  </td>
                  <td>
                    {item.note}
                    {item.photos.length > 0 && (
                      <div className={styles.photos}>
                        {item.photos.map((p) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={p.id} src={p.url} alt={`${room}, ${item.name}`} loading="lazy" />
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {inspection.acknowledgedAt ? (
        <div className={styles.ack}>
          <strong>
            Acknowledged by {inspection.acknowledgedName} on {momentLabel(inspection.acknowledgedAt)}
          </strong>
          , in the tenant portal, by typing their name.
          {inspection.tenantComment && <p>Their note: “{inspection.tenantComment}”</p>}
        </div>
      ) : (
        paperSignature && (
        <div className={styles.signatures}>
          <div className={styles.sign}>Tenant — {tenantName} · date</div>
          <div className={styles.sign}>For {companyName} · date</div>
        </div>
        )
      )}
    </article>
  );
}

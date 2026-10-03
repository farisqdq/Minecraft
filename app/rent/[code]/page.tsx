import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CODE_PATTERN, bathsLabel, bedsLabel } from "@/lib/listings";
import { publicListing } from "@/lib/listings-db";
import { formatDay, formatPhone, isoDay, telHref } from "@/lib/lease";
import { money } from "@/lib/money";
import ApplyForm from "./ApplyForm";
import styles from "./rent.module.css";

// Shared by link, not found by search: a closed listing shouldn't linger in
// an index, and the code is what keeps it to the people it was sent to.
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const l = CODE_PATTERN.test(code) ? await publicListing(code) : null;
  return {
    title: l ? `${l.headline} — ${money(l.rent)}/mo` : "Listing closed",
    robots: { index: false, follow: false },
  };
}

/**
 * The page a listing link opens (a27): the place, the rent, when it's free,
 * the photos, and the application. Public — no account needed to apply.
 */
export default async function ListingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!CODE_PATTERN.test(code)) notFound();
  const l = await publicListing(code);
  if (!l) {
    return (
      <main className={styles.page}>
        <div className={styles.closed}>
          <h1>This place isn&apos;t taking applications</h1>
          <p>It may have been rented already. If someone sent you this link, ask them for the latest.</p>
        </div>
      </main>
    );
  }

  const place = l.unit ? `${l.unit.name}, ${l.property.name}` : l.property.name;
  const available = l.availableOn ? isoDay(l.availableOn) : "";
  const today = isoDay(new Date());
  const facts = [
    bedsLabel(l.beds),
    bathsLabel(l.baths),
    l.sqft ? `${l.sqft.toLocaleString("en-US")} sq ft` : "",
    available && available > today ? `Available ${formatDay(available)}` : "Available now",
    l.deposit > 0 ? `${money(l.deposit)} deposit` : "",
    l.pets ? `Pets: ${l.pets}` : "",
  ].filter(Boolean);
  const [hero, ...rest] = l.photoIds;

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <span className={styles.company}>{l.company.name}</span>
      </header>

      {hero && (
        <div
          className={`${styles.photos} ${rest.length === 0 ? styles.single : rest.length < 4 ? styles.side : ""}`}
          style={rest.length > 0 && rest.length < 4 ? ({ "--rows": rest.length } as React.CSSProperties) : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.hero} src={`/api/rent/${code}/photo/${hero}`} alt={`${place} — photo 1`} />
          {rest.slice(0, 4).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/api/rent/${code}/photo/${id}`} alt={`${place} — photo ${i + 2}`} loading="lazy" />
          ))}
        </div>
      )}

      <section className={styles.head}>
        <div>
          <h1>{l.headline}</h1>
          <p className={styles.place}>
            {place}
            {l.property.address ? ` · ${l.property.address}` : ""}
          </p>
        </div>
        <div className={styles.rent}>
          <b>{money(l.rent)}</b>
          <span>a month</span>
        </div>
      </section>

      <ul className={styles.facts}>
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      {rest.length > 4 && (
        <div className={styles.morePhotos}>
          {rest.slice(4).map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`/api/rent/${code}/photo/${id}`} alt={`${place} — photo ${i + 6}`} loading="lazy" />
          ))}
        </div>
      )}

      {l.description && <p className={styles.description}>{l.description}</p>}

      {(l.company.contactPhone || l.company.contactEmail) && (
        <p className={styles.contact}>
          Questions?{" "}
          {l.company.contactPhone && <a href={telHref(l.company.contactPhone)}>{formatPhone(l.company.contactPhone)}</a>}
          {l.company.contactPhone && l.company.contactEmail && " · "}
          {l.company.contactEmail && <a href={`mailto:${l.company.contactEmail}`}>{l.company.contactEmail}</a>}
        </p>
      )}

      <ApplyForm code={code} company={l.company.name} today={today} rent={l.rent} />

      <footer className={styles.foot}>
        <span>Equal Housing Opportunity.</span> {l.company.name} doesn&apos;t ask for, and won&apos;t consider, race,
        colour, religion, sex, disability, family status or national origin.
      </footer>
    </main>
  );
}

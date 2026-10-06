import { redirect } from "next/navigation";
import { requireOwnerSession } from "@/lib/owner-access";
import { emailConfigured } from "@/lib/email";
import OwnerShell from "../OwnerShell";
import OwnerAccountClient from "./AccountClient";
import styles from "../owners.module.css";
import ModeChoice from "../../components/appearance/ModeChoice";
import { getRequestAppearance } from "@/lib/appearance-server";

export const dynamic = "force-dynamic";

export default async function OwnerAccountPage() {
  const me = await requireOwnerSession();
  if (!me) redirect("/owners/login");

  return (
    <OwnerShell who={me.name}>
      <div className={styles.head}>
        <h1>Account</h1>
        <p>{me.email}</p>
      </div>

      <section className={styles.card}>
        <h2>Your access</h2>
        <div className={styles.facts}>
          {me.properties.map((p) => (
            <div key={p.id} className={styles.fact}>
              <span className={styles.factLabel}>{p.companyName}</span>
              <span className={styles.factValue}>{p.name}</span>
            </div>
          ))}
          {me.properties.length === 0 && <span className={styles.empty}>No properties right now.</span>}
        </div>
        <p className={styles.note}>
          Read-only, and only these. The landlord who invited you decides which properties you see; ask them to
          change it.
        </p>
      </section>

      <OwnerAccountClient monthlyEmail={me.monthlyEmail} emailReady={emailConfigured()} />

      <ModeChoice initial={(await getRequestAppearance()).theme} endpoint="/api/owners/appearance" className={styles.card} />
    </OwnerShell>
  );
}

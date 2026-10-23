import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./legal.module.css";

/** The frame the policy pages share: a way back, a title, the date, the text. */
export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <Link href="/" className={styles.back}>
        &larr; Back to Rent Roll
      </Link>
      <h1>{title}</h1>
      <p className={styles.meta}>Effective October 20, 2026</p>
      {children}
    </main>
  );
}


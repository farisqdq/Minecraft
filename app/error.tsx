"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./components/legal.module.css";

/** Shown when a page hits an unexpected error, instead of a blank screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className={styles.page}>
      <h1>Something went wrong</h1>
      <p>This page hit a problem. Your data is safe. Try again, or go back home.</p>
      <p>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>{" "}
        <Link href="/">Go home</Link>
      </p>
      <p>
        Still stuck? Email <a href="mailto:N5p0@proton.me">N5p0@proton.me</a>.
      </p>
    </main>
  );
}

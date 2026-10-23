import Link from "next/link";
import styles from "./components/legal.module.css";

export const metadata = { title: "Page not found | Rent Roll" };

export default function NotFound() {
  return (
    <main className={styles.page}>
      <h1>Page not found</h1>
      <p>That page doesn&apos;t exist or has moved.</p>
      <p>
        <Link href="/">Go to Rent Roll home</Link>
      </p>
      <p>
        Need help? Email <a href="mailto:N5p0@proton.me">N5p0@proton.me</a>.
      </p>
    </main>
  );
}

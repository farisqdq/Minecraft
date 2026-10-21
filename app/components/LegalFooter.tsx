import Link from "next/link";

/**
 * The line at the bottom of every page: who runs the site, how to reach
 * them, and the policies. Rendered once from the root layout.
 */
export default function LegalFooter() {
  return (
    <footer className="siteFoot" aria-label="Site information">
      <p>
        &copy; 2026 eqal.rentals &middot; <a href="mailto:N5p0@proton.me">N5p0@proton.me</a>
      </p>
      <nav aria-label="Legal">
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/terms">Terms of Use</Link>
        <Link href="/cookies">Cookie Policy</Link>
      </nav>
    </footer>
  );
}

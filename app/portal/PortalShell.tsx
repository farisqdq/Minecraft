"use client";

import type { ReactNode } from "react";
import { signOutTo } from "../components/sign-out";
import styles from "./portal.module.css";

/** The tenant frame: a brand, who you are, and the way out. */
export default function PortalShell({ who, children }: { who: string; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <span className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            R
          </span>
          Rent Roll
        </span>
        <span className={styles.spacer} />
        {who && <span className={styles.who}>{who}</span>}
        <button
          type="button"
          className={styles.signOut}
          onClick={() => signOutTo("/portal/login")}
        >
          Sign out
        </button>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

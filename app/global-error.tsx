"use client";

import { useEffect } from "react";

/** Last-resort error screen when the root layout itself fails. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 560, margin: "0 auto" }}>
        <h1>Something went wrong</h1>
        <p>Rent Roll hit a problem loading. Your data is safe.</p>
        <p>
          <button type="button" onClick={() => reset()} style={{ borderRadius: 6, padding: "8px 14px" }}>
            Try again
          </button>
        </p>
        <p>
          Still stuck? Email <a href="mailto:N5p0@proton.me">N5p0@proton.me</a>.
        </p>
      </body>
    </html>
  );
}

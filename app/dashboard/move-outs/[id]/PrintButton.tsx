"use client";

/** window.print() needs a click handler, and inline handlers are blocked by the CSP. */
export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}

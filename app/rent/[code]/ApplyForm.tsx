"use client";

import { useState, type FormEvent } from "react";
import styles from "./rent.module.css";

/**
 * The application. Asks what a landlord needs to decide — how to reach
 * them, when, who'd live there, what they earn, who they rent from now —
 * and nothing else. One hidden field catches bots.
 */
export default function ApplyForm({ code, company, today, rent }: { code: string; company: string; today: string; rent: number }) {
  const [f, setF] = useState({
    name: "",
    email: "",
    phone: "",
    moveIn: "",
    occupants: "1",
    income: "",
    employer: "",
    currentAddress: "",
    landlordName: "",
    landlordPhone: "",
    pets: "",
    message: "",
    website: "",
  });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/apply/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, consent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "That didn't go through. Try again.");
        return;
      }
      setDone(true);
      window.scrollTo({ top: document.getElementById("apply")?.offsetTop ?? 0, behavior: "smooth" });
    } catch {
      setError("Couldn't reach the site. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section id="apply" className={styles.apply}>
        <div className={styles.thanks}>
          <h2>Application sent</h2>
          <p>
            Thanks, {f.name.trim().split(/\s+/)[0]}. {company} has it and will be in touch at {f.email} or {f.phone}.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="apply" className={styles.apply}>
      <h2>Apply</h2>
      <p className={styles.applyLede}>Takes about two minutes. No account, no fee, and nothing about you is shared.</p>
      <form onSubmit={submit} className={styles.form}>
        {/* Hidden from people; bots fill it in. */}
        <div className={styles.trap} aria-hidden="true">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} />
          </label>
        </div>

        <fieldset>
          <legend>You</legend>
          <label className={styles.wide}>
            Full name
            <input required autoComplete="name" value={f.name} onChange={set("name")} />
          </label>
          <label>
            Email
            <input required type="email" autoComplete="email" value={f.email} onChange={set("email")} />
          </label>
          <label>
            Phone
            <input required type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} />
          </label>
        </fieldset>

        <fieldset>
          <legend>The move</legend>
          <label>
            Move-in date
            <input type="date" min={today} value={f.moveIn} onChange={set("moveIn")} />
          </label>
          <label>
            People living there
            <input type="number" min="1" max="20" inputMode="numeric" value={f.occupants} onChange={set("occupants")} />
          </label>
          <label className={styles.wide}>
            Pets
            <input placeholder="e.g. one cat, or none" value={f.pets} onChange={set("pets")} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Income</legend>
          <label>
            Monthly income, before tax
            <input inputMode="decimal" placeholder="$" value={f.income} onChange={set("income")} />
            {Number(f.income.replace(/[$,\s]/g, "")) > 0 && (
              <span className={styles.hint}>
                That&apos;s {(Number(f.income.replace(/[$,\s]/g, "")) / rent).toFixed(1)}× the rent.
              </span>
            )}
          </label>
          <label>
            Employer or source
            <input value={f.employer} onChange={set("employer")} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Where you live now</legend>
          <label className={styles.wide}>
            Current address
            <input autoComplete="street-address" value={f.currentAddress} onChange={set("currentAddress")} />
          </label>
          <label>
            Current landlord
            <input value={f.landlordName} onChange={set("landlordName")} />
          </label>
          <label>
            Their phone
            <input type="tel" value={f.landlordPhone} onChange={set("landlordPhone")} />
          </label>
        </fieldset>

        <label className={styles.wide}>
          Anything else {company} should know
          <textarea rows={3} maxLength={2000} value={f.message} onChange={set("message")} />
        </label>

        <label className={styles.consent}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            What I&apos;ve written is true, and {company} may contact my employer and landlord to check it.
          </span>
        </label>

        {error && <p className={styles.error}>{error}</p>}
        <button type="submit" className={styles.submit} disabled={busy || !consent}>
          {busy ? "Sending…" : "Send application"}
        </button>
      </form>
    </section>
  );
}

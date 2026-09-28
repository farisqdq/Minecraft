"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "unconfigured">("idle");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
        return;
      }
      setState(data.emailConfigured ? "sent" : "unconfigured");
    } catch {
      setError("Couldn't reach the site. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authPage">
      <div className="authBrand">
        <span className="authMark" aria-hidden="true">
          R
        </span>
        <h1>Rent Roll</h1>
        <p>Forgot your password? Enter the email you sign in with.</p>
      </div>
      {state === "sent" ? (
        <div className="authCard">
          <p className="authNote">
            If <strong>{email}</strong> has an account, a link to set a new password is on its way. It works once and
            lasts an hour. Check your spam folder if it doesn&apos;t arrive in a minute or two.
          </p>
        </div>
      ) : state === "unconfigured" ? (
        <div className="authCard">
          <p className="authNote">
            This site can&apos;t send email yet, so nothing was sent. Ask the site&apos;s admin for a reset link —
            they can make one for you in a moment.
          </p>
        </div>
      ) : (
        <form className="authCard" onSubmit={onSubmit}>
          {error && <div className="authError">{error}</div>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "One moment…" : "Send me a reset link"}
          </button>
        </form>
      )}
      <div className="authFoot">
        <Link href="/login">Back to sign in</Link>
      </div>
    </div>
  );
}

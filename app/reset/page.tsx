"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== again) {
      setError("The two passwords don't match.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data?.error || "Something went wrong. Please try again.");
      return;
    }
    setDone(true);
  }

  if (!token) {
    return (
      <div className="authCard">
        <p className="authNote">
          This page needs the link from your reset email. <Link href="/forgot">Ask for a new one</Link>.
        </p>
      </div>
    );
  }
  if (done) {
    return (
      <div className="authCard">
        <p className="authNote">
          Your password is changed, and every other place you were signed in has been signed out.{" "}
          <Link href="/login">Sign in with the new one</Link>.
        </p>
      </div>
    );
  }
  return (
    <form className="authCard" onSubmit={onSubmit}>
      {error && <div className="authError">{error}</div>}
      <div className="field">
        <label htmlFor="password">New password</label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="again">Once more</label>
        <input
          id="again"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </div>
      <button type="submit" className="btn primary" disabled={loading}>
        {loading ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <div className="authPage">
      <div className="authBrand">
        <span className="authMark" aria-hidden="true">
          R
        </span>
        <h1>Rent Roll</h1>
        <p>Choose a new password.</p>
      </div>
      <Suspense>
        <ResetForm />
      </Suspense>
      <div className="authFoot">
        <Link href="/login">Back to sign in</Link>
      </div>
    </div>
  );
}

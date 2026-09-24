"use client";

import { Suspense, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { pauseMessage } from "@/lib/throttle-rules";

function PortalLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // The "tenant" provider, not "credentials" — a landlord's password will
    // not get you in here, and this one will not get you into the dashboard.
    const result = await signIn("tenant", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      // A paused account gets the same refusal as a wrong password from the
      // server. Ask which it was, so a right password isn't called wrong.
      const status = await fetch("/api/auth/lock-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "tenant", email }),
      })
        .then((r) => r.json())
        .catch(() => null);
      setError(status?.lockedForSeconds > 0 ? pauseMessage(status.lockedForSeconds) : "Incorrect email or password.");
      return;
    }
    // Remember this device (see lib/device-trust.ts). Best effort.
    await fetch("/api/auth/device", { method: "POST" }).catch(() => undefined);
    router.push("/portal");
    router.refresh();
  }

  return (
    <div className="authPage">
      <div className="authBrand">
        <span className="authMark" aria-hidden="true">
          R
        </span>
        <h1>Tenant portal</h1>
        <p>Your place, your lease, and anything that needs fixing.</p>
      </div>
      <form className="authCard" onSubmit={onSubmit}>
        {error && <div className="authError">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="authFoot">
        Got a code from your landlord? <Link href="/portal/signup">Set up your account</Link>
        <br />
        Manage properties instead? <Link href="/login">Landlord sign in</Link>
      </div>
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense>
      <PortalLoginForm />
    </Suspense>
  );
}

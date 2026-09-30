"use client";

import { Suspense, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { pauseMessage } from "@/lib/throttle-rules";

function OwnerLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // The "owner" provider, not "credentials" — a landlord's or tenant's
    // password will not get you in here, and this one gets you nowhere else.
    const result = await signIn("owner", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      const status = await fetch("/api/auth/lock-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "owner", email }),
      })
        .then((r) => r.json())
        .catch(() => null);
      setError(status?.lockedForSeconds > 0 ? pauseMessage(status.lockedForSeconds) : "Incorrect email or password.");
      return;
    }
    // Remember this device (see lib/device-trust.ts). Best effort.
    await fetch("/api/auth/device", { method: "POST" }).catch(() => undefined);
    router.push("/owners");
    router.refresh();
  }

  return (
    <div className="authPage">
      <div className="authBrand">
        <span className="authMark" aria-hidden="true">
          R
        </span>
        <h1>Owner portal</h1>
        <p>Sign in to see your properties</p>
      </div>
      <form className="authCard" onSubmit={onSubmit}>
        {error && <div className="authError">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
        <Link href="/owners/forgot">Forgot your password?</Link>
        <br />
        Got an invite? Use the link in it to set up your login.
        <br />
        Manage properties instead? <Link href="/login">Landlord sign in</Link>
      </div>
    </div>
  );
}

export default function OwnerLoginPage() {
  return (
    <Suspense>
      <OwnerLoginForm />
    </Suspense>
  );
}

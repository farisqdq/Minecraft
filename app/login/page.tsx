"use client";

import { Suspense, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { pauseMessage } from "@/lib/throttle-rules";
import { safeCallbackUrl } from "@/lib/safe-redirect";
import { TWO_FACTOR_INVALID, TWO_FACTOR_REQUIRED } from "@/lib/auth-messages";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only ever a path on this site — see lib/safe-redirect.ts.
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Shown once the password has been accepted and the account has
  // two-factor on. The email and password stay filled in behind it.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await signIn("credentials", {
      email,
      password,
      code: needsCode ? code : "",
      redirect: false,
    });
    setLoading(false);
    if (result?.error === TWO_FACTOR_REQUIRED) {
      setNeedsCode(true);
      return;
    }
    if (result?.error === TWO_FACTOR_INVALID) {
      setCode("");
      setError("That code didn't work. Use the newest one from the app, or a backup code.");
      return;
    }
    if (result?.error) {
      // A paused account gets the same refusal as a wrong password from the
      // server. Ask which it was, so a right password isn't called wrong.
      const status = await fetch("/api/auth/lock-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "user", email }),
      })
        .then((r) => r.json())
        .catch(() => null);
      setError(status?.lockedForSeconds > 0 ? pauseMessage(status.lockedForSeconds) : "Incorrect email or password.");
      return;
    }
    // Remember this device, so someone typing wrong passwords at this account
    // from elsewhere can't lock it here. Best effort: signing in has worked.
    await fetch("/api/auth/device", { method: "POST" }).catch(() => undefined);
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="authPage">
      <div className="authBrand">
        <span className="authMark" aria-hidden="true">
          R
        </span>
        <h1>Rent Roll</h1>
        <p>Rent collected, repairs paid, and the profit left over.</p>
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
        {needsCode && (
          <div className="field">
            <label htmlFor="code">Code from your authenticator app</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder="123456, or a backup code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        )}
        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? "Signing in…" : needsCode ? "Verify" : "Sign in"}
        </button>
      </form>
      <div className="authFoot">
        Don&apos;t have an account?{" "}
        <Link href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Create one</Link>
        <br />
        Renting one of these places? <Link href="/portal/login">Tenant sign in</Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

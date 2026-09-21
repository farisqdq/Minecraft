"use client";

import { Suspense, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function PortalSignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  // A landlord can share the code in the link rather than reading it out.
  const [code, setCode] = useState(params.get("code") ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/portal/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoading(false);
      setError(data?.error || "Couldn't set that up.");
      return;
    }

    // Straight in rather than bouncing them to a sign-in form they'd have to
    // fill out again with what they just typed.
    const result = await signIn("tenant", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      router.push("/portal/login");
      return;
    }
    router.push("/portal");
    router.refresh();
  }

  return (
    <div className="authPage">
      <div className="authBrand">
        <span className="authMark" aria-hidden="true">
          R
        </span>
        <h1>Set up your account</h1>
        <p>Use the code your landlord gave you. It only works once, and only for your place.</p>
      </div>
      <form className="authCard" onSubmit={onSubmit}>
        {error && <div className="authError">{error}</div>}
        <div className="field">
          <label htmlFor="code">Code from your landlord</label>
          <input
            id="code"
            type="text"
            required
            autoCapitalize="characters"
            autoComplete="one-time-code"
            spellCheck={false}
            placeholder="ABCD-2345"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="email">Your email</label>
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
          <label htmlFor="password">Choose a password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? "Setting up…" : "Create account"}
        </button>
      </form>
      <div className="authFoot">
        Already set up? <Link href="/portal/login">Sign in</Link>
      </div>
    </div>
  );
}

export default function PortalSignupPage() {
  return (
    <Suspense>
      <PortalSignupForm />
    </Suspense>
  );
}

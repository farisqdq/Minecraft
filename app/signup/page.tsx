"use client";

import { Suspense, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const inviteToken = searchParams.get("invite") || "";
  const invitedEmail = searchParams.get("email") || "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, code, inviteToken }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setLoading(false);
      setError(data?.error || "Something went wrong. Please try again.");
      return;
    }

    const result = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }
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
        <p>Create an account to start tracking your properties.</p>
      </div>
      <form className="authCard" onSubmit={onSubmit}>
        {error && <div className="authError">{error}</div>}
        <div className="field">
          <label htmlFor="name">Name (optional)</label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {!inviteToken && (
          <div className="field">
            <label htmlFor="code">Invite code (if required)</label>
            <input
              id="code"
              type="text"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        )}
        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
      <div className="authFoot">
        Already have an account?{" "}
        <Link href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Sign in</Link>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

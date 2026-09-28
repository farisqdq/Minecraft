"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type Preview = { email: string; name: string; companyName: string; propertyNames: string[]; existing: boolean };

/**
 * Where an invite link lands. The link decides which email and which
 * properties; the person only chooses a name and a password — or, if they
 * already have an owner login, proves it's them with its password.
 */
function AcceptForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/owners/accept?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) setLookupError(data?.error || "That link isn't valid.");
        else {
          setPreview(data);
          setName(data.name ?? "");
        }
      })
      .catch(() => setLookupError("Couldn't reach the site. Check your connection and try again."));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!preview?.existing && password !== again) {
      setError("The two passwords don't match.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/owners/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoading(false);
      setError(data?.error || "Couldn't set that up.");
      return;
    }
    // Straight in rather than bouncing them to a sign-in form they'd have
    // to fill out again with what they just typed.
    const result = await signIn("owner", { email: data.email, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      router.push("/owners/login");
      return;
    }
    await fetch("/api/auth/device", { method: "POST" }).catch(() => undefined);
    router.push("/owners");
    router.refresh();
  }

  if (!token || lookupError) {
    return (
      <div className="authCard">
        <p className="authNote">
          {lookupError || "This page needs the link from your invite email."} If you already have a login,{" "}
          <Link href="/owners/login">sign in</Link>; otherwise ask the landlord for a new invite.
        </p>
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="authCard">
        <p className="authNote">Checking your invite…</p>
      </div>
    );
  }

  return (
    <form className="authCard" onSubmit={onSubmit}>
      <p className="authNote">
        <strong>{preview.companyName}</strong> is sharing{" "}
        {preview.propertyNames.length === 1 ? (
          <strong>{preview.propertyNames[0]}</strong>
        ) : (
          <>
            {preview.propertyNames.length} properties:{" "}
            <strong>{preview.propertyNames.join(", ")}</strong>
          </>
        )}{" "}
        with <strong>{preview.email}</strong>.
      </p>
      {error && <div className="authError">{error}</div>}
      {preview.existing ? (
        <div className="field">
          <label htmlFor="password">Your owner portal password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="fieldHint">You already have a login for this email; this adds the properties to it.</span>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" type="text" required autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
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
        </>
      )}
      <button type="submit" className="btn primary" disabled={loading}>
        {loading ? "Setting up…" : preview.existing ? "Add to my login" : "Create my login"}
      </button>
    </form>
  );
}

export default function OwnerAcceptPage() {
  return (
    <div className="authPage">
      <div className="authBrand">
        <span className="authMark" aria-hidden="true">
          R
        </span>
        <h1>Owner portal</h1>
        <p>Set up your login. It only shows the properties you&apos;ve been given, and only to read.</p>
      </div>
      <Suspense>
        <AcceptForm />
      </Suspense>
      <div className="authFoot">
        Already set up? <Link href="/owners/login">Sign in</Link>
      </div>
    </div>
  );
}

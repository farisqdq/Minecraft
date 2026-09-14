"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function InviteClient({
  token,
  valid,
  companyName,
  invitedEmail,
  role,
  sessionEmail,
}: {
  token: string;
  valid: boolean;
  companyName: string;
  invitedEmail: string;
  role: "owner" | "member";
  sessionEmail: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  const next = `/invite/${token}`;
  const emailMatches = sessionEmail?.toLowerCase() === invitedEmail.toLowerCase();

  async function accept() {
    setError("");
    setJoining(true);
    const res = await fetch(`/api/invites/${token}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setJoining(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't join that LLC.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  if (!valid) {
    return (
      <div className="authPage">
        <div className="authBrand">
          <h1>Rent Roll</h1>
          <p>This invite has expired or has already been used.</p>
        </div>
        <div className="authFoot">
          <Link href="/login">Go to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="authPage">
      <div className="authBrand">
        <h1>Join {companyName}</h1>
        <p>
          You&apos;ve been invited to {companyName} as {role === "owner" ? "an owner" : "a member"}.
        </p>
      </div>

      <div className="authCard">
        {error && <div className="authError">{error}</div>}

        {!sessionEmail && (
          <>
            <p className="authNote">
              Sign in as <strong>{invitedEmail}</strong> to accept, or create an account with that address.
            </p>
            <Link
              className="btn primary btnLink"
              href={`/login?callbackUrl=${encodeURIComponent(next)}`}
            >
              Sign in
            </Link>
            <Link
              className="btn btnLink"
              href={`/signup?callbackUrl=${encodeURIComponent(next)}&email=${encodeURIComponent(
                invitedEmail
              )}&invite=${encodeURIComponent(token)}`}
            >
              Create an account
            </Link>
          </>
        )}

        {sessionEmail && emailMatches && (
          <button type="button" className="btn primary" onClick={accept} disabled={joining}>
            {joining ? "Joining…" : `Join ${companyName}`}
          </button>
        )}

        {sessionEmail && !emailMatches && (
          <>
            <p className="authNote">
              This invite was sent to <strong>{invitedEmail}</strong>, but you&apos;re signed in as{" "}
              <strong>{sessionEmail}</strong>.
            </p>
            <Link className="btn btnLink" href={`/login?callbackUrl=${encodeURIComponent(next)}`}>
              Sign in as someone else
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

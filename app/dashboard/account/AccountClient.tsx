"use client";

import { useState, type FormEvent } from "react";
import { signOutTo } from "../../components/sign-out";
import AppShell from "../../components/AppShell";
import Modal from "../../components/Modal";
import ConfirmDialog, { type ConfirmRequest } from "../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../components/Toasts";
import styles from "../dashboard.module.css";
import { formatDay } from "@/lib/lease";

type TwoFactor = { enabled: boolean; since: string; recoveryCodesLeft: number };
type Files = { publicFiles: number; privateReady: boolean };
type Step = "" | "password" | "scan" | "codes" | "disable" | "regenerate";

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export default function AccountClient({
  openRepairs,
  email,
  userLabel,
  initialTwoFactor,
  initialFiles,
}: {
  openRepairs: number;
  email: string;
  userLabel: string;
  initialTwoFactor: TwoFactor;
  initialFiles: Files;
}) {
  const { toasts, push, dismiss } = useToasts();
  const [twoFactor, setTwoFactor] = useState(initialTwoFactor);
  const [step, setStep] = useState<Step>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ qr: string; secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [files, setFiles] = useState(initialFiles);
  const [moving, setMoving] = useState<{ moved: number; skipped: number } | null>(null);

  /** Moves the public-store backlog a batch at a time until there's none left. */
  async function moveFiles() {
    let after = "";
    let moved = 0;
    let skipped = 0;
    setMoving({ moved, skipped });
    for (;;) {
      const { ok, data } = await post("/api/account/files", { after });
      if (!ok) {
        push(data?.error || "Couldn't move the files. Try again.", "bad");
        break;
      }
      moved += data.moved;
      skipped += data.skipped;
      setMoving({ moved, skipped });
      if (!data.next) break;
      after = data.next;
    }
    const res = await fetch("/api/account/files").then((r) => r.json()).catch(() => null);
    if (res) setFiles(res);
    setMoving(null);
    push(
      skipped > 0
        ? `Moved ${moved}. ${skipped} couldn't be read from storage and were left where they are.`
        : `Moved ${moved} ${moved === 1 ? "file" : "files"} to private storage.`,
      skipped > 0 ? "bad" : "good"
    );
  }

  function close() {
    setStep("");
    setError("");
    setPassword("");
    setCode("");
    setSetup(null);
  }

  async function startSetup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { ok, data } = await post("/api/account/2fa/setup", { password });
    setBusy(false);
    if (!ok) return setError(data?.error || "Couldn't start that.");
    setSetup(data);
    setPassword("");
    setStep("scan");
  }

  async function confirmSetup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { ok, data } = await post("/api/account/2fa/enable", { code });
    setBusy(false);
    if (!ok) return setError(data?.error || "That code didn't match.");
    setCodes(data.recoveryCodes);
    setTwoFactor({ enabled: true, since: new Date().toISOString(), recoveryCodesLeft: data.recoveryCodes.length });
    setCode("");
    setStep("codes");
  }

  async function turnOff(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { ok, data } = await post("/api/account/2fa/disable", { password, code });
    setBusy(false);
    if (!ok) return setError(data?.error || "Couldn't turn it off.");
    setTwoFactor({ enabled: false, since: "", recoveryCodesLeft: 0 });
    close();
    push("Two-factor is off. Signing in needs only your password now.");
  }

  async function regenerate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { ok, data } = await post("/api/account/2fa/recovery", { code });
    setBusy(false);
    if (!ok) return setError(data?.error || "That code didn't work.");
    setCodes(data.recoveryCodes);
    setTwoFactor((t) => ({ ...t, recoveryCodesLeft: data.recoveryCodes.length }));
    setCode("");
    setStep("codes");
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.next !== pw.confirm) return setError("The two new passwords don't match.");
    setBusy(true);
    const { ok, data } = await post("/api/account/password", { current: pw.current, next: pw.next });
    setBusy(false);
    if (!ok) return setError(data?.error || "Couldn't change it.");
    // Every session has just ended on the server, this one included.
    await signOutTo("/login");
  }

  function signOutEverywhere() {
    setConfirming({
      title: "Sign out everywhere?",
      body: "Every phone, laptop and browser signed in to this account is signed out, including this one, and none of them is remembered as a trusted device any more. You'll sign straight back in here.",
      confirmLabel: "Sign out everywhere",
      danger: true,
      onConfirm: async () => {
        const { ok } = await post("/api/account/sign-out-everywhere");
        setConfirming(null);
        if (!ok) return push("Couldn't do that.", "bad");
        await signOutTo("/login");
      },
    });
  }

  const codesText = `Rent Roll backup codes for ${email}\nEach works once, in place of the code from your authenticator app.\n\n${codes.join("\n")}\n`;

  return (
    <AppShell
      openRepairs={openRepairs}
      userLabel={userLabel}
      title="Account & security"
      tagline={email}
    >
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Two-factor sign-in</h2>
          <span className={`${styles.pill} ${twoFactor.enabled ? styles.paid : styles.owed}`}>
            {twoFactor.enabled ? "On" : "Off"}
          </span>
        </div>
        <div className={styles.formCard}>
          {twoFactor.enabled ? (
            <>
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                On since {formatDay(twoFactor.since.slice(0, 10))}. Signing in asks for a code from your
                authenticator app after your password. {twoFactor.recoveryCodesLeft} of 10 backup codes left
                {twoFactor.recoveryCodesLeft <= 3 ? " — make a new set soon." : "."}
              </p>
              <div className={styles.formFoot} style={{ justifyContent: "flex-start" }}>
                <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => setStep("regenerate")}>
                  New backup codes
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`}
                  onClick={() => setStep("disable")}
                >
                  Turn off
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                With this on, a stolen or guessed password isn&apos;t enough to get in: signing in also needs
                the six-digit code from an app on your phone — Google Authenticator, Authy, 1Password, or the
                iPhone&apos;s Passwords app.
              </p>
              <div className={styles.formFoot} style={{ justifyContent: "flex-start" }}>
                <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => setStep("password")}>
                  Turn on two-factor
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Password</h2>
        </div>
        <form className={styles.formCard} onSubmit={changePassword}>
          {error && !step && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={styles.fieldGrid}>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="pw-current">Current password</label>
              <input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                required
                value={pw.current}
                onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="pw-next">New password</label>
              <input
                id="pw-next"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={pw.next}
                onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="pw-confirm">New password again</label>
              <input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={pw.confirm}
                onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
              />
            </div>
          </div>
          <p className={styles.helpText}>Changing it signs you out everywhere, this device included.</p>
          <div className={styles.formFoot} style={{ justifyContent: "flex-start" }}>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
              {busy && !step ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Stored files</h2>
        </div>
        <div className={styles.formCard}>
          {!files.privateReady ? (
            <p className={styles.helpText} style={{ margin: 0 }}>
              Receipts, repair photos and documents only ever open through this site, for people signed in with
              access to them. For the files themselves to be locked away too, add a <strong>private</strong> Blob
              store to this project in Vercel (Storage → Create → Blob → Private) and redeploy. Uploads switch to it
              on their own.
              {files.publicFiles > 0 &&
                ` Then come back here to move the ${files.publicFiles} ${files.publicFiles === 1 ? "file" : "files"} uploaded before it.`}
            </p>
          ) : files.publicFiles === 0 ? (
            <p className={styles.helpText} style={{ margin: 0 }}>
              Every file is in private storage. They open only through this site, for people signed in with access
              to them.
            </p>
          ) : (
            <>
              <p className={styles.helpText} style={{ marginTop: 0 }}>
                {files.publicFiles} {files.publicFiles === 1 ? "file was" : "files were"} uploaded before private
                storage was set up. This site no longer links to {files.publicFiles === 1 ? "it" : "them"}{" "}
                directly, but anyone who kept an old link could still open {files.publicFiles === 1 ? "it" : "them"}.
                Moving copies each one into private storage and deletes the original.
              </p>
              <div className={styles.formFoot} style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.primary}`}
                  onClick={moveFiles}
                  disabled={moving !== null}
                >
                  {moving ? `Moving… ${moving.moved} done` : "Move old files"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>Where you&apos;re signed in</h2>
        </div>
        <div className={styles.formCard}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            A sign-in lasts a week and renews each day you use it. Left a browser signed in somewhere, or lost a
            phone? End every session at once — and stop every device being treated as yours.
          </p>
          <div className={styles.formFoot} style={{ justifyContent: "flex-start" }}>
            <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={signOutEverywhere}>
              Sign out everywhere
            </button>
          </div>
        </div>
      </section>

      <Modal
        open={step === "password" || step === "scan"}
        title="Turn on two-factor"
        subtitle={step === "password" ? "First, your password — so nobody using an open session can do this." : "Scan this with your authenticator app, then type the code it shows."}
        onClose={close}
      >
        {error && step && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
        {step === "password" && (
          <form onSubmit={startSetup}>
            <div className={styles.field}>
              <label htmlFor="tf-password">Password</label>
              <input id="tf-password" type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className={styles.formFoot}>
              <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
                {busy ? "Checking…" : "Continue"}
              </button>
            </div>
          </form>
        )}
        {step === "scan" && setup && (
          <form onSubmit={confirmSetup}>
            <div className={styles.qrWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="QR code to add Rent Roll to an authenticator app" className={styles.qr} />
              <div className={styles.qrSide}>
                <p className={styles.helpText} style={{ marginTop: 0 }}>
                  On this phone? <a href={setup.uri}>Open in your authenticator app</a>. Or type this key in by hand:
                </p>
                <code className={styles.secretKey}>{setup.secret}</code>
              </div>
            </div>
            <div className={styles.field} style={{ marginTop: 14 }}>
              <label htmlFor="tf-code">Six-digit code from the app</label>
              <input id="tf-code" type="text" inputMode="numeric" autoComplete="one-time-code" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className={styles.formFoot}>
              <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
                {busy ? "Checking…" : "Turn it on"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={step === "codes"}
        title="Save your backup codes"
        subtitle="If you lose your phone, each of these gets you in once instead of an app code. This is the only time they're shown."
        onClose={() => {
          setCodes([]);
          close();
        }}
      >
        <ol className={styles.backupCodes}>
          {codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ol>
        <div className={styles.formFoot}>
          <button
            type="button"
            className={`${styles.btn} ${styles.small}`}
            onClick={() => navigator.clipboard?.writeText(codesText).then(() => push("Copied."))}
          >
            Copy
          </button>
          <a
            className={`${styles.btn} ${styles.small}`}
            download="rent-roll-backup-codes.txt"
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(codesText)}`}
          >
            Download
          </a>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            onClick={() => {
              setCodes([]);
              close();
              push("Two-factor is on.");
            }}
          >
            I&apos;ve saved them
          </button>
        </div>
      </Modal>

      <Modal
        open={step === "disable" || step === "regenerate"}
        title={step === "disable" ? "Turn off two-factor" : "New backup codes"}
        subtitle={
          step === "disable"
            ? "Your password and a current code from the app."
            : "A code from the app. The old backup codes stop working."
        }
        onClose={close}
        narrow
      >
        {error && step && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
        <form onSubmit={step === "disable" ? turnOff : regenerate}>
          {step === "disable" && (
            <div className={styles.field}>
              <label htmlFor="off-password">Password</label>
              <input id="off-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <div className={styles.field} style={{ marginTop: 12 }}>
            <label htmlFor="off-code">Code from the app</label>
            <input id="off-code" type="text" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className={styles.formFoot}>
            <button
              type="submit"
              className={`${styles.btn} ${step === "disable" ? styles.danger : styles.primary}`}
              disabled={busy}
            >
              {busy ? "Checking…" : step === "disable" ? "Turn off" : "Make new codes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
    </AppShell>
  );
}

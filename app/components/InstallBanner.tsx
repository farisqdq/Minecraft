"use client";

import { useEffect, useState } from "react";
import { deviceFromUserAgent, snoozed, type Device } from "@/lib/device";
import { enablePush, isStandalone, pushState, pushSupported } from "./push";
import styles from "./install.module.css";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_KEY = "rr-install-dismissed";
const NOTIFY_KEY = "rr-notify-dismissed";

const remember = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: the banner just comes back next time */
    }
  },
};

/** Who is looking: decides whether notifications can be offered after installing. */
type Audience = "user" | "tenant" | "guest";

const svg = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function IconShare() {
  return (
    <svg viewBox="0 0 24 24" {...svg} aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}
function IconAdd() {
  return (
    <svg viewBox="0 0 24 24" {...svg} aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}
function IconHome() {
  return (
    <svg viewBox="0 0 24 24" {...svg} aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}
function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}
function IconSafari() {
  return (
    <svg viewBox="0 0 24 24" {...svg} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2.2 5.3-5.3 2.2 2.2-5.3z" />
    </svg>
  );
}
function IconBell() {
  return (
    <svg viewBox="0 0 24 24" {...svg} aria-hidden="true">
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li>
      <span className={styles.stepNum}>{n}</span>
      <span className={styles.stepIcon}>{icon}</span>
      <span>{children}</span>
    </li>
  );
}

/**
 * On a phone in a browser: how to put the site on the home screen. On a
 * phone that already did: a nudge to turn notifications on. Never on a
 * desktop, and not again for a month once dismissed.
 */
export default function InstallBanner({ audience }: { audience: Audience }) {
  const [mode, setMode] = useState<"hidden" | "install" | "installed" | "notify" | "done">("hidden");
  const [device, setDevice] = useState<Device>({ kind: "desktop", browser: "other" });
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = deviceFromUserAgent(navigator.userAgent, { touchPoints: navigator.maxTouchPoints });
    setDevice(d);
    if (d.kind === "desktop") return;
    let cancelled = false;

    if (isStandalone()) {
      // Installed. The only thing left to offer is notifications, and only
      // to someone signed in, until they say not now.
      if (audience === "guest" || !pushSupported() || snoozed(remember.get(NOTIFY_KEY))) return;
      pushState().then((s) => {
        if (!cancelled && s === "off") setMode("notify");
      });
      return () => {
        cancelled = true;
      };
    }

    if (!snoozed(remember.get(INSTALL_KEY))) setMode("install");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      remember.set(INSTALL_KEY, String(Date.now()));
      setMode(audience === "guest" ? "installed" : "notify");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [audience]);

  useEffect(() => {
    if (mode !== "done") return;
    const t = setTimeout(() => setMode("hidden"), 5000);
    return () => clearTimeout(t);
  }, [mode]);

  if (mode === "hidden") return null;

  function dismissInstall() {
    remember.set(INSTALL_KEY, String(Date.now()));
    setMode("hidden");
  }
  function dismissNotify() {
    remember.set(NOTIFY_KEY, String(Date.now()));
    setMode("hidden");
  }
  async function install() {
    if (!installPrompt) return;
    setBusy(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") remember.set(INSTALL_KEY, String(Date.now()));
    } finally {
      setBusy(false);
      setInstallPrompt(null);
    }
  }
  async function turnOn() {
    setBusy(true);
    setProblem("");
    const r = await enablePush();
    setBusy(false);
    if (r.ok) {
      remember.set(NOTIFY_KEY, String(Date.now()));
      setMode("done");
    } else setProblem(r.reason);
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const ios = device.kind === "ios";

  if (mode === "notify") {
    return (
      <div className={styles.banner} role="region" aria-label="Notifications">
        <div className={styles.head}>
          <span className={styles.stepIcon}>
            <IconBell />
          </span>
          <div>
            <div className={styles.title}>Get reminders on this phone</div>
            <div className={styles.sub}>
              {audience === "tenant"
                ? "Rent reminders and repair updates, as notifications."
                : "Rent, leases, documents and repairs, as notifications."}
            </div>
          </div>
        </div>
        {problem && <p className={styles.bad}>{problem}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={turnOn} disabled={busy}>
            {busy ? "Turning on…" : "Enable notifications"}
          </button>
          <button type="button" className={styles.quiet} onClick={dismissNotify}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  if (mode === "done") {
    return (
      <div className={styles.banner}>
        <span className={styles.good}>Notifications are on for this phone.</span>
      </div>
    );
  }

  if (mode === "installed") {
    return (
      <div className={styles.banner}>
        <span className={styles.good}>Installed. Open Rent Roll from your home screen and sign in there.</span>
      </div>
    );
  }

  return (
    <div className={styles.banner} role="region" aria-label="Install Rent Roll">
      <div className={styles.head}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.appIcon} src="/icon-192.png" alt="" width={40} height={40} />
        <div>
          <div className={styles.title}>Install Rent Roll as an app</div>
          <div className={styles.sub}>
            {ios
              ? "A home-screen icon, full screen, and notifications for rent and repairs."
              : "Opens like an app, with notifications for rent and repairs."}
          </div>
        </div>
      </div>

      {ios && device.browser === "safari" && (
        <ol className={styles.steps}>
          <Step n={1} icon={<IconShare />}>
            Tap the <strong>Share</strong> button at the bottom of Safari
          </Step>
          <Step n={2} icon={<IconAdd />}>
            Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>
          </Step>
          <Step n={3} icon={<IconHome />}>
            Open <strong>Rent Roll</strong> from your home screen
          </Step>
        </ol>
      )}

      {ios && device.browser !== "safari" && (
        <>
          <ol className={styles.steps}>
            <Step n={1} icon={<IconSafari />}>
              Open this page in <strong>Safari</strong> — only Safari can install apps on an iPhone
            </Step>
            <Step n={2} icon={<IconShare />}>
              Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>
            </Step>
            <Step n={3} icon={<IconHome />}>
              Open <strong>Rent Roll</strong> from your home screen
            </Step>
          </ol>
          <div className={styles.actions}>
            <button type="button" className={styles.quiet} onClick={copyLink}>
              {copied ? "Link copied — paste it in Safari" : "Copy this page's link"}
            </button>
          </div>
        </>
      )}

      {!ios && installPrompt && (
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={install} disabled={busy}>
            {busy ? "Installing…" : "Install"}
          </button>
        </div>
      )}

      {!ios && !installPrompt && (
        <ol className={styles.steps}>
          <Step n={1} icon={<IconMenu />}>
            Tap the browser menu (three dots, top right)
          </Step>
          <Step n={2} icon={<IconAdd />}>
            Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>
          </Step>
          <Step n={3} icon={<IconHome />}>
            Open <strong>Rent Roll</strong> from your home screen
          </Step>
        </ol>
      )}

      <p className={styles.note}>
        {ios ? "Notifications need iOS 16.4 or later. " : ""}
        Once it&apos;s open from the home screen, tap <strong>Enable notifications</strong>.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.quiet} onClick={dismissInstall}>
          Not now
        </button>
      </div>
    </div>
  );
}

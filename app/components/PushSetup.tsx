"use client";

import { useEffect, useState } from "react";
import { deviceFromUserAgent } from "@/lib/device";
import { disablePush, enablePush, isStandalone, pushState, sendTestPush, type PushState } from "./push";
import styles from "./install.module.css";

/**
 * The switch for notifications on this device, and a test button. The same
 * in the dashboard and the portal; the copy explains what an iPhone needs.
 */
export default function PushSetup({ audience }: { audience: "user" | "tenant" }) {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIos(deviceFromUserAgent(navigator.userAgent, { touchPoints: navigator.maxTouchPoints }).kind === "ios");
    setStandalone(isStandalone());
    pushState().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    const r = await enablePush();
    setBusy(false);
    if (r.ok) {
      setState("on");
      setMessage({ tone: "good", text: "Notifications are on for this device." });
    } else {
      setMessage({ tone: "bad", text: r.reason });
      setState(await pushState());
    }
  }

  async function turnOff() {
    setBusy(true);
    await disablePush();
    setBusy(false);
    setState("off");
    setMessage({ tone: "good", text: "Notifications are off for this device." });
  }

  async function test() {
    setBusy(true);
    const r = await sendTestPush();
    setBusy(false);
    setMessage({ tone: r.ok ? "good" : "bad", text: r.message });
  }

  const what = audience === "tenant" ? "rent reminders and repair updates" : "rent, lease, document and repair reminders";

  return (
    <div>
      {state === "loading" && <p className={styles.note}>Checking this device…</p>}

      {state === "unsupported" && (
        <p className={styles.note}>
          {ios
            ? "To get notifications on an iPhone or iPad, first install Rent Roll: tap Share, then Add to Home Screen, and open it from the home screen (iOS 16.4 or later). Then come back here."
            : "This browser can't show notifications. On a phone, install Rent Roll from the browser menu and open it from the home screen."}
        </p>
      )}

      {state === "denied" && (
        <p className={styles.note}>
          Notifications are blocked for Rent Roll on this device. Allow them in your phone&apos;s settings (Settings → Notifications → Rent Roll) and try again.
        </p>
      )}

      {state === "off" && (
        <>
          <p className={styles.note} style={{ marginBottom: 10 }}>
            Get {what} on this device.
            {ios && !standalone ? " On an iPhone this works once Rent Roll is open from the home screen." : ""}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={turnOn} disabled={busy}>
              {busy ? "Turning on…" : "Enable notifications"}
            </button>
          </div>
        </>
      )}

      {state === "on" && (
        <>
          <p className={styles.good} style={{ marginBottom: 10 }}>
            Notifications are on for this device.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={test} disabled={busy}>
              {busy ? "Sending…" : "Send test notification"}
            </button>
            <button type="button" className={styles.quiet} onClick={turnOff} disabled={busy}>
              Turn off on this device
            </button>
          </div>
        </>
      )}

      {message && (
        <p className={message.tone === "good" ? styles.good : styles.bad} style={{ marginTop: 10 }}>
          {message.text}
        </p>
      )}
    </div>
  );
}

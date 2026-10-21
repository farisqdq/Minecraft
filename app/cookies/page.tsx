import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../components/LegalPage";
import styles from "../components/legal.module.css";

export const metadata: Metadata = {
  title: "Cookie Policy | Rent Roll",
  description: "The cookies and browser storage Rent Roll uses, and why.",
};

export default function CookiePolicyPage() {
  return (
    <LegalPage title="Cookie Policy">
      <p>
        eqal.rentals (&quot;we&quot;, &quot;us&quot;) uses only the cookies and browser storage that Rent Roll needs to
        work. We do not use advertising cookies, tracking pixels or third-party analytics, so there is no cookie banner
        to accept. This page lists exactly what is used. For how we handle personal information more generally, see
        the <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Cookies</h2>
      <p>All of these are set by this site itself (first party) and are strictly necessary.</p>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Purpose</th>
              <th>Lasts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>next-auth.session-token</code> (shown with a <code>__Secure-</code> prefix on the live site)
              </td>
              <td>Keeps you signed in as a landlord, team member, tenant or property owner. Not readable by page scripts.</td>
              <td>Up to 7 days, or until you sign out</td>
            </tr>
            <tr>
              <td>
                <code>next-auth.csrf-token</code> and <code>next-auth.callback-url</code> (with <code>__Host-</code> or{" "}
                <code>__Secure-</code> prefixes on the live site)
              </td>
              <td>Protect the sign-in form against forged requests and remember which page to return to after you sign in.</td>
              <td>Session</td>
            </tr>
            <tr>
              <td>
                <code>rr_trust_user</code>, <code>rr_trust_tenant</code>, <code>rr_trust_owner</code>
              </td>
              <td>
                A signed marker that this device has signed in to your account before, so someone else guessing your
                password from elsewhere cannot lock you out. Set after a successful sign-in. Not readable by page
                scripts.
              </td>
              <td>90 days</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Browser storage (localStorage)</h2>
      <p>These stay on your device. They are never used to track you across other sites.</p>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>rr-install-dismissed</code>, <code>rr-notify-dismissed</code>
              </td>
              <td>Remember that you closed the &quot;install the app&quot; or &quot;turn on notifications&quot; prompt, so it does not keep coming back.</td>
            </tr>
            <tr>
              <td>
                <code>rr-command-llc</code>, <code>rr-command-rail</code>
              </td>
              <td>Remember which company you last picked and whether the side menu is collapsed (landlord layouts only).</td>
            </tr>
            <tr>
              <td>
                <code>rr-sensitive-v2</code>
              </td>
              <td>Administrator-only: remembers which backed-up photos were flagged for blurring, so each photo is checked once on your device.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Service worker and notifications</h2>
      <p>
        If you install Rent Roll on your phone or turn on notifications, your browser registers a small program called a
        service worker (<code>/sw.js</code>). It exists only so that push notifications can arrive while the site is
        closed. It does not cache pages or track you. Your device&apos;s push address is saved on our server so we can
        reach you, and it is removed when you turn notifications off. Push notifications are never enabled without
        your tap and your browser&apos;s permission.
      </p>

      <h2>Fonts</h2>
      <p>
        The site&apos;s fonts are served from our own domain. Your browser does not contact Google or other font
        services to display them.
      </p>

      <h2>Your choices</h2>
      <p>
        You can block or delete cookies and site storage in your browser settings, but the site will not be able to
        keep you signed in if you block the session cookie. You can turn off notifications in the app or in your
        device settings at any time.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:N5p0@proton.me">N5p0@proton.me</a>
      </p>
    </LegalPage>
  );
}

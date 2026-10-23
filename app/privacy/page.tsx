import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../components/LegalPage";
import styles from "../components/legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy | Rent Roll",
  description: "What Rent Roll collects, why, who receives it, how long it is kept, and your choices.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        eqal.rentals (&quot;we&quot;, &quot;us&quot;) runs Rent Roll, a web app at eqal.rentals that landlords and property
        managers use to keep track of rent, expenses, tenants, leases and documents. Tenants, property owners and rental
        applicants also use parts of it. This policy explains what personal information the site handles and what we do
        with it. It matches how the site works today.
      </p>
      <p>
        Questions or requests: <a href="mailto:N5p0@proton.me">N5p0@proton.me</a>. See also our{" "}
        <Link href="/terms">Terms of Use</Link> and <Link href="/cookies">Cookie Policy</Link>.
      </p>

      <h2>1. Who is responsible for what</h2>
      <p>
        Rent Roll is a tool. Each landlord or property manager (and their team) who signs up decides what to enter about
        their properties and tenants. For information about tenants, owners, applicants and vendors that a landlord puts
        into Rent Roll, the landlord decides why and how it is used, and we store and process it on their behalf. For
        your account details, sign-in security and the technical records described below, we decide.
      </p>
      <p>
        If you are a tenant, applicant or property owner and you want to see, fix or delete what a landlord holds about
        you, ask that landlord first. They can change most of it directly in the app. You can also write to us and we
        will help or pass your request along.
      </p>

      <h2>2. What we collect</h2>

      <h3>Landlord and team accounts</h3>
      <ul>
        <li>Your name (optional), email address and password. Passwords are stored only as a one-way hash.</li>
        <li>
          If you turn on two-factor sign-in: an encrypted authenticator secret and hashed one-time backup codes.
        </li>
        <li>Your company (LLC) memberships and role, and your appearance settings (layout, light or dark mode, accent).</li>
        <li>
          Everything you add: properties, units, tenants, leases, rent and expense records, loans, vendors, receipts and
          other documents, repair requests, inspections, mileage trips, valuations, listings and settings.
        </li>
      </ul>

      <h3>Tenant information a landlord enters</h3>
      <ul>
        <li>Name, email address, phone number, the unit, lease dates, security deposit, rent due day and notes.</li>
        <li>
          Rent payments, charges, late fees, balances, move-out records and deductions, rent notices sent, and lease
          renewals.
        </li>
        <li>
          Documents filed under the tenant, such as scanned leases. A tenant can see a document only if the landlord
          chooses to share it with them.
        </li>
        <li>Messages between the tenant and the landlord, including any files attached to them.</li>
        <li>
          Repair requests and the photos and updates attached to them, and move-in or move-out inspection photos and
          notes. When a tenant acknowledges an inspection, the name they type is saved.
        </li>
      </ul>

      <h3>Tenant portal accounts</h3>
      <ul>
        <li>Email address and password (hashed), your reminder choices, the phone number you give, and your appearance setting.</li>
        <li>
          If you turn on push notifications: a device address supplied by your browser&apos;s push service, plus a
          device label taken from your browser (for example &quot;Chrome on Android&quot;).
        </li>
      </ul>

      <h3>Property owners and investors</h3>
      <ul>
        <li>
          Name, email address, password (hashed), which properties you can view, whether you want a monthly statement
          emailed, and your appearance setting. Owners see only the figures and documents the landlord has chosen to
          show them.
        </li>
      </ul>

      <h3>People who apply for a rental</h3>
      <p>
        The public application form asks for: full name, email, phone, desired move-in date, number of people living
        there, pets, monthly income before tax, employer or income source, current address, current landlord&apos;s name
        and phone, and anything else you choose to write. It does not ask for a Social Security number, date of birth or
        bank details, and you should not enter them in the free-text box. Your answers go to the landlord who posted the
        listing. By ticking the box you also confirm that the landlord may contact your employer and current landlord to
        check what you wrote. Applications are kept out of the downloadable backup files the app produces.
      </p>

      <h3>Records created automatically</h3>
      <ul>
        <li>
          <strong>Activity log.</strong> For signed-in landlords, team members, tenants and owners: which page was opened
          or which change was made, the date and time, your email and name, your IP address, and a short device label
          (browser and system). It is used for security and to answer &quot;who changed this&quot;. Entries older than one
          year are deleted.
        </li>
        <li>
          <strong>Sign-in protection.</strong> Failed sign-in counts tied to an account or IP address, used to pause
          guessing attacks. These rows are cleared after a successful sign-in, and old ones are swept out once they are about a day old.
        </li>
        <li>
          <strong>Hosting logs.</strong> Our hosting provider keeps ordinary server logs (IP address, requested address,
          time, browser) for operating and securing the service.
        </li>
      </ul>

      <h3>Company phone backup tool (administrator only)</h3>
      <p>
        Separate from landlord, tenant and owner accounts, the site&apos;s administrator can enrol phones that the
        administrator manages in a backup tool. For an enrolled phone it can copy photos, videos, files, contacts, call
        history, text messages, a list of installed apps and the phone&apos;s location to a private server run by the
        administrator. This tool is not available to landlords, tenants or owners, and nothing is collected from your
        phone through the website unless your phone has been enrolled this way. If you use a phone that was enrolled,
        ask the administrator for details at the email above.
      </p>

      <h2>3. How we use information</h2>
      <ul>
        <li>To run the app: sign you in, show you your records, calculate balances and late fees, and keep files.</li>
        <li>To send what the app is for: password reset emails, invitations, rent and lease reminders, repair updates, owner statements and similar messages (see section 6).</li>
        <li>To keep the service secure, prevent abuse, find and fix problems, and keep the activity log.</li>
        <li>To respond to you and to meet legal obligations.</li>
      </ul>
      <p>
        We do not sell personal information, we do not share it for advertising, and we do not use it for profiling that
        has legal or similar effects. The site has no advertising or third-party analytics.
      </p>

      <h2>4. Who receives information</h2>
      <p>Within the app, access is limited by account type:</p>
      <ul>
        <li>Landlord teams see the records of the companies they belong to, according to their role (owner, member or viewer).</li>
        <li>A tenant sees only their own account, messages, repair requests, notices and any documents or inspections shared with them.</li>
        <li>A property owner sees only the properties they have been given and the items the landlord has chosen to share.</li>
        <li>The site administrator can see accounts and companies in order to run and support the service.</li>
      </ul>
      <p>We also use these service providers, who process information only to provide their service to us:</p>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>What it does</th>
              <th>What it receives</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Vercel Inc.</td>
              <td>Hosts the website, runs the daily reminder job, and stores uploaded files (Vercel Blob)</td>
              <td>All site traffic, and uploaded receipts, documents, photos and message attachments</td>
            </tr>
            <tr>
              <td>Managed PostgreSQL database provider</td>
              <td>Stores the app&apos;s records</td>
              <td>All account and record data described above</td>
            </tr>
            <tr>
              <td>Resend</td>
              <td>Sends email</td>
              <td>The recipient&apos;s email address and the text of the message (for example a reset link or a reminder)</td>
            </tr>
            <tr>
              <td>Browser push services (Apple, Google, Mozilla or Microsoft, depending on your browser)</td>
              <td>Deliver push notifications you turn on</td>
              <td>Your device address and the notification text (title and a short message)</td>
            </tr>
            <tr>
              <td>Contabo (virtual server)</td>
              <td>Hosts the administrator-only phone backup tool</td>
              <td>Backed-up phone data for enrolled phones only</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        We may also disclose information if the law requires it, to respond to valid legal process, to protect the
        safety or rights of people or the service, or as part of a sale or transfer of the service. A landlord may
        export or share their own records (for example with their accountant); that is their choice and outside our
        control.
      </p>

      <h2>5. Cookies and similar storage</h2>
      <p>
        The site uses only the cookies and browser storage it needs to sign you in, keep you safe and remember simple
        preferences. There are no advertising or analytics cookies. Details are in the <Link href="/cookies">Cookie Policy</Link>.
      </p>

      <h2 id="reminders">6. Reminders and notifications</h2>
      <p>
        If a landlord turns on automatic reminders for their company, the app can email or push-notify tenants about rent
        due soon, rent that is late, a lease ending and repair updates, and can email landlords and owners about
        reminders, new applications and statements. Messages are sent from the landlord&apos;s company through our
        system.
      </p>
      <ul>
        <li>
          <strong>Push notifications are opt-in.</strong> Nothing is sent to a device until you tap &quot;Enable
          notifications&quot; and then allow notifications in your browser or phone. You can turn them off at any time in
          the app or in your device settings.
        </li>
        <li>
          <strong>Email reminders to tenants</strong> can be switched off by the tenant in the portal under Reminders.
          A tenant without a portal account can ask the landlord, or write to us, to stop them. Account and security
          emails (such as password resets) are still sent.
        </li>
        <li>We do not send text messages (SMS) or marketing emails.</li>
      </ul>

      <h2>7. How long we keep information</h2>
      <ul>
        <li>
          Account and record data is kept while the account and the company that holds it remain active, or until it is
          deleted by the landlord or on request. There is no automatic expiry for tenant, lease, payment, document or
          application records. Landlords decide how long to keep them and are expected to keep records only as long as
          they have a legal or business need.
        </li>
        <li>
          When a landlord deletes a tenant, the tenant&apos;s portal login, charges, notices, messages, inspections,
          move-out record and invitations are deleted with it. Repair requests, documents and rental applications
          connected to that person are kept as separate records until the landlord deletes them.
        </li>
        <li>Deleting a document or receipt removes its stored file when no other record still points to it.</li>
        <li>The activity log is kept for one year. Sign-in protection records are short-lived (see section 2).</li>
        <li>
          Deleted data may remain in provider backups for a limited time before it is overwritten. We may keep limited
          records where the law requires or to resolve disputes.
        </li>
      </ul>

      <h2>8. Security</h2>
      <p>
        Passwords are hashed. Pages are served over HTTPS. Uploaded files are held in a private store and are served
        only to signed-in people who are allowed to see them. Tenant, owner and landlord sign-ins are kept separate, and
        two-factor sign-in is available to landlords. Failed sign-ins are rate limited. No online service can promise
        perfect security, so please use a strong, unique password. If we learn of a breach affecting your information we
        will notify the people and authorities required by law, including under Kentucky&apos;s breach notification law.
      </p>

      <h2>9. Your rights and choices</h2>
      <p>
        Depending on where you live, you may have the right to know what we hold about you, get a copy, correct it,
        delete it, and object to or limit some uses. We apply these rights to everyone, in plain terms:
      </p>
      <ul>
        <li>Ask us what personal information we hold about you and get a copy.</li>
        <li>Ask us to correct or delete it. Landlords can edit or delete most of their own records in the app.</li>
        <li>Turn off reminders and push notifications as described in section 6.</li>
        <li>We do not sell or share personal information for advertising, so there is nothing to opt out of.</li>
        <li>We will not treat you worse for using these rights.</li>
      </ul>
      <p>
        To make a request, email <a href="mailto:N5p0@proton.me">N5p0@proton.me</a> from the address on your account or
        give us enough detail to identify you. We aim to answer within 45 days. If the information is held on behalf of a
        landlord, we may need to involve that landlord, and some records may have to be kept for legal reasons (for
        example rent and deposit records). If you disagree with our answer you can reply to ask us to reconsider, and
        you may contact the Kentucky Attorney General&apos;s office.
      </p>

      <h2>10. Children</h2>
      <p>
        Rent Roll is for adults who manage, rent or invest in property. It is not directed to children under 13, and
        accounts are not meant for anyone under 18. We do not knowingly collect personal information from children. A
        rental application asks only for the number of people who will live in the home, not their names. If you
        believe a child has given us information, email us and we will delete it.
      </p>

      <h2>11. Where information is processed</h2>
      <p>
        We are based in the United States. Our service providers may process information in the United States and other
        countries where they operate.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        We may update this policy as the site changes. The effective date at the top shows the latest version. If a
        change is significant we will say so in the app or by email to account holders.
      </p>

      <h2>13. Contact</h2>
      <p>
        eqal.rentals, Lexington, Kentucky, USA.
        <br />
        Email: <a href="mailto:N5p0@proton.me">N5p0@proton.me</a>
      </p>
    </LegalPage>
  );
}

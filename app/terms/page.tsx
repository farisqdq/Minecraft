import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Use | Rent Roll",
  description: "The rules for using Rent Roll: accounts, acceptable use, disclaimers and limits of liability.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        These terms apply to your use of Rent Roll, the rental property management web app at eqal.rentals, run by
        eqal.rentals (&quot;we&quot;, &quot;us&quot;). By creating an account, signing in, or using the site (including
        submitting a rental application), you agree to these terms and to our{" "}
        <Link href="/privacy">Privacy Policy</Link>. If you do not agree, please do not use the site.
      </p>

      <h2>1. What Rent Roll is</h2>
      <p>
        Rent Roll is record-keeping software. Landlords and property managers use it to log rent, expenses, tenants,
        leases and documents, send reminders, and share information with tenants and property owners. Tenants use a
        portal to see their balance, message the landlord and report repairs. Applicants use a public form to apply for
        a place.
      </p>
      <p>
        <strong>Rent Roll does not collect or process rent or any other payment.</strong> Payments are recorded in the
        app after they happen elsewhere. We are not a party to any lease or rental agreement.
      </p>

      <h2>2. Not legal, tax, accounting or financial advice</h2>
      <p>
        Calculations, late fee settings, notices, reminders, statements, tax exports (including the 1099 export), and
        reports are tools to help you keep records. They may be wrong or incomplete, and they are not legal, tax,
        accounting or financial advice. Landlord and tenant law (including the Kentucky Uniform Residential Landlord and
        Tenant Act where it applies, local ordinances, and federal and state fair housing laws) is complicated and
        changes. A message sent through Rent Roll is not a formal legal notice unless the law and your lease say it is
        one. Check with a qualified professional before you rely on the app for legal or tax decisions.
      </p>

      <h2>3. Accounts</h2>
      <ul>
        <li>You must be at least 18 and able to enter into a binding agreement.</li>
        <li>Give accurate information and keep your password secret. You are responsible for what happens under your account.</li>
        <li>Landlord accounts can invite team members, tenants and property owners. Tenant and owner accounts exist only to view the information the landlord chooses to share.</li>
        <li>Tell us right away at <a href="mailto:N5p0@proton.me">N5p0@proton.me</a> if you think your account has been used without your permission.</li>
        <li>We may suspend or close an account that breaks these terms, puts the service or others at risk, or is unused. A company owner can remove people from their company.</li>
      </ul>

      <h2>4. Landlord responsibilities</h2>
      <p>If you use Rent Roll to manage tenants or applicants, you agree that:</p>
      <ul>
        <li>
          You are responsible for the information you enter and for having the right to enter it, and for how you use
          it. You are the one who decides what to collect about tenants, applicants and owners, and how long to keep it.
        </li>
        <li>
          You will follow the laws that apply to you, including landlord-tenant law, fair housing law (you will not
          discriminate against applicants or tenants on a protected basis), security deposit rules, rules on late fees,
          notices and entry, tenant screening and consumer reporting rules, privacy and data security law, and
          anti-spam and telephone laws.
        </li>
        <li>
          You will only turn on reminders and notifications for tenants and owners where you are allowed to contact
          them, and you will honor requests to stop.
        </li>
        <li>
          You will only share a document with a tenant or owner when it is appropriate to do so, and you understand that
          once shared they can see it.
        </li>
        <li>
          Any late fee, charge or deduction you set up is your decision. Rent Roll applies the settings you choose and
          does not check that they are lawful or allowed by your lease.
        </li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>break the law or violate someone&apos;s rights, including privacy and fair housing rights;</li>
        <li>upload content that is unlawful, harassing, threatening, sexually explicit, or that you do not have the right to share;</li>
        <li>upload malware, or try to disrupt, probe, overload or bypass the security of the site;</li>
        <li>access another person&apos;s account, company or data, or try to guess passwords or codes;</li>
        <li>use bots, scrapers or automated tools to collect data from the site, or submit applications in bulk or with false identities;</li>
        <li>use the site to send spam or unsolicited messages;</li>
        <li>resell or provide the site to others, or reverse engineer it, except as the law allows.</li>
      </ul>

      <h2>6. Your content</h2>
      <p>
        You keep ownership of what you upload or enter (records, documents, photos, messages). You give us permission
        to store, process, display and transmit it as needed to run the service for you and the people you share it
        with. You promise you have the right to give that permission. We may remove content that breaks these terms or
        the law.
      </p>
      <p>
        The Rent Roll software, design and branding belong to us or our licensors. These terms give you a limited,
        non-exclusive, non-transferable right to use the site as intended while you comply with these terms.
      </p>

      <h2>7. Notifications and email</h2>
      <p>
        By using the site you agree that we may send you service emails, such as password resets, invitations and
        security alerts. Reminders and push notifications are described in the Privacy Policy. Push notifications are
        off until you turn them on.
      </p>

      <h2>8. Rental applications</h2>
      <p>
        Submitting an application sends your information to the landlord who posted the listing. We do not screen
        applicants, run credit or background checks, or decide who gets a rental. The landlord makes those decisions.
        Submitting an application does not guarantee a lease. Answers must be true.
      </p>

      <h2>9. Availability and changes</h2>
      <p>
        We try to keep the site running, but we do not promise it will always be available, error free or free of data
        loss. We may change, pause or end features, or the whole service, at any time. Keep your own copies of records
        you cannot afford to lose; the app includes export and backup tools for this.
      </p>

      <h2>10. Disclaimer of warranties</h2>
      <p>
        THE SITE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;, WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
        IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY AND
        NON-INFRINGEMENT, TO THE FULLEST EXTENT THE LAW ALLOWS. WE DO NOT WARRANT THAT CALCULATIONS, REMINDERS,
        STATEMENTS OR EXPORTS ARE CORRECT, COMPLETE OR LEGALLY SUFFICIENT.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        TO THE FULLEST EXTENT THE LAW ALLOWS, WE ARE NOT LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR
        PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST RENT, LOST DATA OR LOST BUSINESS, ARISING FROM YOUR USE OF THE SITE
        OR INABILITY TO USE IT, EVEN IF WE WERE TOLD THEY WERE POSSIBLE. OUR TOTAL LIABILITY FOR ANY CLAIM RELATED TO
        THE SITE IS LIMITED TO THE GREATER OF THE AMOUNT YOU PAID US FOR THE SITE IN THE 12 MONTHS BEFORE THE CLAIM AND
        $100. Some places do not allow certain limits, so parts of this section may not apply to you.
      </p>

      <h2>12. Indemnity</h2>
      <p>
        You agree to defend and reimburse us for claims, losses and costs (including reasonable legal fees) that arise
        from your content, your use of the site in violation of these terms or the law, or your dealings with your
        tenants, applicants, owners or vendors.
      </p>

      <h2>13. Governing law and disputes</h2>
      <p>
        These terms are governed by the laws of the Commonwealth of Kentucky, USA, without regard to conflict-of-law
        rules. Any dispute will be brought in the state or federal courts located in or serving Fayette County,
        Kentucky, and you agree to their jurisdiction. Please contact us first at{" "}
        <a href="mailto:N5p0@proton.me">N5p0@proton.me</a> so we can try to sort it out informally.
      </p>

      <h2>14. Changes to these terms</h2>
      <p>
        We may update these terms. The effective date above shows the latest version. If you keep using the site after
        a change takes effect, you accept the new terms.
      </p>

      <h2>15. General</h2>
      <p>
        If part of these terms cannot be enforced, the rest still applies. Our failure to enforce a term is not a
        waiver. You may not transfer your rights under these terms; we may transfer ours. These terms and the Privacy
        Policy are the whole agreement between you and us about the site.
      </p>

      <h2>16. Contact</h2>
      <p>
        eqal.rentals, Lexington, Kentucky, USA.
        <br />
        Email: <a href="mailto:N5p0@proton.me">N5p0@proton.me</a>
      </p>
    </LegalPage>
  );
}

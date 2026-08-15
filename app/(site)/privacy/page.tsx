import type { Metadata } from "next";

import { DraftNotice, LegalShell } from "@/components/site/legal-shell";
import { RESELLER_DISCLAIMER, siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What personal data Games Central collects, why we collect it, who we share it with, and how long we keep it.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro="We collect the minimum needed to deliver your top-up and prove that we did. No customer accounts, no advertising trackers, no selling your data."
      lastUpdated="15 August 2026"
    >
      <DraftNotice>
        The registered business name, legal entity, and data-retention periods
        below need the owner&apos;s confirmation before this page goes live.
      </DraftNotice>

      <h2>Who we are</h2>
      <p>
        {siteConfig.name} is an online top-up service operating in Pakistan.
        Our registered address and contact details are on our{" "}
        <a href="/contact">contact page</a>.{" "}
        <strong>TODO(owner): registered legal entity name and, if
        applicable, company registration number.</strong>
      </p>

      <h2>What we collect</h2>
      <h3>Information you give us</h3>
      <ul>
        <li>
          <strong>Mobile Legends Player ID and Zone ID</strong> — required to
          deliver diamonds to the correct account.
        </li>
        <li>
          <strong>Email address and/or phone number</strong> — used to send
          your order confirmation and to let you look up your order later.
        </li>
      </ul>

      <h3>Information we receive from others</h3>
      <ul>
        <li>
          <strong>Your in-game username</strong>, returned by our supplier when
          we verify the Player ID you entered. We show it to you for
          confirmation and store it with the order.
        </li>
        <li>
          <strong>Payment status</strong> from our payment provider — whether a
          payment succeeded, and a reference number.{" "}
          <strong>
            We never receive or store your card number, CVV, or wallet PIN.
          </strong>
        </li>
      </ul>

      <h3>Information collected automatically</h3>
      <ul>
        <li>
          Basic technical logs (IP address, timestamp, and the action taken)
          for security, fraud prevention, and rate limiting.
        </li>
      </ul>
      <p>
        We do not create customer accounts, and we do not use advertising or
        cross-site tracking cookies.
      </p>

      <h2>Why we use it</h2>
      <ul>
        <li>To verify the game account you are topping up and deliver your order.</li>
        <li>To take payment and confirm it succeeded.</li>
        <li>To send you a receipt and let you track your order.</li>
        <li>To investigate failed deliveries, refunds, and disputes.</li>
        <li>To prevent fraud and abuse of the service.</li>
        <li>To meet accounting and legal record-keeping obligations.</li>
      </ul>

      <h2>Who we share it with</h2>
      <p>We share only what each provider needs to do its job:</p>
      <ul>
        <li>
          <strong>Our top-up supplier</strong> receives your Player ID, Zone ID,
          and the package ordered, so the diamonds can be credited.
        </li>
        <li>
          <strong>Our payment provider (PayFast Pakistan)</strong> receives the
          order amount and reference, and handles your payment details directly
          on their own secure checkout.
        </li>
        <li>
          <strong>Our hosting and database providers</strong> store the site and
          order records on our behalf.
        </li>
        <li>
          <strong>Authorities</strong>, where we are legally required to
          disclose information.
        </li>
      </ul>
      <p>
        <strong>We do not sell your personal data, and we never have.</strong>
      </p>

      <h2>How long we keep it</h2>
      <p>
        Order records — including Player ID, Zone ID, in-game username, contact
        details, and payment reference — are kept for{" "}
        <strong>TODO(owner): retention period, commonly 5–7 years</strong> to
        meet accounting and dispute-resolution requirements. Technical security
        logs are kept for a shorter period and then deleted.
      </p>

      <h2>How we protect it</h2>
      <ul>
        <li>The whole site is served over HTTPS.</li>
        <li>
          Payment details are entered on our payment provider&apos;s systems,
          never on ours.
        </li>
        <li>
          Access to order data is restricted to authorised administrators
          behind a separate, password-protected login.
        </li>
        <li>
          Credentials for our suppliers and database are held as server-side
          secrets and are never exposed to your browser.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can ask us to provide a copy of the data we hold about you, correct
        it if it is wrong, or delete it where we are not required to keep it.
        Email {siteConfig.contact.email} with your order ID and we will respond
        within a reasonable period.
      </p>

      <h2>Children</h2>
      <p>
        This service is not directed at children under 13. If you are under 18,
        please use it only with the permission of a parent or guardian who is
        responsible for the payment method used.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If we change this policy we will update the &quot;last updated&quot;
        date above. Material changes will be highlighted on the site.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions: {siteConfig.contact.email} ·{" "}
        {siteConfig.contact.phone}.
      </p>

      <h2>Disclaimer</h2>
      <p>{RESELLER_DISCLAIMER}</p>
    </LegalShell>
  );
}

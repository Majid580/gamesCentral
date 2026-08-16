import type { Metadata } from "next";

import { LegalShell } from "@/components/site/legal-shell";
import { RESELLER_DISCLAIMER, siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "The terms governing your use of Games Central and any Mobile Legends diamond top-up you purchase from us.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms & Conditions"
      intro="These terms govern your use of Games Central and any order you place. By placing an order you accept them."
      lastUpdated="16 August 2026"
    >
      <h2>1. Who we are</h2>
      <p>
        {siteConfig.legal.entityName} (&quot;we&quot;, &quot;us&quot;) is{" "}
        {siteConfig.legal.entityForm}, and operates this website and sells
        top-ups for Mobile Legends: Bang Bang.
      </p>
      <p>
        Our business address is{" "}
        {siteConfig.contact.addressLines.join(", ")}. You can contact us on{" "}
        {siteConfig.contact.phone} or at {siteConfig.contact.email}.
      </p>

      <h2>2. What we sell</h2>
      <p>
        We sell in-game diamonds credited directly to a Mobile Legends account
        that you identify by Player ID and Zone ID. We are a reseller. We do not
        operate the game and we do not control the game publisher&apos;s
        decisions about your account.
      </p>

      <h2>3. Eligibility</h2>
      <ul>
        <li>You must be at least 18, or have permission from a parent or guardian.</li>
        <li>
          You must be authorised to use the payment method you pay with.
        </li>
        <li>
          You must own, or have permission to top up, the game account you enter.
        </li>
      </ul>

      <h2>4. Placing an order</h2>
      <ol>
        <li>You select a package and enter your Player ID and Zone ID.</li>
        <li>
          We look up the account and display the in-game username registered to
          it. <strong>You are responsible for checking that this is your
          account before continuing.</strong>
        </li>
        <li>
          You pay through our payment provider. A contract is formed when your
          payment is confirmed and we accept your order.
        </li>
        <li>We deliver the diamonds automatically to that account.</li>
      </ol>
      <p>
        We may decline or cancel an order — refunding you in full — if we
        suspect fraud, if the package is unavailable, if a price was displayed
        in error, or if we are unable to verify the game account.
      </p>

      <h2>5. Prices and payment</h2>
      <ul>
        <li>All prices are shown in Pakistani Rupees (PKR) and are inclusive.</li>
        <li>
          The price shown when you confirm your order is the price you pay.
          Prices may change at any time before you place an order.
        </li>
        <li>
          Payments are processed by PayFast Pakistan on their own secure
          checkout. We do not receive or store your card or wallet credentials.
        </li>
        <li>
          We reserve the right to correct an obviously incorrect price before
          delivering, and to cancel and refund the order if you do not accept
          the corrected price.
        </li>
      </ul>

      <h2>6. Delivery</h2>
      <p>
        Delivery is digital, automatic, and normally completed within a few
        minutes of payment. Full details, including what happens if an order is
        delayed, are in our <a href="/delivery">Delivery Policy</a>.
      </p>

      <h2>7. Refunds</h2>
      <p>
        Delivered diamonds cannot be returned. We refund in full where we fail
        to deliver, where you are charged twice, or where you are charged
        without an order. See our <a href="/refund">Refund Policy</a> for the
        full terms.
      </p>

      <h2>8. Your responsibilities</h2>
      <ul>
        <li>
          Entering the correct Player ID and Zone ID, and checking the in-game
          username we show you before paying.
        </li>
        <li>
          Not using the service for fraudulent payments, money laundering, or
          any unlawful purpose.
        </li>
        <li>
          Not attempting to disrupt, probe, overload, or gain unauthorised
          access to the site or its systems.
        </li>
        <li>
          Not reselling or automating bulk purchases without our written
          agreement.
        </li>
      </ul>

      <h2>9. Our liability</h2>
      <p>
        We are responsible for delivering the diamonds you paid for. Where we
        fail to do so, our liability is limited to refunding the amount you
        paid for that order.
      </p>
      <p>
        We are not liable for losses arising from an incorrect Player ID or
        Zone ID that you confirmed, from action taken by the game publisher
        against your account, or from downtime or changes on the game or
        supplier side that are outside our control.
      </p>
      <p>Nothing in these terms limits liability that cannot lawfully be limited.</p>

      <h2>10. Service availability</h2>
      <p>
        We aim to keep the service available continuously, but we do not
        guarantee uninterrupted access. We may suspend the service for
        maintenance or for reasons outside our control.
      </p>

      <h2>11. Intellectual property</h2>
      <p>
        The site, its design, and its content belong to us. Mobile Legends: Bang
        Bang and all related names, marks, and assets belong to Moonton.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>
        We may update these terms. The version published at the time you place
        an order is the version that applies to that order.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These terms are governed by the laws of the Islamic Republic of
        Pakistan, and any dispute arising from them is subject to the exclusive
        jurisdiction of {siteConfig.legal.jurisdiction}.
      </p>

      <h2>14. Contact</h2>
      <p>
        {siteConfig.contact.email} · {siteConfig.contact.phone}. Our business
        address is on the <a href="/contact">contact page</a>.
      </p>

      <h2>15. Disclaimer</h2>
      <p>{RESELLER_DISCLAIMER}</p>
    </LegalShell>
  );
}

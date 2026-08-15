import type { Metadata } from "next";

import { DraftNotice, LegalShell } from "@/components/site/legal-shell";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "When Games Central issues refunds for Mobile Legends diamond top-ups, how to request one, and how long refunds take.",
};

export default function RefundPolicyPage() {
  return (
    <LegalShell
      title="Return & Refund Policy"
      intro="Diamonds are a digital good credited directly to your game account. This policy explains exactly when a refund is and is not possible."
      lastUpdated="15 August 2026"
    >
      <DraftNotice>
        Refund windows and processing times must be checked against what
        PayFast and our supplier actually permit before this page goes live.
      </DraftNotice>

      <h2>Summary</h2>
      <p>
        Because diamonds are credited instantly and irreversibly to a game
        account, a delivered order cannot be returned. We do refund in full when
        we fail to deliver, when you are charged twice, or when you are charged
        without an order being created.
      </p>

      <h2>When you are entitled to a full refund</h2>
      <ul>
        <li>
          <strong>We could not deliver your order.</strong> If your payment
          succeeded but the diamonds cannot be credited, and we cannot resolve
          it, you are refunded in full.
        </li>
        <li>
          <strong>You were charged more than once</strong> for the same order.
          Duplicate charges are refunded in full.
        </li>
        <li>
          <strong>You were charged but no order exists.</strong> If money left
          your account and no order was created, it is refunded in full.
        </li>
        <li>
          <strong>The order was never confirmed by you.</strong> If a payment
          was taken without you completing the confirmation step, it is
          refunded in full.
        </li>
      </ul>

      <h2>When a refund is not possible</h2>
      <ul>
        <li>
          <strong>The diamonds were delivered successfully.</strong> Once
          credited to a game account, they cannot be reclaimed by us.
        </li>
        <li>
          <strong>You entered the wrong Player ID or Zone ID and confirmed
          it.</strong> We display the in-game username attached to the IDs you
          enter and ask you to confirm it before taking payment. Once confirmed
          and delivered, the diamonds belong to that account.
        </li>
        <li>
          <strong>You changed your mind after delivery.</strong> Digital goods
          that have been delivered are not returnable.
        </li>
        <li>
          <strong>Your game account was banned, suspended, or lost</strong> by
          the game publisher after delivery. That is a matter between you and
          Moonton.
        </li>
      </ul>

      <h2>How to request a refund</h2>
      <ol>
        <li>
          Contact us at {siteConfig.contact.email} or{" "}
          {siteConfig.contact.phone}.
        </li>
        <li>
          Include your <strong>order ID</strong> and the email or phone number
          you used at checkout.
        </li>
        <li>Describe what happened. Screenshots help but are not required.</li>
      </ol>
      <p>
        Refund requests should be made within <strong>7 days</strong> of the
        order date.
      </p>

      <h2>How long a refund takes</h2>
      <p>
        We aim to review every request within <strong>48 hours</strong>.
        Approved refunds are returned through the original payment method. Your
        bank or wallet provider controls the final step, which typically takes{" "}
        <strong>5–10 business days</strong> to appear on your statement.
      </p>
      <p>
        Refunds are always returned to the original payment method. We cannot
        refund to a different account, card, or wallet.
      </p>

      <h2>Chargebacks</h2>
      <p>
        If something has gone wrong, please contact us first — we can usually
        resolve it faster than a bank dispute. Raising a chargeback on an order
        that was delivered successfully may result in your access to this
        service being withdrawn.
      </p>

      <h2>Contact</h2>
      <p>
        {siteConfig.contact.email} · {siteConfig.contact.phone} ·{" "}
        {siteConfig.contact.hours}. See our{" "}
        <a href="/contact">contact page</a> for our registered address.
      </p>
    </LegalShell>
  );
}

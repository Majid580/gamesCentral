import type { Metadata } from "next";

import { LegalShell } from "@/components/site/legal-shell";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Delivery Policy",
  description:
    "How Games Central delivers Mobile Legends diamond top-ups, expected delivery times, and what happens if an order is delayed.",
};

export default function DeliveryPolicyPage() {
  return (
    <LegalShell
      title="Delivery Policy"
      intro="Games Central sells digital goods. Nothing is shipped physically — diamonds are credited directly to your Mobile Legends account."
      lastUpdated="16 August 2026"
    >
      <h2>What you are buying</h2>
      <p>
        You are buying in-game Mobile Legends: Bang Bang diamonds, credited to
        the game account matching the Player ID and Zone ID you provide at
        checkout. There is no physical product and no shipping.
      </p>

      <h2>How delivery works</h2>
      <ol>
        <li>You select a diamond package and enter your Player ID and Zone ID.</li>
        <li>
          We look up your account and show you the in-game username registered
          to it. You confirm it is yours before any payment is taken.
        </li>
        <li>You complete payment on our payment provider&apos;s secure page.</li>
        <li>
          Once payment is confirmed, your order is submitted automatically to
          our supplier and the diamonds are credited to your account.
        </li>
      </ol>

      <h2>Delivery time</h2>
      <p>
        Orders are normally delivered <strong>within 1–5 minutes</strong> of
        payment being confirmed. Delivery is automated and runs 24 hours a day.
      </p>
      <p>
        At times of very high demand, or during maintenance on the game or
        supplier side, delivery can take longer. If your order has not arrived
        within <strong>30 minutes</strong>, contact us with your order ID.
      </p>

      <h2>If an order is delayed</h2>
      <p>
        Every payment we accept is recorded against an order ID before delivery
        is attempted. If delivery fails for any reason after your payment has
        been taken, the order is flagged for manual review and completed by our
        team — your payment is never simply lost.
      </p>
      <p>
        We aim to resolve any delayed order within{" "}
        <strong>24 hours</strong>. If we cannot deliver, you are refunded in
        full under our <a href="/refund">Refund Policy</a>.
      </p>

      <h2>Incorrect Player ID or Zone ID</h2>
      <p>
        We show you the in-game username attached to the IDs you enter
        specifically so that a typo can be caught before payment. Once you have
        confirmed that username and paid, the delivery is made to that account
        and{" "}
        <strong>
          cannot be reversed, transferred, or recovered
        </strong>
        . Please check the name carefully.
      </p>

      <h2>Order tracking</h2>
      <p>
        You do not need an account. Every order has an order ID, sent to the
        email address you provide at checkout, which you can use on our{" "}
        <a href="/track">order tracking page</a> together with that email or
        phone number.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about a delivery: {siteConfig.contact.email} ·{" "}
        {siteConfig.contact.phone}. {siteConfig.contact.hours}. Full details on
        our <a href="/contact">contact page</a>.
      </p>
    </LegalShell>
  );
}

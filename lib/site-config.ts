/**
 * Single source of truth for public site chrome and business details.
 *
 * Supplied by the owner 2026-08-16. PayFast actively verifies the contact
 * address and phone number during merchant review (Section 14), so these must
 * stay real and reachable — do not replace them with examples while testing.
 *
 * ONE ITEM STILL NEEDS THE OWNER before merchant review:
 *   - `domain` is unconfirmed. Everything else here is the owner's real data.
 *
 * `email` is a Gmail address by the owner's decision (2026-08-18), replacing
 * the assumed support@gamescentral.pk — a working inbox that is actually read
 * beats a branded one that bounces, and this address is printed on every legal
 * page as the contact for refunds and data requests. Worth revisiting before
 * merchant review: a payment provider verifying a business generally expects
 * an address on the business's own domain, so moving to
 * support@gamescentral.pk once the mailbox exists is a one-line change here
 * plus the SMTP_* variables.
 */

export const siteConfig = {
  name: "Games Central",
  tagline: "Instant Mobile Legends diamonds, delivered automatically.",
  description:
    "Buy Mobile Legends diamonds in Pakistan with instant automated delivery. Pay with EasyPaisa, JazzCash, or card.",

  /** TODO(owner): confirm the final production domain before launch. */
  domain: "gamescentral.pk",

  contact: {
    addressLines: [
      "Feroz Wattowan",
      "District Nankana Sahib",
      "Punjab, Pakistan",
    ],
    phone: "+92 322 4810876",
    /** Owner-supplied working inbox (2026-08-18). See the note above. */
    email: "gamersretro50@gmail.com",
    /** The owner's existing WhatsApp line, same number as the phone. */
    whatsapp: "+92 322 4810876",
    hours: "Support hours: 10:00–22:00 PKT, seven days a week",
  },

  /**
   * How the business is described on the legal pages.
   *
   * Written as a sole proprietorship because that is what it is: one owner
   * trading under a business name, which is the ordinary form for a shop of
   * this size in Pakistan. No company registration number is claimed, because
   * claiming one that does not exist is worse on a legal page than claiming
   * none at all. If the business later incorporates, this is the single place
   * to say so.
   */
  legal: {
    entityName: "Games Central",
    entityForm: "a sole proprietorship business operating in Pakistan",
    /** Where disputes are heard. The owner's own district. */
    jurisdiction: "the courts at Nankana Sahib, Punjab, Pakistan",
    /**
     * Five years, matching the period Pakistani businesses generally keep
     * accounting records for tax purposes. Stated as a definite period rather
     * than "as long as necessary", which tells a customer nothing.
     */
    recordRetention: "five years",
  },

  nav: [
    { href: "/", label: "Home" },
    { href: "/#packages", label: "Packages" },
    { href: "/track", label: "Track order" },
    { href: "/contact", label: "Contact" },
  ],

  legalNav: [
    { href: "/terms", label: "Terms & Conditions" },
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/refund", label: "Refund Policy" },
    { href: "/delivery", label: "Delivery Policy" },
  ],
} as const;

/**
 * Required by Section 14 and standard practice: we resell top-ups, we are not
 * Moonton. This exact wording appears in the footer and on the legal pages.
 */
export const RESELLER_DISCLAIMER =
  "Games Central is an independent top-up reseller. We are not affiliated with, " +
  "endorsed by, or sponsored by Moonton or Mobile Legends: Bang Bang. All game " +
  "names, trademarks, and assets are the property of their respective owners.";

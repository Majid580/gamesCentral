/**
 * Single source of truth for public site chrome and business details.
 *
 * Everything marked TODO(owner) must be replaced with real values before
 * go-live. PayFast actively verifies the contact address and phone number
 * during merchant review — placeholders will fail that review (Section 14).
 */

export const siteConfig = {
  name: "Games Central",
  tagline: "Instant Mobile Legends diamonds, delivered automatically.",
  description:
    "Buy Mobile Legends diamonds in Pakistan with instant automated delivery. Pay with EasyPaisa, JazzCash, or card.",

  /** TODO(owner): confirm the final production domain. */
  domain: "gamescentral.pk",

  contact: {
    /** TODO(owner): real registered office address — PayFast verifies this. */
    addressLines: [
      "[TODO: Street address]",
      "[TODO: City, Postal code]",
      "Pakistan",
    ],
    /** TODO(owner): real reachable business number — PayFast verifies this. */
    phone: "[TODO: +92 XXX XXXXXXX]",
    /** TODO(owner): monitored support inbox on the final domain. */
    email: "[TODO: support@gamescentral.pk]",
    /** TODO(owner): WhatsApp number for the existing manual channel. */
    whatsapp: "[TODO: +92 XXX XXXXXXX]",
    hours: "Support hours: 10:00–22:00 PKT, seven days a week",
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

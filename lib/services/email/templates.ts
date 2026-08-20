import "server-only";

/*
 * Relative imports, matching `lib/fulfilment-plan.ts` and the model files and
 * for the same reason: `npm run email:preview` loads this module directly, and
 * Node does not resolve the `@/` alias from tsconfig. Keeping these relative is
 * what lets the preview render the real templates instead of a copy that can
 * drift away from what customers actually receive.
 */
import { siteUrl } from "../../env.ts";
import { siteConfig } from "../../site-config.ts";
import { formatPkr } from "../../utils/money.ts";

import type { OutboundEmail } from "./transport.ts";

/**
 * Email bodies.
 *
 * Every message here is written on the assumption that the reader has just
 * given a stranger on the internet real money for something they cannot see
 * arrive. So: say what happened, say what happens next, and never imply a
 * payment or a delivery that has not actually occurred.
 *
 * Each one ships plain text alongside HTML. Not politeness — Gmail's clipping,
 * corporate filters and every "plain text only" client render the text part,
 * and a customer whose order ID only exists in an HTML body they cannot read
 * is exactly the person this feature was built for.
 */

/* ------------------------------------------------------------------ */
/* Escaping                                                            */
/* ------------------------------------------------------------------ */

/**
 * These bodies interpolate customer-controlled values — an in-game username
 * chosen by someone else, a player ID typed into a form. React is not involved
 * in a string template, so nothing escapes them automatically and every one of
 * them has to go through here.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

/**
 * Inline styles and a table, because that is what email clients support.
 * Outlook ignores most of a stylesheet and Gmail strips `<style>` in several
 * contexts, so the layout stays deliberately primitive — one column, system
 * fonts, no images to block, and colours that survive a dark-mode client
 * inverting them.
 */
function shell(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f3f8fd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b2537;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #cfe1f2;">
    <tr><td style="padding:28px 28px 8px 28px;">
      <p style="margin:0 0 20px 0;font-size:15px;font-weight:700;letter-spacing:0.02em;color:#0b6ea6;">GAMES CENTRAL</p>
      <h1 style="margin:0 0 16px 0;font-size:21px;line-height:1.3;font-weight:700;">${esc(heading)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:8px 28px 28px 28px;">
      <p style="margin:20px 0 0 0;padding-top:16px;border-top:1px solid #cfe1f2;font-size:12px;line-height:1.6;color:#4c6b82;">
        Games Central &middot; ${esc(siteConfig.contact.phone)}<br>
        Questions? Reply to this email or message us on WhatsApp.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function detailRows(rows: [string, string][]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;font-size:14px;">
    ${rows
      .map(
        ([label, value]) =>
          `<tr>
            <td style="padding:6px 12px 6px 0;color:#4c6b82;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
            <td style="padding:6px 0;font-weight:600;word-break:break-word;">${esc(value)}</td>
          </tr>`,
      )
      .join("")}
  </table>`;
}

function orderIdBlock(orderId: string): string {
  return `<p style="margin:20px 0;padding:14px;background:#f3f8fd;border:1px solid #cfe1f2;border-radius:8px;text-align:center;font-size:20px;font-weight:700;letter-spacing:0.08em;">${esc(orderId)}</p>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">${esc(text)}</p>`;
}

/**
 * Absolute base for links in an email, which have nowhere relative to resolve
 * against.
 *
 * `siteUrl()` is the canonical source but throws when NEXT_PUBLIC_SITE_URL is
 * missing on a production build. Throwing here would take down a delivery
 * notification over a missing link, so it falls back to the configured domain:
 * a link that might be wrong beats an email that never arrives.
 */
function baseUrl(): string {
  try {
    return siteUrl();
  } catch {
    return `https://${siteConfig.domain}`;
  }
}

function trackUrl(): string {
  return `${baseUrl()}/track`;
}

/* ------------------------------------------------------------------ */
/* Shared shape                                                        */
/* ------------------------------------------------------------------ */

export type OrderEmailFacts = {
  orderId: string;
  displayName: string;
  pricePkr: number;
  playerId: string;
  zoneId: string | null;
  confirmedUsername: string | null;
  contactEmail: string;
};

function accountLine(facts: OrderEmailFacts): string {
  const target = facts.zoneId ? `${facts.playerId} (${facts.zoneId})` : facts.playerId;
  return facts.confirmedUsername ? `${facts.confirmedUsername} — ${target}` : target;
}

function commonRows(facts: OrderEmailFacts): [string, string][] {
  return [
    ["Package", facts.displayName],
    ["Price", formatPkr(facts.pricePkr)],
    ["Account", accountLine(facts)],
  ];
}

/* ------------------------------------------------------------------ */
/* 1. Order saved                                                      */
/* ------------------------------------------------------------------ */

/**
 * Sent the moment an order exists, before any payment.
 *
 * The whole reason this feature was built: a customer who closes the tab has
 * their order ID nowhere else, and without it the tracking page cannot help
 * them. It goes out early on purpose — an email that only arrives after a
 * successful payment is missing for precisely the people who most need to get
 * in touch.
 *
 * It is therefore careful never to read as a receipt. Nothing has been charged
 * at this point, and saying so plainly is better than a cheerful subject line
 * that a customer later quotes back asking where their diamonds are.
 */
export function orderSavedEmail(facts: OrderEmailFacts): OutboundEmail {
  const rows = detailRows([["Order ID", facts.orderId], ...commonRows(facts)]);

  return {
    to: facts.contactEmail,
    subject: `Your order ${facts.orderId} is saved — Games Central`,
    text: [
      `Your order is saved.`,
      ``,
      `Order ID: ${facts.orderId}`,
      `Package:  ${facts.displayName}`,
      `Price:    ${formatPkr(facts.pricePkr)}`,
      `Account:  ${accountLine(facts)}`,
      ``,
      `Keep this order ID. You'll need it, along with this email address, to`,
      `look your order up at ${trackUrl()}`,
      ``,
      `Nothing has been charged yet, and no diamonds have been sent. We'll`,
      `email you again as soon as your order is delivered.`,
      ``,
      `Games Central · ${siteConfig.contact.phone}`,
    ].join("\n"),
    html: shell(
      "Your order is saved",
      [
        paragraph(
          "Keep this order ID somewhere safe — you'll need it, along with this email address, to look your order up.",
        ),
        orderIdBlock(facts.orderId),
        rows,
        `<p style="margin:0 0 14px 0;padding:12px;background:#fdf6e7;border:1px solid #eccb7a;border-radius:8px;font-size:14px;line-height:1.6;">
          <strong>Nothing has been charged yet</strong> and no diamonds have been sent. We'll email you again the moment your order is delivered.
        </p>`,
        `<p style="margin:20px 0 0 0;font-size:15px;"><a href="${trackUrl()}" style="color:#0b6ea6;font-weight:600;">Track your order</a></p>`,
      ].join(""),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 2. Delivered                                                        */
/* ------------------------------------------------------------------ */

export function orderDeliveredEmail(facts: OrderEmailFacts): OutboundEmail {
  return {
    to: facts.contactEmail,
    subject: `Delivered — your ${facts.displayName} is in your account`,
    text: [
      `Your order has been delivered.`,
      ``,
      `Order ID: ${facts.orderId}`,
      `Package:  ${facts.displayName}`,
      `Account:  ${accountLine(facts)}`,
      ``,
      `Everything you paid for has been sent to that account. If you can't see`,
      `it in game, close Mobile Legends completely and reopen it — the balance`,
      `sometimes refreshes on restart.`,
      ``,
      `Still not there? Reply to this email or message us on WhatsApp at`,
      `${siteConfig.contact.phone} with your order ID and we'll sort it out.`,
      ``,
      `Games Central`,
    ].join("\n"),
    html: shell(
      "Delivered — enjoy!",
      [
        paragraph("Everything you paid for has been sent to your account."),
        detailRows([["Order ID", facts.orderId], ...commonRows(facts)]),
        /*
         * The restart tip earns its place: a balance that has not refreshed
         * yet is the single most common "it didn't arrive" message a top-up
         * shop gets, and answering it before it is asked saves the customer a
         * worried evening and us a support conversation.
         */
        paragraph(
          "Can't see it yet? Close Mobile Legends completely and reopen it — the balance sometimes only refreshes on restart.",
        ),
        paragraph(
          `Still not there? Reply to this email or message us on WhatsApp at ${siteConfig.contact.phone} with your order ID.`,
        ),
      ].join(""),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 3. Paid, delivery needs a hand                                      */
/* ------------------------------------------------------------------ */

/**
 * The hardest one to write, and the most important to send.
 *
 * The customer has paid and received nothing. Silence here is what turns a
 * delayed order into a fraud accusation, so this goes out immediately, admits
 * the problem in the first sentence, and states plainly that their money is
 * accounted for. No apology-shaped evasion, no "unexpected issue".
 */
export function orderNeedsAttentionEmail(facts: OrderEmailFacts): OutboundEmail {
  return {
    to: facts.contactEmail,
    subject: `We're finishing your order ${facts.orderId} by hand`,
    text: [
      `Your payment went through, but our automatic delivery didn't complete.`,
      ``,
      `Order ID: ${facts.orderId}`,
      `Package:  ${facts.displayName}`,
      `Price:    ${formatPkr(facts.pricePkr)}`,
      `Account:  ${accountLine(facts)}`,
      ``,
      `Your order is in our queue and a person is finishing it now. You have`,
      `not been charged twice and nothing has been lost.`,
      ``,
      `If you don't hear from us within a few hours, message us on WhatsApp at`,
      `${siteConfig.contact.phone} with your order ID and we'll deal with it`,
      `straight away.`,
      ``,
      `Games Central`,
    ].join("\n"),
    html: shell(
      "We're finishing your order by hand",
      [
        paragraph(
          "Your payment went through, but our automatic delivery didn't complete.",
        ),
        detailRows([["Order ID", facts.orderId], ...commonRows(facts)]),
        `<p style="margin:0 0 14px 0;padding:12px;background:#f3f8fd;border:1px solid #cfe1f2;border-radius:8px;font-size:14px;line-height:1.6;">
          Your order is in our queue and a person is finishing it now. <strong>You have not been charged twice and nothing has been lost.</strong>
        </p>`,
        paragraph(
          `If you don't hear from us within a few hours, message us on WhatsApp at ${siteConfig.contact.phone} with your order ID and we'll deal with it straight away.`,
        ),
      ].join(""),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 4. Operator alert                                                   */
/* ------------------------------------------------------------------ */

/**
 * To the owner, not the customer — so unlike everything above it may carry
 * internal detail: the reason, the outstanding packs, a link straight into the
 * admin screen.
 *
 * This is the message that closes the loop the shop was missing. Without it,
 * an order that needs a person waits until somebody happens to open the
 * dashboard, while a customer who has paid watches nothing arrive.
 */
export function operatorAlertEmail(args: {
  to: string;
  orderId: string;
  displayName: string;
  pricePkr: number;
  playerId: string;
  zoneId: string | null;
  outstanding: string[];
  reason: string;
  needsDashboardCheck: boolean;
}): OutboundEmail {
  const adminUrl = `${baseUrl()}/admin/orders/${args.orderId}`;
  const target = args.zoneId ? `${args.playerId} (${args.zoneId})` : args.playerId;

  const urgent = args.needsDashboardCheck
    ? "CHECK THE SMILEONE DASHBOARD BEFORE RETRYING — a purchase went out and never confirmed, so retrying blind could buy it twice."
    : "Safe to retry from the admin screen — nothing is in doubt.";

  return {
    to: args.to,
    subject: `[Action needed] ${args.orderId} — paid, not delivered`,
    text: [
      `A customer has paid and their order was not delivered.`,
      ``,
      `Order:    ${args.orderId}`,
      `Package:  ${args.displayName}`,
      `Paid:     ${formatPkr(args.pricePkr)}`,
      `Account:  ${target}`,
      `Outstanding: ${args.outstanding.length ? args.outstanding.join(", ") : "(unknown)"}`,
      ``,
      `Reason: ${args.reason}`,
      ``,
      urgent,
      ``,
      `Open it: ${adminUrl}`,
    ].join("\n"),
    html: shell(
      "Paid, not delivered — action needed",
      [
        paragraph("A customer has paid and their order was not delivered."),
        detailRows([
          ["Order", args.orderId],
          ["Package", args.displayName],
          ["Paid", formatPkr(args.pricePkr)],
          ["Account", target],
          ["Outstanding", args.outstanding.length ? args.outstanding.join(", ") : "(unknown)"],
        ]),
        paragraph(`Reason: ${args.reason}`),
        `<p style="margin:0 0 14px 0;padding:12px;background:${
          args.needsDashboardCheck ? "#fdf1f1;border:1px solid #f0b9b9" : "#f3f8fd;border:1px solid #cfe1f2"
        };border-radius:8px;font-size:14px;line-height:1.6;"><strong>${esc(urgent)}</strong></p>`,
        `<p style="margin:20px 0 0 0;font-size:15px;"><a href="${adminUrl}" style="color:#0b6ea6;font-weight:600;">Open this order in admin</a></p>`,
      ].join(""),
    ),
  };
}

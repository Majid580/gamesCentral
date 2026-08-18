import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound email.
 *
 * Plain SMTP rather than a provider SDK, for the same reason the rest of this
 * codebase avoids platform primitives: production is a self-hosted Node process
 * on Hostinger, and SMTP works from anywhere with any mailbox. Moving from a
 * Gmail account today to a `@gamescentral.pk` mailbox later is an env change,
 * not a rewrite.
 *
 * DARK UNTIL CONFIGURED, and never fatal. With `SMTP_HOST`/`SMTP_USER`/
 * `SMTP_PASSWORD` unset, `isEmailConfigured()` is false and every send is
 * skipped with a log line. That is deliberate: an order must not fail because
 * a mailbox is down, misconfigured, or not set up yet. Email is a courtesy on
 * top of the order record — the order record is the truth.
 */

let cached: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD,
  );
}

/**
 * The address mail is sent from.
 *
 * Defaults to the SMTP username because most providers — Gmail certainly —
 * reject or silently rewrite a From that is not the authenticated account.
 * `SMTP_FROM` exists for the case where a mailbox permits a friendlier
 * display address.
 */
export function fromAddress(): string {
  const explicit = process.env.SMTP_FROM?.trim();
  if (explicit) return explicit;

  const user = process.env.SMTP_USER?.trim() ?? "";
  return user ? `Games Central <${user}>` : "Games Central";
}

function transport(): Transporter {
  if (cached) return cached;

  const port = Number(process.env.SMTP_PORT ?? 587);

  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    /*
     * 465 is implicit TLS; 587 starts plaintext and upgrades via STARTTLS.
     * Deriving this from the port rather than exposing another env var
     * removes the most common way to misconfigure SMTP — the two settings
     * cannot disagree if only one of them exists.
     */
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    /*
     * Bounded so a hanging mail server cannot hold a connection open behind a
     * request that has already done its real work.
     */
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  return cached;
}

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Sends one email, and never throws.
 *
 * Every caller is on a path where something more important has already
 * succeeded — an order was created, diamonds were delivered — and none of them
 * should be undone or interrupted because a mail server was unreachable. The
 * failure is logged and swallowed; the return value says which happened for
 * callers that want to record it.
 */
export async function sendEmail(
  message: OutboundEmail,
): Promise<{ sent: boolean; reason?: string }> {
  if (!isEmailConfigured()) {
    console.info("[email] not configured — skipping", { subject: message.subject });
    return { sent: false, reason: "not_configured" };
  }

  try {
    await transport().sendMail({
      from: fromAddress(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    console.info("[email] sent", { subject: message.subject });
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // The recipient address is not logged: it is a customer's personal data and
    // this line ends up in whatever aggregates the host's stdout.
    console.error("[email] send failed", { subject: message.subject, reason });
    return { sent: false, reason };
  }
}

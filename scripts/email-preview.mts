/**
 * Renders every email to a file so it can be read before a customer gets one.
 *
 *   npm run email:preview            write HTML files to .email-preview/
 *   npm run email:preview -- --send  ALSO send them to ADMIN_EMAIL
 *
 * Sends nothing by default. `--send` is the deliberate act, and it goes only
 * to ADMIN_EMAIL — there is no way to point this at an arbitrary address,
 * because a preview tool that can mail strangers is a spam tool.
 *
 * Every message is rendered from the same functions the app uses, so what
 * appears here is what a customer receives, not an approximation.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  operatorAlertEmail,
  orderDeliveredEmail,
  orderNeedsAttentionEmail,
  orderSavedEmail,
  type OrderEmailFacts,
} from "../lib/services/email/templates.ts";
import { isEmailConfigured, sendEmail } from "../lib/services/email/transport.ts";

const send = process.argv.includes("--send");
const outDir = path.join(process.cwd(), ".email-preview");

/*
 * Deliberately awkward sample data. A username with an apostrophe and angle
 * brackets is the case that proves the templates escape what they interpolate
 * — an in-game name is chosen by a stranger, and these bodies are built by
 * string concatenation where nothing escapes automatically.
 */
const facts: OrderEmailFacts = {
  orderId: "GC-7K2PM-QX9RT",
  displayName: "1050 Diamonds",
  pricePkr: 450_000,
  playerId: "1638539586",
  zoneId: "16932",
  confirmedUsername: `Ali's <Squad> "Legend"`,
  contactEmail: process.env.ADMIN_EMAIL?.trim() || "preview@example.invalid",
};

const messages = [
  { name: "1-order-saved", email: orderSavedEmail(facts) },
  { name: "2-delivered", email: orderDeliveredEmail(facts) },
  { name: "3-needs-attention", email: orderNeedsAttentionEmail(facts) },
  {
    name: "4-operator-alert",
    email: operatorAlertEmail({
      to: facts.contactEmail,
      orderId: facts.orderId,
      displayName: facts.displayName,
      pricePkr: facts.pricePkr,
      playerId: facts.playerId,
      zoneId: facts.zoneId,
      outstanding: ["172 Diamonds", "172 Diamonds"],
      reason:
        "The 172 Diamonds purchase did not report back, so it is unknown whether it reached the player.",
      needsDashboardCheck: true,
    }),
  },
];

await mkdir(outDir, { recursive: true });

for (const { name, email } of messages) {
  await writeFile(path.join(outDir, `${name}.html`), email.html, "utf8");
  await writeFile(
    path.join(outDir, `${name}.txt`),
    `Subject: ${email.subject}\nTo: ${email.to}\n\n${email.text}`,
    "utf8",
  );
  console.log(`  ${name.padEnd(20)} ${email.subject}`);
}

console.log(`\nWritten to ${outDir}`);

/*
 * The escaping check, asserted rather than eyeballed. If a template ever stops
 * escaping, the sample username above lands raw in the HTML — and because
 * these bodies are assembled by concatenation, that is a real injection into
 * whatever renders the mail.
 */
const savedHtml = messages[0].email.html;
if (savedHtml.includes("<Squad>")) {
  console.error("\n*** FAIL: a username reached the HTML unescaped.\n");
  process.exit(1);
}
if (!savedHtml.includes("&lt;Squad&gt;")) {
  console.error("\n*** FAIL: expected the escaped username and did not find it.\n");
  process.exit(1);
}
console.log("Escaping check: PASS (customer-supplied text is escaped)");

if (!send) {
  console.log("\nNothing was sent. Open the .html files, or re-run with --send.");
  process.exit(0);
}

if (!isEmailConfigured()) {
  console.error(
    "\nSMTP is not configured, so --send has nothing to send with.\n" +
      "Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD in .env.local first.\n",
  );
  process.exit(1);
}

const to = process.env.ADMIN_EMAIL?.trim();
if (!to) {
  console.error("\nADMIN_EMAIL is not set. --send only ever sends there.\n");
  process.exit(1);
}

console.log(`\nSending ${messages.length} test emails to ${to} ...`);

let failed = 0;
for (const { name, email } of messages) {
  const result = await sendEmail({ ...email, to, subject: `[TEST] ${email.subject}` });
  console.log(`  ${result.sent ? "sent" : "FAILED"}  ${name}${result.reason ? ` — ${result.reason}` : ""}`);
  if (!result.sent) failed += 1;
}

console.log(
  failed === 0
    ? "\nAll sent. Check that inbox — and the spam folder.\n"
    : `\n${failed} failed. See the reason above.\n`,
);
process.exit(failed === 0 ? 0 : 1);

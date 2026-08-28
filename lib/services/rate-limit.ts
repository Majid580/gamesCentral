import "server-only";

import { createHash } from "node:crypto";

import { connectToDatabase, assertScalar } from "@/lib/models/db";
import { RateLimitHitModel } from "@/lib/models/rate-limit-hit";

/**
 * Request rate limiting for public endpoints.
 *
 * The thing being protected here is not our server — it is the owner's
 * SmileOne merchant account. `/api/checkout/verify-account` is public,
 * unauthenticated, and reaches the supplier on every call. It cannot spend
 * money (`getrole` only reads, and `createorder` is blocked outright), but an
 * unthrottled public endpoint fronting a partner API is a good way to get the
 * merchant account throttled or suspended, and that takes the whole shop
 * offline.
 */

export type RateLimitRule = {
  /** Bucket to count against, e.g. `lookup:ip:1.2.3.4`. */
  key: string;
  /** Calls allowed inside the window. */
  limit: number;
  windowMs: number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; rule: string };

/**
 * Checks every rule, then records the hit if all of them pass.
 *
 * Recorded on the way in rather than on the way out, and only when allowed:
 * counting a call we refused would let a client that keeps hammering extend
 * its own lockout indefinitely, which reads as a broken site rather than a
 * rate limit.
 *
 * This is a counter, not a lock. Two simultaneous requests can both read a
 * count just under the limit and both proceed. That is fine — the limit exists
 * to stop sustained hammering, and being off by one under a race does not
 * change whether the supplier sees a flood.
 */
export async function checkRateLimit(
  rules: RateLimitRule[],
): Promise<RateLimitResult> {
  await connectToDatabase();

  const now = Date.now();

  for (const rule of rules) {
    const key = String(assertScalar(rule.key, "rateLimitKey"));
    const since = new Date(now - rule.windowMs);

    const count = await RateLimitHitModel.countDocuments({ key, at: { $gte: since } });

    if (count >= rule.limit) {
      /*
       * Report when the window frees up rather than a flat guess, so the
       * client is told something true. Falls back to the full window when the
       * oldest hit cannot be read.
       */
      const oldest = await RateLimitHitModel.findOne({ key, at: { $gte: since } })
        .sort({ at: 1 })
        .select("at")
        .lean();

      const freesAt = oldest ? oldest.at.getTime() + rule.windowMs : now + rule.windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((freesAt - now) / 1000));

      return { allowed: false, retryAfterSeconds, rule: key };
    }
  }

  await RateLimitHitModel.insertMany(
    rules.map((rule) => ({ key: String(assertScalar(rule.key, "rateLimitKey")), at: new Date() })),
  );

  return { allowed: true };
}

/**
 * The client's address, as best it can be known behind a proxy.
 *
 * `x-forwarded-for` is client-supplied and therefore spoofable: anyone can
 * prepend a fake address and appear to be a new client every request. It is
 * still worth limiting on, because it stops the ordinary case — one script,
 * one machine, no thought — and the global rule in `accountLookupRules()` is
 * the backstop that spoofing cannot evade.
 *
 * Do not "harden" this by trusting a deeper entry in the chain without knowing
 * the production proxy: on Hostinger that depends on the plan, and picking the
 * wrong index makes every visitor share one bucket.
 */
export function clientIp(headers: Headers): string {
  const raw =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown";

  /*
   * Truncated, because this value is entirely attacker-controlled and every
   * allowed request writes it into the database as part of a rate-limit key.
   * Node accepts headers up to 16KB, so without a bound each request could
   * store several kilobytes of someone's choosing, indefinitely, on an indexed
   * field — a slow way to fill a collection using the very mechanism that is
   * supposed to be limiting the caller.
   *
   * 45 characters clears the longest real address (an IPv6 address with an
   * embedded IPv4 tail is 45), so no genuine client is affected. Two clients
   * that only differ past that character share a bucket, which is the correct
   * failure: the shared bucket is more restrictive, never less.
   */
  return raw.slice(0, 45);
}

/* ------------------------------------------------------------------ */
/* Account lookup                                                      */
/* ------------------------------------------------------------------ */

/**
 * Per address: generous for a real customer, who looks their account up once
 * and occasionally retries a typo, and tight enough that a script gets nowhere.
 */
const LOOKUP_PER_IP = { limit: 12, windowMs: 10 * 60 * 1000 };

/**
 * Across everyone: the circuit breaker on the merchant account.
 *
 * Deliberately a cap on total supplier traffic rather than per-client, because
 * the failure being prevented — SmileOne throttling or suspending the account —
 * does not care how many machines the flood came from.
 *
 * The trade-off is real: an attacker who trips this makes real customers wait.
 * That is still much better than the alternative. A minute of "try again
 * shortly" ends by itself; a suspended merchant account needs a phone call and
 * takes the shop down for as long as it takes. One lookup per second sustained
 * is far above anything this shop's real traffic will produce.
 */
const LOOKUP_GLOBAL = { limit: 60, windowMs: 60 * 1000 };

export function accountLookupRules(ip: string): RateLimitRule[] {
  return [
    { key: `lookup:ip:${ip}`, ...LOOKUP_PER_IP },
    { key: "lookup:global", ...LOOKUP_GLOBAL },
  ];
}

/* ------------------------------------------------------------------ */
/* Payment settlement                                                  */
/* ------------------------------------------------------------------ */

/**
 * The customer's return from PayFast triggers a verification call, so this is
 * another public endpoint that makes an outbound request per hit.
 *
 * Looser than the lookup limits and per-IP only. The concern here is bounding
 * anonymous outbound traffic, not protecting a fragile merchant relationship —
 * a payment gateway expects status queries. No global cap on purpose: it would
 * let one attacker block real customers from having their payments confirmed,
 * which is a worse failure than the calls it would save.
 *
 * PayFast's own webhook is deliberately NOT limited. Dropping a gateway
 * notification to save an API call is a bad trade — that notification is how a
 * customer who closed the tab still gets settled.
 */
const SETTLE_PER_IP = { limit: 20, windowMs: 5 * 60 * 1000 };

export function paymentSettleRules(ip: string): RateLimitRule[] {
  return [{ key: `settle:ip:${ip}`, ...SETTLE_PER_IP }];
}

/* ------------------------------------------------------------------ */
/* Guest order lookup                                                  */
/* ------------------------------------------------------------------ */

/**
 * Per address: a customer checks one order a few times while they wait.
 * Twenty in ten minutes covers impatience and stops a list being worked
 * through.
 */
const ORDER_LOOKUP_PER_IP = { limit: 20, windowMs: 10 * 60 * 1000 };

/**
 * Per order ID: the rule that actually protects the second factor.
 *
 * Order IDs travel — they are printed on a confirmation page, forwarded over
 * WhatsApp, and left in browser history — so the realistic attack is someone
 * holding an ID and guessing the email or phone that goes with it. Counting
 * attempts against the ID caps that at ten tries an hour no matter how many
 * addresses they come from, which spoofing `x-forwarded-for` cannot evade.
 *
 * The cost is that someone who knows your order ID can make you wait an hour
 * to check it. That is a nuisance; the alternative exposes a stranger's
 * delivery target and contact details. There is deliberately no global rule
 * here — one attacker must not be able to stop everyone else from finding
 * their orders.
 */
const ORDER_LOOKUP_PER_ORDER = { limit: 10, windowMs: 60 * 60 * 1000 };

export function orderLookupRules(ip: string, orderId: string): RateLimitRule[] {
  return [
    { key: `track:ip:${ip}`, ...ORDER_LOOKUP_PER_IP },
    { key: `track:order:${orderId}`, ...ORDER_LOOKUP_PER_ORDER },
  ];
}

/* ------------------------------------------------------------------ */
/* Order creation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Creating an order is unauthenticated and now sends an email, which changes
 * what this endpoint is. Before, abusing it wrote database rows; now it makes
 * our server deliver mail to any address the caller names — an email bomb with
 * our domain's reputation attached, and a fast way onto a spam blocklist that
 * would then eat the receipts real customers depend on.
 *
 * Per IP: a real customer places one order and occasionally retries. Six in
 * ten minutes is generous for that and useless for volume.
 */
const ORDER_CREATE_PER_IP = { limit: 6, windowMs: 10 * 60 * 1000 };

/**
 * Per recipient address: the rule that actually protects a third party.
 *
 * The per-IP limit bounds how much one machine can send; it does nothing to
 * stop a distributed attempt to bury one person's inbox, and `x-forwarded-for`
 * is spoofable anyway. Counting against the address being mailed caps what any
 * single victim can receive from us regardless of where it comes from.
 *
 * Keyed on a hash rather than the address itself. These keys are written to
 * the database on every allowed request, and storing a plaintext list of
 * customer email addresses in a rate-limit collection would be creating a
 * second, unnecessary copy of personal data to protect.
 */
const ORDER_CREATE_PER_EMAIL = { limit: 4, windowMs: 60 * 60 * 1000 };

export function orderCreateRules(ip: string, contactEmail: string): RateLimitRule[] {
  const recipient = createHash("sha256")
    .update(contactEmail.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);

  return [
    { key: `order:ip:${ip}`, ...ORDER_CREATE_PER_IP },
    { key: `order:to:${recipient}`, ...ORDER_CREATE_PER_EMAIL },
    /*
     * The SAME global bucket the lookup endpoint uses, deliberately shared.
     *
     * Order creation re-verifies the account, so it now reaches the merchant
     * account too. Giving it its own budget would mean the rule that exists to
     * stop SmileOne throttling us could be walked past by sending order
     * creations instead of lookups — and both per-order rules above are keyed
     * on values a caller controls (`x-forwarded-for` is spoofable, and so is
     * the address they claim to be mailing).
     *
     * The cost is that a lookup flood can make a customer who already verified
     * wait to submit. That is the same trade the lookup limit already makes,
     * for the same reason: a minute of "try again" ends by itself, a suspended
     * merchant account needs a phone call.
     */
    { key: "lookup:global", ...LOOKUP_GLOBAL },
  ];
}

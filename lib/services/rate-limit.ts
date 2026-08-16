import "server-only";

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
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
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

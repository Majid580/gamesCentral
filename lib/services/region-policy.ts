import "server-only";

/**
 * Region policy — who we will and will not top up.
 *
 * THE PROBLEM. Our supplier account is a Brazil storefront, and BR is one of
 * the cheapest MLBB recharge regions there is. The owner's PKR prices were set
 * against BR list prices (~60 PKR per BRL across the whole catalogue). A player
 * whose account costs the supplier more than BR list therefore eats the margin
 * and can invert it — we would deliver at a loss.
 *
 * WHAT DOES NOT WORK, AND MUST NOT BE BUILT. Mapping Zone ID to country.
 * MLBB Zone IDs are server shards assigned at account creation; players from
 * different countries share them. The "server ID to country" tables on forums
 * are guesswork. Building against one would refuse paying Pakistani customers
 * and wave through the expensive accounts it was meant to stop.
 *
 * WHERE THE COUNTRY CHECK ACTUALLY LIVES — NOT HERE. SmileOne performs it
 * itself and answers `getrole` with status 201 for the five restricted
 * countries. That is handled in `./smileone/client.ts`, is sourced from
 * Moonton, costs nothing, and happens before any money moves. This module does
 * not duplicate it. See SUPPLIER_BLOCKED_COUNTRIES below for why copying it
 * here would be strictly worse.
 *
 * WHAT THIS MODULE IS FOR, then, is the case the supplier does NOT refuse: an
 * account it will happily serve, at a price above what our catalogue assumes.
 * `getrole` states that cost as a multiplier on the catalogue price. Confirmed
 * live 2026-08-28: the owner's own account returns `change_price: 1` and
 * per-product multipliers of `1` (one at `1.0043`). A costlier account is a
 * number above 1.
 *
 * So: the supplier catches the countries it will not serve, and this catches
 * the ones it will serve but at a price that would cost us money. Neither
 * needs to know what country anybody is in.
 */

/**
 * Countries that cannot be topped up. Recorded for documentation only — WE DO
 * NOT ENFORCE THIS LIST AND MUST NOT TRY TO.
 *
 * The owner named these five, and SmileOne independently answers `getrole`
 * with status 201 and, verbatim: "According to the request of the mlbb team,
 * we do not support recharge for users in Indonesia, Malaysia, the
 * Philippines, Singapore, and Russia for the time being." The same five.
 * Confirmed live 2026-08-28 against a real Philippine account.
 *
 * The check therefore already exists, upstream of us, sourced from Moonton and
 * applied before we can spend anything. Ours would be a worse copy: it would
 * need a zone-to-country table that does not exist, and it would go stale the
 * day Moonton changes the list — which "for the time being" says outright will
 * happen. `lib/services/smileone/client.ts` maps status 201 to
 * SmileOneRegionBlockedError; that is the enforcement.
 *
 * If the owner ever wants to refuse a country SmileOne is happy to serve, that
 * is a new mechanism, not an edit to this array.
 */
export const SUPPLIER_BLOCKED_COUNTRIES = [
  "Indonesia",
  "Malaysia",
  "Philippines",
  "Singapore",
  "Russia",
] as const;

/**
 * The most we will pay above catalogue price before refusing the account.
 *
 * 1.05 sits above the only non-1 multiplier ever observed (1.0043, product 25
 * on the owner's own account) with room for that kind of rounding noise, and
 * below any uplift large enough to matter. If a real Pakistani customer is
 * ever refused by this rule, the observed multiplier is in the log line —
 * raise this rather than removing the gate.
 */
export const MAX_SUPPLIER_MULTIPLIER = 1.05;

export type RegionSignals = {
  /** getrole's top-level `change_price`. A multiplier, not a price. */
  changePrice: string | null;
  /** Per-product multipliers from `id_change_price_info`. */
  priceMultipliers: Array<{ productId: string; multiplier: number }>;
  /** The supplier SKU this checkout will actually buy, when known. */
  supplierProductId: string | null;
};

export type RegionDecision =
  | { allowed: true; multiplier: number }
  | {
      allowed: false;
      /** Which layer refused. Logged, never shown to the customer. */
      reason: "supplier_cost";
      multiplier: number;
    };

/**
 * The multiplier that will actually apply to this purchase.
 *
 * The per-product entry wins over the top-level one when both exist: it is the
 * more specific statement about the SKU we are about to buy. Anything
 * unreadable falls back to 1 — the gate must not refuse a paying customer
 * because a field was missing, which is why the *cost* check is a backstop and
 * not the only defence we would want for a hostile input.
 */
export function effectiveMultiplier(signals: RegionSignals): number {
  const perProduct = signals.supplierProductId
    ? signals.priceMultipliers.find((m) => m.productId === signals.supplierProductId)
    : undefined;

  if (perProduct) return perProduct.multiplier;

  const topLevel = Number(signals.changePrice);
  return Number.isFinite(topLevel) && topLevel > 0 ? topLevel : 1;
}

/**
 * Decides whether this account may proceed to payment.
 *
 * Runs at account verification, before the customer ever reaches PayFast, so a
 * refusal costs them nothing and there is no payment to reverse.
 */
export function evaluateRegionPolicy(signals: RegionSignals): RegionDecision {
  const multiplier = effectiveMultiplier(signals);

  if (multiplier > MAX_SUPPLIER_MULTIPLIER) {
    return { allowed: false, reason: "supplier_cost", multiplier };
  }

  return { allowed: true, multiplier };
}

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
 * WHAT DOES WORK. `getrole` tells us, before payment and for free, what this
 * specific account will cost us — as a multiplier on the catalogue price.
 * Confirmed live 2026-08-28: the owner's own account returns `change_price: 1`
 * and per-product multipliers of `1` (one at `1.0043`). A costlier account is
 * a number above 1. That measures the actual harm directly, needs no country
 * table, and stays correct when the supplier re-prices.
 *
 * So the cost gate is the real gate, and the country list below is a second
 * layer that is NOT YET ARMED — see the comment on COUNTRY_BY_REGION_SIGNAL.
 */

/**
 * Countries the owner has decided not to serve (stated 2026-08-28).
 *
 * ⚠️ THIS LIST CURRENTLY MATCHES NOTHING. It is the recorded policy, not a
 * working filter, because nothing in a SmileOne response has yet been proven
 * to identify a country — see COUNTRY_BY_REGION_SIGNAL. Do not report to the
 * owner that these countries are blocked until that table is populated from
 * real labelled lookups. The cost gate below is what is actually protecting
 * the money today.
 */
export const BLOCKED_COUNTRIES = [
  "PH", // Philippines
  "RU", // Russia
  "MY", // Malaysia
  "ID", // Indonesia
  "SG", // Singapore
] as const;

export type BlockedCountry = (typeof BLOCKED_COUNTRIES)[number];

/**
 * getrole's `zone` value -> ISO country code.
 *
 * ⚠️ DELIBERATELY EMPTY. `zone` is not an echo of the Zone ID we send — a
 * lookup on zone 16932 came back `zone: 1` — and a small integer that ignores
 * our input has the shape of a server-group index. That is a HYPOTHESIS from a
 * single account, not a finding.
 *
 * Populating it needs `npm run smileone:region` run over real Player IDs whose
 * country is already known, from the owner's WhatsApp order history: several
 * Pakistani, several from each blocked country. If `zone` comes back identical
 * for all of them it is not a region key and this table must be deleted rather
 * than filled in with guesses.
 *
 * Until then `resolveCountry` returns null for everyone and the country layer
 * is inert by construction. That is intentional: an empty table refuses nobody,
 * where a guessed one refuses the wrong people.
 */
const COUNTRY_BY_REGION_SIGNAL: Record<string, string> = {};

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
  /** getrole's `zone` — candidate region marker, meaning unconfirmed. */
  zone: string | null;
  /** getrole's top-level `change_price`. A multiplier, not a price. */
  changePrice: string | null;
  /** Per-product multipliers from `id_change_price_info`. */
  priceMultipliers: Array<{ productId: string; multiplier: number }>;
  /** The supplier SKU this checkout will actually buy, when known. */
  supplierProductId: string | null;
};

export type RegionDecision =
  | { allowed: true; multiplier: number; country: string | null }
  | {
      allowed: false;
      /** Which layer refused. Logged, never shown to the customer. */
      reason: "blocked_country" | "supplier_cost";
      multiplier: number;
      country: string | null;
    };

/**
 * Best-effort country for an account. Null means "we do not know", which is
 * the honest answer for every account until the signal table is populated.
 */
export function resolveCountry(signals: RegionSignals): string | null {
  if (!signals.zone) return null;
  return COUNTRY_BY_REGION_SIGNAL[signals.zone] ?? null;
}

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
  const country = resolveCountry(signals);
  const multiplier = effectiveMultiplier(signals);

  if (country && (BLOCKED_COUNTRIES as readonly string[]).includes(country)) {
    return { allowed: false, reason: "blocked_country", multiplier, country };
  }

  if (multiplier > MAX_SUPPLIER_MULTIPLIER) {
    return { allowed: false, reason: "supplier_cost", multiplier, country };
  }

  return { allowed: true, multiplier, country };
}

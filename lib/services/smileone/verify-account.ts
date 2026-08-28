import "server-only";

import { getRole, SmileOneRegionBlockedError } from "@/lib/services/smileone/client";
import { evaluateRegionPolicy } from "@/lib/services/region-policy";

/**
 * Account verification — the safety net in front of payment.
 *
 * A mistyped Player ID sends diamonds to a stranger and the money is gone, so
 * checkout never proceeds without confirming the account exists and showing
 * the customer the in-game username it belongs to. This must never be skipped.
 */

export type AccountVerification = {
  /** The in-game username the customer has to recognise as theirs. */
  username: string;
  zone: string | null;
  /**
   * `getrole`'s change_price when present. Recorded on the order, never used
   * to alter what the customer is charged — our catalogue price is fixed and
   * owner-set. A mismatch is a signal to investigate, not to re-price.
   */
  supplierChangePrice: string | null;
  /** True when the answer came from the development stub, never in production. */
  stubbed: boolean;
};

export class AccountNotFoundError extends Error {
  constructor() {
    super("No Mobile Legends account matches that Player ID and Zone ID.");
    this.name = "AccountNotFoundError";
  }
}

/**
 * The account is real, but we will not serve it — either its region is on the
 * owner's excluded list, or the supplier would charge us more for it than our
 * listed price is built to absorb. See `lib/services/region-policy.ts`.
 *
 * Thrown before payment, so nothing has been charged and nothing needs undoing.
 */
export class RegionNotServedError extends Error {
  constructor() {
    super("This account's region is not served.");
    this.name = "RegionNotServedError";
  }
}

/*
 * DEVELOPMENT STUB — now off by default and kept only as a fallback.
 *
 * It existed because the sandbox host in the brief (frontsmie.smile.one) has
 * no DNS record. That is no longer the constraint: `getrole` runs against the
 * owner's live account on https://www.smile.one, and SMILEONE_STUB is empty in
 * .env.local so real lookups happen. A fabricated username would hide a broken
 * lookup, which is the one failure this whole code path exists to prevent.
 *
 * getrole only reads — it is safe to call against the live account. It is
 * `createorder` that spends money, and that is blocked outright in ./safety.ts
 * until PayFast is wired (see LIVE_ACCOUNT_SAFETY.md).
 *
 * Two independent conditions must hold for the stub to engage, and the
 * combination is impossible to reach on a deployed production build. There is
 * deliberately no NEXT_PUBLIC_ variant: nothing the browser can send turns
 * this on.
 */
function stubEnabled(): boolean {
  if (process.env.SMILEONE_STUB !== "1") return false;

  /*
   * Fail loudly rather than silently. Shipping with the flag set should crash
   * the verification attempt, not fabricate a username that lets a real
   * customer pay for delivery to an account nobody checked.
   *
   * This check lives inside the function rather than at module scope on
   * purpose: `next build` sets NODE_ENV=production and imports every route to
   * collect page data, so a module-level throw fails the build on any machine
   * that has the stub enabled for local development. Checking at the point of
   * use keeps builds working while still making the dangerous combination
   * impossible to actually serve.
   */
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SMILEONE_STUB is set in a production build. The account-verification " +
        "stub must never run against real customers — unset it and configure " +
        "SMILEONE_API_BASE_URL instead.",
    );
  }

  return true;
}

/** Deterministic per Player ID, so repeated dev lookups stay consistent. */
function stubUsername(playerId: string): string {
  const names = ["ShadowStrike", "LunarBlade", "IronFang", "NovaRider", "EmberWolf"];
  const sum = [...playerId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return `${names[sum % names.length]}${playerId.slice(-3)}`;
}

export async function verifyGameAccount(args: {
  smileOneProduct: string;
  smileOneProductId: string | null;
  playerId: string;
  zoneId: string;
}): Promise<AccountVerification> {
  if (stubEnabled()) {
    // Mirrors the real failure so the UI's error path is exercised in dev too:
    // a Player ID ending in 0 is treated as not found.
    if (args.playerId.endsWith("0")) throw new AccountNotFoundError();

    return {
      username: stubUsername(args.playerId),
      zone: args.zoneId,
      supplierChangePrice: null,
      stubbed: true,
    };
  }

  let role;
  try {
    role = await getRole({
      product: args.smileOneProduct,
      /*
       * Any catalogue product id is accepted for a role lookup, so fall back
       * to a known-live SKU when this product is not yet mapped to a supplier
       * id. "13" (78&8 Diamond) is confirmed present in the account's live
       * productlist — the previous "212" was a guess and is not in it.
       */
      productId: args.smileOneProductId ?? "13",
      userId: args.playerId,
      zoneId: args.zoneId,
    });
  } catch (error) {
    /*
     * The supplier's own country check answered no. Collapsed into our single
     * region concept here so the controller has one refusal to handle rather
     * than two that mean the same thing to a customer.
     *
     * The upstream wording is logged and goes no further (rule 7): it names
     * all five restricted countries, which tells the owner what happened and
     * would tell a customer more about the rule than they need.
     */
    if (error instanceof SmileOneRegionBlockedError) {
      console.warn("[region] supplier refused the account's country", {
        upstreamMessage: error.upstreamMessage,
      });
      throw new RegionNotServedError();
    }
    throw error;
  }

  if (!role.username) throw new AccountNotFoundError();

  /*
   * Reached only for accounts the supplier is willing to serve — the five
   * restricted countries never get this far, they are refused upstream with
   * status 201. What is left to check is whether serving this one would cost
   * us more than the catalogue price assumes.
   */
  const decision = evaluateRegionPolicy({
    changePrice: role.changePrice,
    priceMultipliers: role.priceMultipliers,
    supplierProductId: args.smileOneProductId,
  });

  if (!decision.allowed) {
    console.warn("[region] refused before payment", {
      reason: decision.reason,
      zone: role.zone,
      multiplier: decision.multiplier,
    });
    throw new RegionNotServedError();
  }

  return {
    username: role.username,
    zone: role.zone,
    supplierChangePrice: role.changePrice,
    stubbed: false,
  };
}

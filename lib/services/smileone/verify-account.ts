import "server-only";

import { getRole, SmileOneError } from "@/lib/services/smileone/client";

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

/*
 * DEVELOPMENT STUB.
 *
 * The SmileOne sandbox host from the brief (frontsmie.smile.one) has no DNS
 * record — re-confirmed against a real resolver, see project_state.yaml — so
 * `getrole` cannot be called at all yet. Without a stub the entire checkout UI
 * would be unbuildable and untestable until the owner supplies a working base
 * URL.
 *
 * Two independent conditions must hold for it to engage, and the combination
 * is impossible to reach on a deployed production build. There is deliberately
 * no NEXT_PUBLIC_ variant: nothing the browser can send turns this on.
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
      // Any catalogue product id is accepted by getrole for a role lookup;
      // fall back to the cheapest known SKU when this product is not yet
      // mapped to a supplier id.
      productId: args.smileOneProductId ?? "212",
      userId: args.playerId,
      zoneId: args.zoneId,
    });
  } catch (error) {
    if (error instanceof SmileOneError) throw error;
    throw error;
  }

  if (!role.username) throw new AccountNotFoundError();

  return {
    username: role.username,
    zone: role.zone,
    supplierChangePrice: role.changePrice,
    stubbed: false,
  };
}

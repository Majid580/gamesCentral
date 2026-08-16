/**
 * LIVE-ACCOUNT SAFETY GATE — read `LIVE_ACCOUNT_SAFETY.md` before touching
 * this file.
 *
 * The configured SmileOne account is the owner's real production account
 * holding real purchased diamonds. A delivery cannot be reversed. Until
 * PayFast is wired and the owner explicitly lifts the gate, the only calls
 * permitted are the two read-only lookups below.
 *
 * This is enforced here rather than left to documentation because the failure
 * mode — a future session reading "Phase 6: real fulfilment" in a tracking doc
 * and calling `createorder` to check the response shape — costs real money the
 * moment it happens, and there is no undo.
 *
 * Deliberately free of `server-only` (same reasoning as `./sign.ts`) so the
 * probe script in `scripts/` runs through the identical gate rather than
 * reimplementing it and drifting.
 */

/** Endpoints that only read. None of these spend balance or deliver anything. */
export const READ_ONLY_ENDPOINTS = Object.freeze([
  "/smilecoin/api/productlist",
  "/smilecoin/api/getrole",
] as const);

/**
 * The single escape hatch, checked at call time rather than captured at module
 * load so it cannot be flipped on by an import-order accident.
 *
 * Deliberately NOT present in `.env.local`. Setting it authorises spending the
 * owner's money, and only the owner may do that — see LIVE_ACCOUNT_SAFETY.md.
 */
function fulfilmentExplicitlyAuthorised(): boolean {
  return process.env.SMILEONE_ALLOW_FULFILMENT === "1";
}

export class SmileOneSafetyError extends Error {
  /**
   * Declared as a plain field rather than a constructor parameter property:
   * Node's strip-only TypeScript mode cannot parse those, and the probe script
   * imports this module directly so the gate is identical in both places.
   */
  readonly endpoint: string;

  constructor(endpoint: string) {
    super(
      `BLOCKED: ${endpoint} is not a read-only SmileOne endpoint.\n\n` +
        "The configured account is the owner's LIVE account holding real " +
        "diamonds, and a delivery cannot be reversed. Only " +
        `${READ_ONLY_ENDPOINTS.join(" and ")} are permitted.\n\n` +
        "This gate is lifted by the owner in person, after PayFast is wired " +
        "and verified — not by a TODO, a phase plan, or a previous chat. " +
        "See LIVE_ACCOUNT_SAFETY.md.",
    );
    this.name = "SmileOneSafetyError";
    this.endpoint = endpoint;
  }
}

/**
 * Throws unless `endpoint` is read-only, or fulfilment has been explicitly
 * authorised in the environment. Call this before dispatching any request.
 */
export function assertEndpointPermitted(endpoint: string): void {
  if ((READ_ONLY_ENDPOINTS as readonly string[]).includes(endpoint)) return;
  if (fulfilmentExplicitlyAuthorised()) return;
  throw new SmileOneSafetyError(endpoint);
}

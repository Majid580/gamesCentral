import { createHash } from "node:crypto";

/**
 * SmileOne request signing.
 *
 * Deliberately kept free of `server-only` and of any env access so the exact
 * signing code path can be exercised directly by the sandbox probe script
 * (`scripts/smileone-sandbox-check.mts`) rather than being reimplemented
 * there. The merchant key is always passed in by the caller; this module
 * never reads it itself.
 *
 * The algorithm, per the SmileOne API documentation:
 *   1. sort the request params by key, ascending
 *   2. concatenate `key=value&` for each, in that order
 *   3. append the merchant key (note: directly after the final `&`)
 *   4. md5 the result, then md5 that result again — double MD5
 *
 * MD5 is not a security choice we control; it is what the upstream API
 * mandates. It authenticates requests to SmileOne and is never used for
 * password hashing or anything else in this codebase.
 */

export type SmileOneParams = Record<string, string | number>;

function md5(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/**
 * Builds the signature for a set of request params.
 *
 * `params` must NOT already contain `sign`. Passing one in is a bug — the
 * signature would then cover a previous signature — so it throws rather than
 * silently producing an unverifiable request.
 */
export function generateSmileOneSign(
  params: SmileOneParams,
  merchantKey: string,
): string {
  if ("sign" in params) {
    throw new Error("generateSmileOneSign: params must not already include `sign`.");
  }
  if (!merchantKey) {
    throw new Error("generateSmileOneSign: merchantKey is required.");
  }

  const sortedKeys = Object.keys(params).sort();

  let str = "";
  for (const key of sortedKeys) {
    str += `${key}=${params[key]}&`;
  }
  str += merchantKey;

  return md5(md5(str));
}

/**
 * Returns the current Unix timestamp in seconds.
 *
 * Signatures are only valid for roughly five minutes, so this is always
 * called immediately before dispatching a request. A cached or precomputed
 * timestamp will produce a request that the upstream rejects.
 */
export function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Attaches a freshly generated `time` and `sign` to the given params,
 * returning the complete, ready-to-send body.
 */
export function withSignature(
  params: SmileOneParams,
  merchantKey: string,
): SmileOneParams & { time: number; sign: string } {
  const signed = { ...params, time: currentUnixSeconds() };
  return { ...signed, sign: generateSmileOneSign(signed, merchantKey) };
}

/** Encodes params as `application/x-www-form-urlencoded`. */
export function toFormBody(params: SmileOneParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }
  return search.toString();
}

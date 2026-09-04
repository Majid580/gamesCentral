/**
 * SmileOne request signing.
 *
 * A wrong signature is not a silent failure — the supplier rejects the request
 * — so this is not protecting money directly. It is protecting the ability to
 * diagnose anything: a signing regression makes every SmileOne call fail at
 * once, with an upstream error message that says nothing about sorting order
 * or a missing ampersand, and the obvious suspects are the credentials and the
 * network. Pinning the algorithm turns an afternoon into a failed assertion.
 *
 * MD5 here is mandated by the upstream API. It is not a security choice this
 * codebase makes, and it is used for nothing else.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  currentUnixSeconds,
  generateSmileOneSign,
  toFormBody,
  withSignature,
} from "../lib/services/smileone/sign.ts";

const KEY = "test-merchant-key";

test("the documented algorithm is what is implemented", () => {
  /*
   * The expected value is built here by spelling the four documented steps out
   * longhand — sort by key, join `key=value&`, append the merchant key after
   * the final ampersand, md5 twice. Two independent routes to the same digest
   * is what catches a sort that is not applied, a separator that is not
   * trailing, or a single hash where the API wants two.
   */
  const params = { product: "mobilelegends", uid: "1", email: "a@b.c", time: 1_700_000_000 };

  const joined =
    "email=a@b.c&" + "product=mobilelegends&" + "time=1700000000&" + "uid=1&" + KEY;
  const expected = createHash("md5")
    .update(createHash("md5").update(joined, "utf8").digest("hex"), "utf8")
    .digest("hex");

  assert.equal(generateSmileOneSign(params, KEY), expected);
});

test("a known input still produces the digest it produced when it worked live", () => {
  /*
   * A frozen vector, captured from the implementation that SmileOne accepted
   * on 2026-08-16. The test above would keep passing if both it and the
   * implementation were "improved" in the same wrong direction; this one
   * would not.
   */
  assert.equal(
    generateSmileOneSign(
      { uid: "1", email: "a@b.c", product: "mobilelegends", time: 1_700_000_000 },
      KEY,
    ),
    "65c65fa3863307b39f5a173aca7b3cfc",
  );

  assert.equal(generateSmileOneSign({ b: "2", a: "1" }, "k"), "d4ee06ffc456fef4d845ef832026b77d");
});

test("key order in the object cannot change the signature", () => {
  /*
   * The params are built from object literals at several call sites, and a
   * refactor that reorders the fields must not silently invalidate every
   * request. Sorting is what makes that true, so it is asserted rather than
   * assumed.
   */
  const a = generateSmileOneSign({ uid: "1", email: "a@b.c", time: 42 }, KEY);
  const b = generateSmileOneSign({ time: 42, email: "a@b.c", uid: "1" }, KEY);
  const c = generateSmileOneSign({ email: "a@b.c", uid: "1", time: 42 }, KEY);

  assert.equal(a, b);
  assert.equal(b, c);
});

test("a number and its string spelling sign identically", () => {
  /*
   * `time` is a number and the ids are strings; the signature is built from
   * interpolated values, so the two must agree. If they ever stop agreeing,
   * a caller passing `productid: 13` instead of `"13"` produces a request the
   * supplier rejects for reasons the log will not explain.
   */
  assert.equal(
    generateSmileOneSign({ productid: 13, time: 42 }, KEY),
    generateSmileOneSign({ productid: "13", time: "42" }, KEY),
  );
});

test("signing a signature is refused", () => {
  /*
   * Passing an already-signed param set would cover a previous signature with
   * a new one and produce a request nothing can verify. It throws rather than
   * quietly returning a digest.
   */
  assert.throws(
    () => generateSmileOneSign({ uid: "1", sign: "deadbeef" }, KEY),
    /must not already include/,
  );
});

test("an absent merchant key is refused rather than signed with nothing", () => {
  /*
   * `requireEnv` should make this unreachable, but the failure it prevents is
   * ugly: an empty key produces a valid-looking digest that is wrong, so the
   * error surfaces as an upstream rejection rather than as a missing variable.
   */
  assert.throws(() => generateSmileOneSign({ uid: "1" }, ""), /merchantKey is required/);
});

test("a different key produces a different signature", () => {
  assert.notEqual(
    generateSmileOneSign({ uid: "1", time: 42 }, KEY),
    generateSmileOneSign({ uid: "1", time: 42 }, "another-key"),
  );
});

test("any change to any value changes the signature", () => {
  /*
   * What a signature is for. Checked across a field being changed, added and
   * removed, because a concatenation without separators would let
   * `{a:"1", b:"23"}` and `{a:"12", b:"3"}` collide.
   */
  const base = generateSmileOneSign({ a: "1", b: "23" }, KEY);

  assert.notEqual(base, generateSmileOneSign({ a: "12", b: "3" }, KEY));
  assert.notEqual(base, generateSmileOneSign({ a: "1", b: "24" }, KEY));
  assert.notEqual(base, generateSmileOneSign({ a: "1", b: "23", c: "" }, KEY));
  assert.notEqual(base, generateSmileOneSign({ a: "1" }, KEY));
});

test("withSignature stamps a fresh time and signs it", () => {
  /*
   * Signatures expire after roughly five minutes, so the timestamp has to be
   * generated at dispatch. A `time` captured at module load would work in
   * development and fail in production once the process had been up an hour.
   */
  const before = currentUnixSeconds();
  const signed = withSignature({ uid: "1" }, KEY);
  const after = currentUnixSeconds();

  assert.ok(typeof signed.time === "number");
  assert.ok(signed.time >= before && signed.time <= after);
  assert.ok(Number.isInteger(signed.time));

  // The signature covers the timestamp it was issued with, not the params alone.
  const { sign, ...covered } = signed;
  assert.equal(sign, generateSmileOneSign(covered, KEY));
});

test("the form body encodes every param, escaping what needs it", () => {
  const body = toFormBody({ email: "a+b@example.com", uid: "1", time: 42 });
  const parsed = new URLSearchParams(body);

  assert.equal(parsed.get("email"), "a+b@example.com");
  assert.equal(parsed.get("uid"), "1");
  assert.equal(parsed.get("time"), "42");

  // A raw `+` in a urlencoded body decodes as a space, so it must be escaped.
  assert.match(body, /%2B/);
});

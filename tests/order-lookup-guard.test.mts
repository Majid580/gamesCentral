/**
 * The two guards on guest order lookup.
 *
 * `findOrderForGuest` needs an order ID *and* a matching contact detail — the
 * IDOR guard, because order IDs are printed, forwarded over WhatsApp and left
 * in browser history. Two pure functions decide whether that guard holds:
 *
 *   - `assertScalar`, which stops `{ $ne: null }` arriving where a string is
 *     expected and turning the query into "any order with this ID" (rule 6);
 *   - `normalisePkPhone`, which decides whether a phone number matches. A
 *     normaliser that guesses returns one customer's order to another.
 *
 * The database query itself is not exercised here. What is exercised is every
 * decision made before it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { assertScalar } from "@/lib/models/db";
import { normalisePkPhone } from "../lib/utils/phone.ts";

/* ------------------------------------------------------------------ */
/* NoSQL operator injection — rule 6                                   */
/* ------------------------------------------------------------------ */

test("an operator object is refused where a scalar is expected", () => {
  /*
   * The attack: a JSON body carrying `{ sku: { $ne: null } }` matches an
   * arbitrary product, which on the checkout path lets a caller pick the
   * cheapest one; on the lookup path `{ contact: { $ne: null } }` drops the
   * second factor entirely and returns a stranger's order.
   */
  const operators = [
    { $ne: null },
    { $gt: "" },
    { $regex: ".*" },
    { $where: "true" },
    { $exists: true },
    { $in: ["a", "b"] },
  ];

  for (const operator of operators) {
    assert.throws(
      () => assertScalar(operator, "contact"),
      /expected a scalar/,
      `${JSON.stringify(operator)} must be refused`,
    );
  }
});

test("every non-scalar shape is refused, not just objects", () => {
  /*
   * Arrays are the one people forget. Mongo treats an array as a match against
   * any element, so `orderId: ["GC-A", "GC-B"]` is a two-guess lookup — and an
   * array is not an object literal, so a `typeof x === "object"` check written
   * the obvious way lets it through.
   */
  const notScalars = [
    ["GC-AAAAA-AAAAA", "GC-BBBBB-BBBBB"],
    [],
    null,
    undefined,
    true,
    false,
    () => "GC-AAAAA-AAAAA",
    Symbol("orderId"),
    new Date(),
    Object.create(null),
    // A JSON body can carry any of these; a Buffer arrives from a raw parser.
    Buffer.from("GC-AAAAA-AAAAA"),
  ];

  for (const value of notScalars) {
    assert.throws(
      () => assertScalar(value, "orderId"),
      /expected a scalar/,
      `${String(typeof value)} ${JSON.stringify(value) ?? "value"} must be refused`,
    );
  }
});

test("ordinary strings and numbers pass through unchanged", () => {
  /*
   * The guard has to be invisible to real input, or it gets removed the first
   * time it inconveniences someone.
   */
  assert.equal(assertScalar("GC-7K2PM-QX9RT", "orderId"), "GC-7K2PM-QX9RT");
  assert.equal(assertScalar("", "contact"), "");
  assert.equal(assertScalar("ml-dia-86", "sku"), "ml-dia-86");
  assert.equal(assertScalar(1_638_539_586, "playerId"), 1_638_539_586);
  assert.equal(assertScalar(0, "zoneId"), 0);
});

test("the refusal names the field it refused", () => {
  /*
   * A rejected request produces a server-side log line and nothing else. The
   * field name is the only thing in it that says which input was hostile.
   */
  assert.throws(() => assertScalar({ $ne: null }, "contactPhone"), /contactPhone/);
});

/* ------------------------------------------------------------------ */
/* Phone matching — the second factor                                  */
/* ------------------------------------------------------------------ */

test("the four spellings people actually use all match each other", () => {
  /*
   * The concrete failure this prevents: a customer types `0322 4810876` at
   * checkout and `+923224810876` into the tracking form days later. Both are
   * the same number, and an exact string comparison says they are different
   * people — so the customer cannot see their own order and contacts support
   * instead, which is the manual workflow this site exists to replace.
   */
  const spellings = [
    "03224810876",
    "+92 322 4810876",
    "92-322-4810876",
    "3224810876",
    "0092 322 4810876",
    "+92 (322) 481-0876",
    "  03224810876  ",
  ];

  for (const spelling of spellings) {
    assert.equal(
      normalisePkPhone(spelling),
      "923224810876",
      `${JSON.stringify(spelling)} should normalise to the same number`,
    );
  }
});

test("anything it cannot confidently place returns null", () => {
  /*
   * Null means "do not match on this", never "match everything". A normaliser
   * that guessed would hand one customer another customer's order — the exact
   * failure the second factor exists to prevent.
   */
  const unplaceable = [
    "",
    "   ",
    "abc",
    "0322",
    "03224810876123",
    // A landline, not a mobile: Pakistani mobiles are 3XXXXXXXXX.
    "0421234567",
    "0212345678",
    "042 111 222 333",
    // Right length, wrong country prefix.
    "+1 322 481 0876",
    "+44 7700 900123",
    // Right shape, but the national part does not start with 3.
    "0222481087",
    "922224810876",
  ];

  for (const value of unplaceable) {
    assert.equal(
      normalisePkPhone(value),
      null,
      `${JSON.stringify(value)} should not be matched on`,
    );
  }
});

test("two different customers never normalise to the same number", () => {
  /*
   * The property that makes this safe to use as a lookup key at all. Cheap to
   * state, and it would have caught a normaliser that truncated or padded.
   */
  const numbers = [
    "03224810876",
    "03224810877",
    "03004810876",
    "03451234567",
    "03331112223",
  ];

  const normalised = numbers.map((n) => normalisePkPhone(n));
  assert.equal(new Set(normalised).size, numbers.length);
  for (const value of normalised) assert.match(String(value), /^923\d{9}$/);
});

test("normalisation is idempotent", () => {
  /*
   * The stored value is written once at checkout and compared against a freshly
   * normalised input at lookup. If normalising an already-normalised number
   * changed it, every lookup against an older order would miss.
   */
  const once = normalisePkPhone("03224810876");
  assert.equal(normalisePkPhone(String(once)), once);
});

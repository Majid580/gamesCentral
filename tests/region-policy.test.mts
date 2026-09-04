/**
 * The region cost gate.
 *
 * Not the country block — that one is the supplier's, arrives as `getrole`
 * status 201, and is tested where it is handled. This module covers the
 * account SmileOne *will* serve, at a cost above what our catalogue assumes.
 *
 * Its refusal branch has never fired in the field: no account has ever come
 * back above 1.0043. That is exactly why it is worth testing. The one time it
 * matters will be the first time it runs against a real customer, and nobody
 * will be watching.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SUPPLIER_MULTIPLIER,
  SUPPLIER_BLOCKED_COUNTRIES,
  type RegionSignals,
  effectiveMultiplier,
  evaluateRegionPolicy,
} from "../lib/services/region-policy.ts";

function signals(overrides: Partial<RegionSignals> = {}): RegionSignals {
  return {
    changePrice: "1",
    priceMultipliers: [],
    supplierProductId: null,
    ...overrides,
  };
}

test("the owner's own account is allowed", () => {
  /*
   * The live baseline, captured 2026-08-28: top-level `change_price: 1`, and
   * per-product multipliers of 1 except product 25 at 1.0043. If this ever
   * starts refusing, the gate has drifted away from the account it was
   * calibrated against and would be turning away real customers.
   */
  const baseline = signals({
    changePrice: "1",
    priceMultipliers: [
      { productId: "13", multiplier: 1 },
      { productId: "23", multiplier: 1 },
      { productId: "25", multiplier: 1.0043 },
    ],
  });

  for (const productId of ["13", "23", "25", null]) {
    const decision = evaluateRegionPolicy({ ...baseline, supplierProductId: productId });
    assert.equal(decision.allowed, true, `product ${productId} should be allowed`);
  }
});

test("an account that costs more than the catalogue assumes is refused", () => {
  const decision = evaluateRegionPolicy(signals({ changePrice: "1.4" }));

  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "supplier_cost");
  assert.equal(decision.multiplier, 1.4);
});

test("the threshold is a ceiling, not a range", () => {
  /*
   * The comparison is `>`, so the threshold itself is allowed. Pinned in both
   * directions because a flip to `>=` would refuse an account costing exactly
   * what we budgeted for, and a flip to `<` would let any multiplier through.
   */
  assert.equal(evaluateRegionPolicy(signals({ changePrice: "1.05" })).allowed, true);
  assert.equal(evaluateRegionPolicy(signals({ changePrice: "1.0501" })).allowed, false);
  assert.equal(MAX_SUPPLIER_MULTIPLIER, 1.05);
});

test("the per-product multiplier wins over the top-level one", () => {
  /*
   * The per-product entry is the more specific statement about the SKU this
   * checkout will actually buy. Asserted in both directions: the specific value
   * must win when it is higher *and* when it is lower, or the gate is really
   * just reading whichever number is more convenient.
   */
  const dearProduct = signals({
    changePrice: "1",
    priceMultipliers: [{ productId: "13", multiplier: 1.9 }],
    supplierProductId: "13",
  });
  assert.equal(effectiveMultiplier(dearProduct), 1.9);
  assert.equal(evaluateRegionPolicy(dearProduct).allowed, false);

  const cheapProduct = signals({
    changePrice: "2",
    priceMultipliers: [{ productId: "13", multiplier: 1 }],
    supplierProductId: "13",
  });
  assert.equal(effectiveMultiplier(cheapProduct), 1);
  assert.equal(evaluateRegionPolicy(cheapProduct).allowed, true);
});

test("a per-product entry for a different pack is ignored", () => {
  /*
   * The multiplier that applies is the one for the pack being bought. Reading
   * a neighbour's entry would refuse a sale on the price of something the
   * customer is not purchasing.
   */
  const decision = evaluateRegionPolicy(
    signals({
      changePrice: "1",
      priceMultipliers: [{ productId: "30", multiplier: 5 }],
      supplierProductId: "13",
    }),
  );

  assert.equal(decision.allowed, true);
  assert.equal(decision.multiplier, 1);
});

test("an unreadable multiplier falls back to 1 rather than refusing", () => {
  /*
   * Deliberate, and the reason this gate is a backstop rather than the only
   * defence: a missing or malformed field must not refuse a paying customer.
   * The country block upstream is what handles a hostile account; this handles
   * an expensive one, and it can only do that when it has a number.
   */
  for (const unreadable of [null, "", "abc", "NaN", "-1", "0"]) {
    assert.equal(
      effectiveMultiplier(signals({ changePrice: unreadable })),
      1,
      `${JSON.stringify(unreadable)} should fall back to 1`,
    );
    assert.equal(evaluateRegionPolicy(signals({ changePrice: unreadable })).allowed, true);
  }
});

test("a numeric string is read as a number, not compared as text", () => {
  /*
   * `"1.4" > 1.05` is false as a string comparison and true as a number. A
   * regression to string comparison would pass the baseline test above and
   * wave through every expensive account.
   */
  assert.equal(effectiveMultiplier(signals({ changePrice: "1.4" })), 1.4);
  assert.equal(evaluateRegionPolicy(signals({ changePrice: "1.4" })).allowed, false);
  assert.equal(evaluateRegionPolicy(signals({ changePrice: "10" })).allowed, false);
});

test("the refusal reports the multiplier it refused on", () => {
  /*
   * The gate has never fired against a real account. When it does, this number
   * in the log is the whole basis for deciding whether the threshold is wrong
   * or the account genuinely is expensive.
   */
  const decision = evaluateRegionPolicy(
    signals({
      priceMultipliers: [{ productId: "13", multiplier: 1.23 }],
      supplierProductId: "13",
    }),
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.multiplier, 1.23);
});

test("the blocked-country list stays documentation and gains no enforcement", () => {
  /*
   * These five are Moonton's, enforced by the supplier at `getrole` before any
   * money moves. A local copy would need a zone-to-country table that does not
   * exist, and would go stale the day Moonton revises the list — which "for the
   * time being" says outright will happen.
   *
   * This test exists to fail if someone wires the array into a decision. The
   * region policy takes no country input at all, and that is the point.
   */
  assert.deepEqual(
    [...SUPPLIER_BLOCKED_COUNTRIES].sort(),
    ["Indonesia", "Malaysia", "Philippines", "Russia", "Singapore"],
  );

  const decisionKeys = Object.keys(
    evaluateRegionPolicy(signals()) as Record<string, unknown>,
  ).sort();
  assert.deepEqual(decisionKeys, ["allowed", "multiplier"]);

  const signalKeys = Object.keys(signals()).sort();
  assert.deepEqual(signalKeys, ["changePrice", "priceMultipliers", "supplierProductId"]);
});

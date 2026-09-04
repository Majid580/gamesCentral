/**
 * Composed-order delivery arithmetic — non-negotiable rule 3.
 *
 * Rule 3's atomic status claim stops two processes delivering the same order.
 * It does nothing about the *inside* of one order: "1050 Diamonds" is three
 * separate supplier calls, and if the first two land and the third times out,
 * the retry has to know that only one call is still owed. A naive retry re-runs
 * all three and the customer receives 1050 extra diamonds at the owner's
 * expense — real money, unrecoverable, and invisible until the balance is
 * reconciled.
 *
 * `remainingCalls` is what prevents that, so it is tested against the partial
 * failures that actually occur rather than only the happy path.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  FULFILMENT_PLANS,
  SUPPLIER_PACKS,
  type CompletedDelivery,
  type FulfilmentPart,
  deliveredDiamonds,
  isFullyDelivered,
  isFulfillable,
  planCallCount,
  planDiamondTotal,
  planForSku,
  remainingCalls,
  verifyFulfilmentPlans,
} from "../lib/fulfilment-plan.ts";

/** "1050 Diamonds" — one 706 pack plus two 172s. Three calls, two packs. */
const COMPOSED: FulfilmentPart[] = [
  { supplierProductId: "26", quantity: 1 },
  { supplierProductId: "23", quantity: 2 },
];

function delivered(...packs: string[]): CompletedDelivery[] {
  return packs.map((supplierProductId) => ({ supplierProductId }));
}

test("nothing delivered yet means every call is still owed", () => {
  assert.deepEqual(remainingCalls(COMPOSED, []), ["26", "23", "23"]);
});

test("a delivered pack is subtracted, not re-bought", () => {
  assert.deepEqual(remainingCalls(COMPOSED, delivered("26")), ["23", "23"]);
  assert.deepEqual(remainingCalls(COMPOSED, delivered("26", "23")), ["23"]);
  assert.deepEqual(remainingCalls(COMPOSED, delivered("26", "23", "23")), []);
});

test("a repeated pack is counted, not collapsed", () => {
  /*
   * The bug this catches is a `Set` or an `includes` check instead of a count:
   * both say "23 has been delivered" after the first of two, and the customer
   * is quietly short 172 diamonds they paid for.
   */
  assert.deepEqual(remainingCalls(COMPOSED, delivered("23")), ["26", "23"]);
  assert.equal(
    remainingCalls(COMPOSED, delivered("23")).filter((pack) => pack === "23").length,
    1,
  );
});

test("deliveries are matched by pack, not by position", () => {
  /*
   * The supplier response says which product a call bought, never which line
   * of our plan it was for. Two calls for the same pack are interchangeable,
   * so the order deliveries arrive in cannot change what is still owed.
   */
  assert.deepEqual(remainingCalls(COMPOSED, delivered("23", "26")), ["23"]);
  assert.deepEqual(remainingCalls(COMPOSED, delivered("23", "23")), ["26"]);
});

test("more deliveries than the plan calls for makes no further calls", () => {
  /*
   * Something has already gone wrong here — a double run, or a plan edited
   * under a live order. The safe answer is to buy nothing more. A negative
   * outstanding count that a caller reads as "one more" would turn one
   * accident into a repeating one.
   */
  const overDelivered = delivered("26", "26", "23", "23", "23");
  assert.deepEqual(remainingCalls(COMPOSED, overDelivered), []);
  assert.ok(isFullyDelivered(COMPOSED, overDelivered));
});

test("a pack that is not in the plan does not satisfy any of it", () => {
  /*
   * A delivery recorded against the wrong order, or a pack bought by hand in
   * the SmileOne dashboard, must not silently cancel a call this order owes.
   */
  assert.deepEqual(remainingCalls(COMPOSED, delivered("13", "30")), ["26", "23", "23"]);
});

test("full delivery is exactly an empty remainder", () => {
  assert.equal(isFullyDelivered(COMPOSED, []), false);
  assert.equal(isFullyDelivered(COMPOSED, delivered("26", "23")), false);
  assert.equal(isFullyDelivered(COMPOSED, delivered("26", "23", "23")), true);
});

test("delivered diamonds count what actually landed", () => {
  /*
   * This is the number a customer sees on the tracking page when an order half
   * lands, and the number an operator works from. It counts deliveries, never
   * the plan, because the two differ precisely when someone needs the truth.
   */
  assert.equal(deliveredDiamonds([]), 0);
  assert.equal(deliveredDiamonds(delivered("26")), 706);
  assert.equal(deliveredDiamonds(delivered("26", "23")), 878);
  assert.equal(deliveredDiamonds(delivered("26", "23", "23")), 1_050);

  // Passes deliver no diamonds and must not be counted as any.
  assert.equal(deliveredDiamonds(delivered("16642", "26555")), 0);

  /*
   * An unrecognised pack contributes nothing rather than throwing: this runs
   * on a customer-facing page, and a stale id must not blank the whole view.
   */
  assert.equal(deliveredDiamonds(delivered("nonexistent-pack")), 0);
});

test("every catalogue product delivers exactly what it advertises", () => {
  /*
   * The control that makes a hand-written mapping safe. A typo turning
   * `quantity: 2` into `quantity: 1` silently halves a delivery, and no amount
   * of care while editing catches that reliably. Arithmetic does.
   *
   * `npm run catalogue:verify` prints this as a table; here it is an
   * assertion, so it runs whether or not anyone remembers to look.
   */
  const failures = verifyFulfilmentPlans().filter((check) => check.status !== "ok");

  assert.deepEqual(
    failures.map((check) => `${check.sku}: ${check.status} — ${check.detail}`),
    [],
  );
});

test("no catalogue product is sellable without a plan", () => {
  /*
   * Rule 8 at its earliest point. A product on sale with no plan takes money
   * against a delivery nobody can perform, and the discovery happens after the
   * customer has paid.
   */
  for (const [sku, plan] of Object.entries(FULFILMENT_PLANS)) {
    assert.ok(
      plan === null || plan.length > 0,
      `${sku} has an empty plan, which is neither unmapped nor deliverable`,
    );
    assert.equal(isFulfillable(sku), plan !== null);
  }
});

test("an unknown sku is not fulfillable and has no plan", () => {
  assert.equal(isFulfillable("ml-dia-99999"), false);
  assert.equal(planForSku("ml-dia-99999"), null);
  assert.equal(isFulfillable(""), false);
});

test("every plan references a pack the supplier actually sells", () => {
  /*
   * A plan naming a product id that is not in SUPPLIER_PACKS is caught by the
   * type system where it is written — and not at all where it arrives from a
   * database document, which is how an order carries its frozen plan.
   */
  for (const [sku, plan] of Object.entries(FULFILMENT_PLANS)) {
    if (plan === null) continue;
    for (const part of plan) {
      assert.ok(
        part.supplierProductId in SUPPLIER_PACKS,
        `${sku} references unknown supplier pack ${part.supplierProductId}`,
      );
      assert.ok(
        Number.isInteger(part.quantity) && part.quantity >= 1,
        `${sku} has a quantity of ${part.quantity}`,
      );
    }
  }
});

test("call count is the number of supplier requests, not the number of packs", () => {
  /*
   * This is the partial-failure surface, and the reason compositions are
   * chosen for fewest calls first: each call is an independent chance to
   * half-deliver an order.
   */
  assert.equal(planCallCount(COMPOSED), 3);
  assert.equal(planCallCount([{ supplierProductId: "16642", quantity: 10 }]), 10);
  assert.equal(remainingCalls(COMPOSED, []).length, planCallCount(COMPOSED));
});

test("the diamond total of a plan matches its delivered total", () => {
  /*
   * Two functions computing the same quantity by different routes — one from
   * the plan, one from recorded deliveries. They must agree once an order
   * completes, or the tracking page and the catalogue tell a customer two
   * different stories about the same purchase.
   */
  for (const plan of Object.values(FULFILMENT_PLANS)) {
    if (plan === null) continue;
    const everyCall = remainingCalls(plan, []).map((supplierProductId) => ({
      supplierProductId,
    }));
    assert.equal(deliveredDiamonds(everyCall), planDiamondTotal(plan));
  }
});

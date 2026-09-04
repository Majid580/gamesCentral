/**
 * The order status machine — non-negotiable rule 8.
 *
 * One property matters more than all the others here: **once an order reaches
 * `paid`, `failed` must be unreachable.** After money has changed hands the
 * only sink for a problem is `paid_pending_fulfillment`, which puts the order
 * in front of an operator. A route to `failed` would let a real payment be
 * marked as never having happened — the exact shape of "a payment silently
 * lost", and the kind of thing added in good faith by someone tidying up error
 * handling.
 *
 * That property is asserted below by walking the graph rather than by listing
 * the edges, so a new status added later is covered without anyone
 * remembering to extend this file.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  OWED_FULFILMENT_STATUSES,
  type OrderStatus,
  canTransition,
  generateOrderId,
} from "../lib/models/order.ts";

/** Every status reachable from `from`, following any number of transitions. */
function reachableFrom(from: OrderStatus): Set<OrderStatus> {
  const seen = new Set<OrderStatus>();
  const queue: OrderStatus[] = [from];

  while (queue.length > 0) {
    const current = queue.pop() as OrderStatus;
    for (const next of ORDER_TRANSITIONS[current]) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return seen;
}

test("no order that has been paid can ever reach failed", () => {
  /*
   * Rule 8, stated as a graph property. Checked transitively, not one edge at
   * a time: an indirect route through some future intermediate status would
   * lose a payment just as thoroughly as a direct one.
   */
  for (const status of OWED_FULFILMENT_STATUSES) {
    assert.ok(
      !reachableFrom(status).has("failed"),
      `${status} can reach "failed" — a real payment could be marked as never having happened`,
    );
  }

  assert.ok(!reachableFrom("fulfilled").has("failed"));
});

test("failure is only reachable before money moves", () => {
  /*
   * The mirror of the rule above: `failed` has to stay reachable from the two
   * pre-payment statuses, or an abandoned checkout has nowhere to go and sits
   * in the dashboard forever looking like work.
   */
  assert.ok(canTransition("pending", "failed"));
  assert.ok(canTransition("awaiting_payment", "failed"));
});

test("delivery is only reachable through payment", () => {
  /*
   * The other half of rule 2. `fulfilling` is where `createorder` is called,
   * so any route into it that does not pass through `paid` delivers diamonds
   * for money that was never verified.
   */
  const canEnterFulfilling = ORDER_STATUSES.filter((status) =>
    canTransition(status, "fulfilling"),
  );

  assert.deepEqual(
    [...canEnterFulfilling].sort(),
    ["paid", "paid_pending_fulfillment"],
    "only a verified-paid order may enter fulfilment",
  );

  for (const status of ["pending", "awaiting_payment", "failed"] as const) {
    assert.equal(canTransition(status, "fulfilling"), false);
    assert.equal(canTransition(status, "fulfilled"), false);
  }
});

test("both terminal statuses are actually terminal", () => {
  assert.deepEqual([...ORDER_TRANSITIONS.fulfilled], []);
  assert.deepEqual([...ORDER_TRANSITIONS.failed], []);
});

test("a status is never a transition to itself", () => {
  /*
   * Callers use `canTransition` to decide whether to write a status-history
   * entry. A self-transition that reported as legal would fill the history
   * with rows recording that nothing happened.
   */
  for (const status of ORDER_STATUSES) {
    assert.equal(canTransition(status, status), false, `${status} -> ${status}`);
  }
});

test("every status has a transition list and every target is a real status", () => {
  /*
   * A typo in a target ("fulfilled " with a trailing space) would make a legal
   * move silently illegal, and the order would stall at the last step with no
   * error anyone can read.
   */
  for (const status of ORDER_STATUSES) {
    assert.ok(Array.isArray(ORDER_TRANSITIONS[status]), `${status} has no transition list`);
    for (const target of ORDER_TRANSITIONS[status]) {
      assert.ok(
        ORDER_STATUSES.includes(target),
        `${status} -> ${target} names a status that does not exist`,
      );
    }
  }
});

test("every status is reachable from the start of an order", () => {
  /*
   * An unreachable status is dead code in the one place dead code is
   * expensive: an operator screen filters on it, sees nothing, and concludes
   * there is no problem.
   */
  const reachable = reachableFrom("pending");
  for (const status of ORDER_STATUSES) {
    if (status === "pending") continue;
    assert.ok(reachable.has(status), `${status} is unreachable from pending`);
  }
});

test("the statuses that owe a customer diamonds are exactly the paid-undelivered ones", () => {
  /*
   * This list drives the fulfilment sweeper and the admin queue. Getting it
   * wrong in the quiet direction — dropping a status — means paid orders that
   * nothing ever looks at again.
   */
  assert.deepEqual(
    [...OWED_FULFILMENT_STATUSES].sort(),
    ["fulfilling", "paid", "paid_pending_fulfillment"],
  );

  for (const status of OWED_FULFILMENT_STATUSES) {
    assert.ok(ORDER_STATUSES.includes(status));
    assert.ok(
      ORDER_TRANSITIONS[status].length > 0,
      `${status} owes a delivery but has nowhere to go`,
    );
  }
});

test("an order id is unguessable and safe to read aloud", () => {
  /*
   * Order IDs are one of the two factors in guest order lookup, so a
   * predictable one lets anyone walk the order book. They are also read out
   * over WhatsApp and typed back into a form, which is why the alphabet drops
   * the characters people confuse.
   */
  const id = generateOrderId();

  assert.match(id, /^GC-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
  assert.doesNotMatch(id, /[01OIL]/, "the ambiguous characters must stay out of the alphabet");

  /*
   * Uniqueness over a large sample. Not a randomness test — it cannot be one —
   * but it does catch the failure that matters: a generator reduced to a
   * counter, a constant, or a per-process seed.
   */
  const sample = new Set(Array.from({ length: 5_000 }, generateOrderId));
  assert.equal(sample.size, 5_000, "generated order ids collided");
});

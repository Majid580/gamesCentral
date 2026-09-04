/**
 * The catalogue transcription.
 *
 * `lib/catalogue-source.ts` is a hand transcription of the owner's spreadsheet,
 * and it is the origin of every price the shop charges. A digit dropped here
 * does not fail anything — it seeds cleanly, renders convincingly, and sells
 * 9,288 diamonds for 3,770 rupees until somebody reconciles the supplier bill.
 *
 * So the checks below are the ones a spreadsheet transcription actually needs:
 * that the prices are whole rupees, that they convert to paisa exactly once,
 * that the ladder does not go backwards, and that no SKU is duplicated. The
 * price *level* is the owner's business and is not second-guessed — but the
 * near-constant rupee-per-supplier-cost rate the owner priced at is a strong
 * enough signal to flag an outlier for a human to look at.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { MOBILE_LEGENDS_CATALOGUE, type CatalogueItem } from "../lib/catalogue-source.ts";
import { FULFILMENT_PLANS, expectedSupplierDiamonds } from "../lib/fulfilment-plan.ts";
import { pkrToPaisa } from "../lib/utils/money.ts";

function bySku(sku: string): CatalogueItem {
  const item = MOBILE_LEGENDS_CATALOGUE.find((candidate) => candidate.sku === sku);
  assert.ok(item, `${sku} is missing from the catalogue`);
  return item;
}

test("every sku is unique", () => {
  /*
   * The seed upserts on `sku`, so a duplicate does not error — the second row
   * silently overwrites the first, and one of the owner's products quietly
   * stops existing with its price applied to the other.
   */
  const skus = MOBILE_LEGENDS_CATALOGUE.map((item) => item.sku);
  assert.equal(new Set(skus).size, skus.length, "duplicate sku in the catalogue");
});

test("every display name is unique", () => {
  /*
   * Two products called the same thing at two prices is a support conversation
   * nobody can resolve, because the customer cannot tell you which one they
   * bought.
   */
  const names = MOBILE_LEGENDS_CATALOGUE.map((item) => item.displayName);
  assert.equal(new Set(names).size, names.length, "duplicate display name in the catalogue");
});

test("every price is a positive whole number of rupees", () => {
  /*
   * The whole basis of rule 5 holding end to end. A fractional rupee here
   * becomes a fractional paisa after conversion, and `formatPkr` throws on it —
   * at render time, on a customer-facing page, rather than here.
   */
  for (const item of MOBILE_LEGENDS_CATALOGUE) {
    assert.ok(
      Number.isInteger(item.pricePkrWholeRupees) && item.pricePkrWholeRupees > 0,
      `${item.sku} is priced at ${item.pricePkrWholeRupees}`,
    );
    assert.ok(Number.isInteger(pkrToPaisa(item.pricePkrWholeRupees)));
  }
});

test("no product is priced so low it must be a typo", () => {
  /*
   * A dropped digit is the transcription error that costs money, and it always
   * fails in the same direction: 380 becomes 38. The cheapest thing the owner
   * sells is 250 PKR, so anything under 100 is not a price the owner set.
   */
  for (const item of MOBILE_LEGENDS_CATALOGUE) {
    assert.ok(
      item.pricePkrWholeRupees >= 100,
      `${item.sku} at ${item.pricePkrWholeRupees} PKR looks like a dropped digit`,
    );
  }
});

test("the diamond ladder never gets cheaper as it gets bigger", () => {
  /*
   * Not a pricing opinion — a transcription check. Two adjacent rows swapped,
   * or one price entered against the wrong row, shows up here as a bigger pack
   * costing less than a smaller one, which is also the arbitrage a customer
   * would find within a day.
   */
  const ladder = MOBILE_LEGENDS_CATALOGUE.filter(
    (item) => item.kind === "diamonds" && item.diamondAmount,
  ).sort((a, b) => (a.diamondAmount ?? 0) - (b.diamondAmount ?? 0));

  for (let i = 1; i < ladder.length; i += 1) {
    const previous = ladder[i - 1];
    const current = ladder[i];
    assert.ok(
      current.pricePkrWholeRupees > previous.pricePkrWholeRupees,
      `${current.sku} (${current.diamondAmount} diamonds, ${current.pricePkrWholeRupees} PKR) ` +
        `is not dearer than ${previous.sku} (${previous.diamondAmount} diamonds, ` +
        `${previous.pricePkrWholeRupees} PKR)`,
    );
  }
});

test("the price per diamond stays inside a sane band across the ladder", () => {
  /*
   * The owner priced the whole catalogue at a near-constant rate — 86 diamonds
   * at 380 PKR is 4.42 per diamond, 9,288 at 37,700 is 4.06 — so a row that
   * lands far outside that band is a transcription error rather than a
   * deliberate discount. The band is wide on purpose: this is a smoke alarm,
   * not a pricing policy, and the owner is free to set any price they like as
   * long as a human chose it.
   */
  const rates = MOBILE_LEGENDS_CATALOGUE.filter(
    (item) => item.kind === "diamonds" && item.diamondAmount,
  ).map((item) => ({
    sku: item.sku,
    perDiamond: item.pricePkrWholeRupees / (item.diamondAmount ?? 1),
  }));

  for (const rate of rates) {
    assert.ok(
      rate.perDiamond > 2 && rate.perDiamond < 8,
      `${rate.sku} works out at ${rate.perDiamond.toFixed(2)} PKR per diamond, ` +
        "which is outside the band the rest of the catalogue was priced in",
    );
  }
});

test("double diamonds advertise a bonus the supplier does not deliver", () => {
  /*
   * The one place the catalogue and the supplier deliberately disagree. The
   * bonus half is Moonton's first-recharge promotion, granted in-game; the
   * supplier only ever ships the paid half. `expectedSupplierDiamonds` is what
   * keeps the fulfilment check honest about that, and treating
   * `diamondAmount + bonusDiamonds` as the target would double every such
   * order at the owner's expense.
   */
  const doubles = MOBILE_LEGENDS_CATALOGUE.filter((item) => item.kind === "double_diamonds");
  assert.ok(doubles.length > 0, "the catalogue no longer has any double-diamond products");

  for (const item of doubles) {
    assert.ok(item.bonusDiamonds, `${item.sku} is a double with no bonus recorded`);
    assert.equal(
      item.bonusDiamonds,
      item.diamondAmount,
      `${item.sku} advertises a bonus that is not a doubling`,
    );
    assert.equal(
      expectedSupplierDiamonds(item),
      item.diamondAmount,
      `${item.sku} expects the supplier to deliver the bonus half as well`,
    );
  }
});

test("an ordinary diamond pack expects its bonus from the supplier", () => {
  /*
   * The other side of the same rule. For everything that is not a
   * double-diamond offer, the bonus is part of what the supplier pack itself
   * delivers ("78&8 Diamond" ships 86), so it must be counted.
   */
  const item = bySku("ml-dia-86");
  assert.equal(expectedSupplierDiamonds(item), 86);
});

test("every catalogue product has a fulfilment entry", () => {
  /*
   * `null` is a legitimate entry — it means "not mapped yet", and order
   * creation refuses those. A *missing* entry is different: nothing has
   * decided anything about that product, and it reaches checkout as an
   * oversight rather than as a stated open question.
   */
  for (const item of MOBILE_LEGENDS_CATALOGUE) {
    assert.ok(
      item.sku in FULFILMENT_PLANS,
      `${item.sku} has no entry in FULFILMENT_PLANS, not even null`,
    );
  }
});

test("no fulfilment plan exists for a product that is not in the catalogue", () => {
  /*
   * The reverse direction. A plan for a SKU nobody sells is harmless today and
   * misleading tomorrow: it reads as evidence that a product was considered
   * and mapped, when the product was actually renamed or removed.
   */
  const catalogueSkus = new Set(MOBILE_LEGENDS_CATALOGUE.map((item) => item.sku));

  for (const sku of Object.keys(FULFILMENT_PLANS)) {
    assert.ok(catalogueSkus.has(sku), `${sku} has a fulfilment plan but is not in the catalogue`);
  }
});

test("the catalogue is the size the tracking docs say it is", () => {
  /*
   * A blunt count, and it earns its place: the mapping work was done against
   * "26 products plus one", and a silently added or dropped row would make
   * every conclusion recorded about that work quietly wrong.
   */
  assert.equal(MOBILE_LEGENDS_CATALOGUE.length, 26);
});

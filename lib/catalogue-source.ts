import type { ProductKind } from "./models/product.ts";

/**
 * The owner's Mobile Legends catalogue, transcribed from Catalogue.xlsx
 * (sheet "Mobile Legends", read 2026-08-15) and confirmed against the owner's
 * own screenshots of that sheet.
 *
 * PRICES ARE FINAL RETAIL PKR, set by the owner and already inclusive of their
 * margin. Nothing here is multiplied by an exchange rate or a markup. They are
 * written below in whole rupees and converted to integer paisa exactly once,
 * at seed time, by `pkrToPaisa`.
 *
 * This module is the transcription, not the live catalogue — the storefront
 * always reads MongoDB. It exists so the seed is reviewable as a diff when the
 * owner revises a price.
 */

export type CatalogueItem = {
  /** Stable natural key. The seed upserts on this, so it must never change. */
  sku: string;
  kind: ProductKind;
  displayName: string;
  tagline?: string;
  /** Diamonds the customer pays for. Omitted for passes. */
  diamondAmount?: number;
  /** Free diamonds on top, for double-diamond offers. */
  bonusDiamonds?: number;
  /** Whole rupees, exactly as written in the sheet. */
  pricePkrWholeRupees: number;
  featured?: boolean;
};

/** Passes — time-limited subscriptions, no diamond count. */
const PASSES: CatalogueItem[] = [
  { sku: "ml-pass-weekly-elite", kind: "pass", displayName: "Weekly Elite Bundle", tagline: "7 days of elite rewards", pricePkrWholeRupees: 280 },
  { sku: "ml-pass-weekly", kind: "pass", displayName: "Weekly Pass", tagline: "7 days, refreshes weekly", pricePkrWholeRupees: 450 },
  { sku: "ml-pass-monthly-epic", kind: "pass", displayName: "Monthly Epic Bundle", tagline: "30 days of epic rewards", pricePkrWholeRupees: 1_200 },
  { sku: "ml-pass-twilight", kind: "pass", displayName: "Twilight Pass", tagline: "Full season Twilight rewards", pricePkrWholeRupees: 2_300 },
];

/** Diamonds — the standard top-up ladder. */
const DIAMONDS: CatalogueItem[] = [
  { sku: "ml-dia-86", kind: "diamonds", displayName: "86 Diamonds", diamondAmount: 86, pricePkrWholeRupees: 380 },
  { sku: "ml-dia-172", kind: "diamonds", displayName: "172 Diamonds", diamondAmount: 172, pricePkrWholeRupees: 760 },
  { sku: "ml-dia-257", kind: "diamonds", displayName: "257 Diamonds", diamondAmount: 257, pricePkrWholeRupees: 1_100 },
  { sku: "ml-dia-344", kind: "diamonds", displayName: "344 Diamonds", diamondAmount: 344, pricePkrWholeRupees: 1_520 },
  { sku: "ml-dia-514", kind: "diamonds", displayName: "514 Diamonds", diamondAmount: 514, pricePkrWholeRupees: 2_200, featured: true },
  { sku: "ml-dia-600", kind: "diamonds", displayName: "600 Diamonds", diamondAmount: 600, pricePkrWholeRupees: 2_570 },
  { sku: "ml-dia-706", kind: "diamonds", displayName: "706 Diamonds", diamondAmount: 706, pricePkrWholeRupees: 2_980 },
  { sku: "ml-dia-1050", kind: "diamonds", displayName: "1050 Diamonds", diamondAmount: 1_050, pricePkrWholeRupees: 4_500 },
  { sku: "ml-dia-1412", kind: "diamonds", displayName: "1412 Diamonds", diamondAmount: 1_412, pricePkrWholeRupees: 5_960 },
  { sku: "ml-dia-2195", kind: "diamonds", displayName: "2195 Diamonds", diamondAmount: 2_195, pricePkrWholeRupees: 9_020 },
  { sku: "ml-dia-3688", kind: "diamonds", displayName: "3688 Diamonds", diamondAmount: 3_688, pricePkrWholeRupees: 15_000 },
  { sku: "ml-dia-5532", kind: "diamonds", displayName: "5532 Diamonds", diamondAmount: 5_532, pricePkrWholeRupees: 22_700 },
  { sku: "ml-dia-9288", kind: "diamonds", displayName: "9288 Diamonds", diamondAmount: 9_288, pricePkrWholeRupees: 37_700 },
];

/** Combos — bundles of passes, some with diamonds attached. */
const COMBOS: CatalogueItem[] = [
  { sku: "ml-combo-3x-weekly", kind: "combo", displayName: "3x Weekly Pass", tagline: "Three weekly passes", pricePkrWholeRupees: 1_300 },
  { sku: "ml-combo-5x-weekly", kind: "combo", displayName: "5x Weekly Pass", tagline: "Five weekly passes", pricePkrWholeRupees: 2_200 },
  { sku: "ml-combo-10x-weekly", kind: "combo", displayName: "10x Weekly Pass", tagline: "Ten weekly passes", pricePkrWholeRupees: 4_300 },
  /*
   * Named for what the supplier actually delivers, not for the round number
   * the sheet used. No SmileOne pack carries exactly 150 or 50 diamonds — the
   * nearest are 165 and 55 — and the owner's own prices were set from those
   * two packs (1,150 PKR ≈ 8.00 + 11.99 BRL, and ≈ 16.00 + 4.00 BRL, both at
   * the ~60 PKR/BRL the rest of the catalogue uses). Advertising 150 while
   * delivering 165 is a promise that does not match the delivery, so the
   * owner chose to rename (2026-08-16).
   *
   * The SKUs deliberately keep their original names: the seed upserts on sku,
   * so changing one would create a second product and orphan any order that
   * referenced the first.
   */
  { sku: "ml-combo-1pass-150dia", kind: "combo", displayName: "1 Pass + 165 Diamonds", tagline: "One weekly pass with 165 diamonds", diamondAmount: 165, pricePkrWholeRupees: 1_150 },
  { sku: "ml-combo-2pass-50dia", kind: "combo", displayName: "2 Passes + 55 Diamonds", tagline: "Two weekly passes with 55 diamonds", diamondAmount: 55, pricePkrWholeRupees: 1_150 },
];

/**
 * Double Diamonds — pay for the first number, receive it twice over.
 * "55+55" is 55 diamonds from the supplier plus 55 the game grants.
 *
 * The supplier only ever delivers the first number. The bonus is Moonton's
 * first-recharge promotion, granted in-game on the first purchase of a given
 * pack tier — SmileOne has no part in it. That is why `diamondAmount` is the
 * only figure a fulfilment plan has to satisfy (see `expectedSupplierDiamonds`)
 * and why these four map to the supplier's four *flat* packs, the ones whose
 * `spu` carries no `&bonus` at all.
 *
 * NUMBERS RENAMED FROM THE SHEET (owner decision, 2026-08-16). The sheet said
 * 50/150/250/500; SmileOne's flat packs are 55/165/275/565. The owner's prices
 * were plainly set from those packs — 250 PKR ÷ ~60 PKR-per-BRL is 4.17, and
 * the 55 pack costs 4.00 — so the packs are right and the round numbers were
 * shorthand. Renamed to what is actually delivered, on the same reasoning as
 * the two combos above. Prices are untouched: they are the owner's to set.
 *
 * SKUs keep their original names on purpose; the seed upserts on sku.
 */
const DOUBLE_DIAMONDS: CatalogueItem[] = [
  { sku: "ml-dbl-50", kind: "double_diamonds", displayName: "55 + 55 Diamonds", diamondAmount: 55, bonusDiamonds: 55, pricePkrWholeRupees: 250 },
  { sku: "ml-dbl-150", kind: "double_diamonds", displayName: "165 + 165 Diamonds", diamondAmount: 165, bonusDiamonds: 165, pricePkrWholeRupees: 700 },
  { sku: "ml-dbl-250", kind: "double_diamonds", displayName: "275 + 275 Diamonds", diamondAmount: 275, bonusDiamonds: 275, pricePkrWholeRupees: 1_150, featured: true },
  { sku: "ml-dbl-500", kind: "double_diamonds", displayName: "565 + 565 Diamonds", diamondAmount: 565, bonusDiamonds: 565, pricePkrWholeRupees: 2_300 },
];

export const MOBILE_LEGENDS_CATALOGUE: CatalogueItem[] = [
  ...DIAMONDS,
  ...DOUBLE_DIAMONDS,
  ...PASSES,
  ...COMBOS,
];

/**
 * Section order on the storefront. Double Diamonds sits second because it is
 * the strongest offer on the page and should be seen before the longer
 * diamond ladder pushes it below the fold.
 */
export const KIND_ORDER = [
  "diamonds",
  "double_diamonds",
  "pass",
  "combo",
] as const satisfies readonly ProductKind[];

export const KIND_LABELS: Record<ProductKind, { title: string; blurb: string }> = {
  diamonds: {
    title: "Diamonds",
    blurb: "Standard top-ups, delivered to your account in minutes.",
  },
  double_diamonds: {
    title: "Double Diamonds",
    blurb: "Pay for the first amount, receive it twice over.",
  },
  pass: {
    title: "Passes",
    blurb: "Time-limited bundles that refresh your in-game rewards.",
  },
  combo: {
    title: "Combos",
    blurb: "Passes bundled together, some with diamonds attached.",
  },
};

/**
 * How each catalogue product is assembled out of SmileOne packs.
 *
 * The supplier sells 16 Brazil-region packs; the owner sells 26 products. The
 * difference is not missing stock — most of the gap is composition. "344
 * Diamonds" is two 172 packs, "600 Diamonds" is one 86 plus two 257s. So a
 * single order can require several `createorder` calls, and this module is the
 * one place that decides which.
 *
 * WHY THIS IS DATA AND NOT A CLEVER SOLVER
 *
 * A subset-sum solver would find these combinations automatically, and would
 * also silently find a *different* combination the day a supplier price or
 * pack list changes — quietly altering what a paying customer receives. The
 * mapping is money, so it is written down, reviewable as a diff, and checked
 * by `npm run catalogue:verify` rather than recomputed at runtime.
 *
 * ⛔ Nothing here calls SmileOne. Composing a plan is arithmetic; executing one
 *    spends the owner's diamonds and is blocked until PayFast is wired.
 *    See LIVE_ACCOUNT_SAFETY.md.
 */

import { MOBILE_LEGENDS_CATALOGUE, type CatalogueItem } from "./catalogue-source.ts";

/* ------------------------------------------------------------------ */
/* The supplier's side                                                 */
/* ------------------------------------------------------------------ */

/**
 * SmileOne's `spu` strings encode `paid&bonus`, not a total: "78&8 Diamond"
 * delivers 86. Every mapping below depends on reading them that way, which is
 * why the arithmetic is spelled out per pack instead of left implicit.
 *
 * Captured live from `productlist` on 2026-08-16 (`npm run smileone:probe`).
 * Never displayed to a customer — `spu` is supplier shorthand (Section 8).
 *
 * `npm run catalogue:drift` re-fetches `productlist` and diffs it against this
 * table, so the capture is no longer taken on trust. Run it before a deploy.
 * It fails on a pack that vanished or whose `spu` changed while a fulfilment
 * plan still depends on it — the second being the quiet one, since a re-spec'd
 * pack keeps delivering perfectly and delivers the wrong amount. Last verified
 * clean, all 16 packs unchanged, 2026-09-06.
 */
export type SupplierPack = {
  /** SmileOne's `id`, sent as `productid`. */
  productId: string;
  /** The raw supplier string, for admin matching only. */
  spu: string;
  /** Total diamonds the account receives. Null for passes. */
  diamonds: number | null;
  /** Our own short label, safe to show an operator. */
  label: string;
};

export const SUPPLIER_PACKS = {
  /* Diamond packs — `paid&bonus`, so `diamonds` is the sum. */
  "13": { productId: "13", spu: "mobilelegends BR 78&8 Diamond", diamonds: 86, label: "86 Diamonds" },
  "23": { productId: "23", spu: "mobilelegends BR 156&16 Diamond", diamonds: 172, label: "172 Diamonds" },
  "25": { productId: "25", spu: "mobilelegends BR 234&23 Diamond", diamonds: 257, label: "257 Diamonds" },
  "26": { productId: "26", spu: "mobilelegends BR 625&81 Diamond", diamonds: 706, label: "706 Diamonds" },
  "27": { productId: "27", spu: "mobilelegends BR 1860&335 Diamond", diamonds: 2_195, label: "2195 Diamonds" },
  "28": { productId: "28", spu: "mobilelegends BR 3099&589 Diamond", diamonds: 3_688, label: "3688 Diamonds" },
  "29": { productId: "29", spu: "mobilelegends BR 4649&883 Diamond", diamonds: 5_532, label: "5532 Diamonds" },
  "30": { productId: "30", spu: "mobilelegends BR 7740&1548 Diamond", diamonds: 9_288, label: "9288 Diamonds" },

  /* Flat packs — no `&`, so the number is the whole delivery. */
  "22590": { productId: "22590", spu: "mobilelegends BR 55 Diamond", diamonds: 55, label: "55 Diamonds" },
  "22591": { productId: "22591", spu: "mobilelegends BR 165 Diamond", diamonds: 165, label: "165 Diamonds" },
  "22592": { productId: "22592", spu: "mobilelegends BR 275 Diamond", diamonds: 275, label: "275 Diamonds" },
  "22593": { productId: "22593", spu: "mobilelegends BR 565 Diamond", diamonds: 565, label: "565 Diamonds" },

  /* Passes — time-based, no diamond count. */
  "26555": { productId: "26555", spu: "mobilelegends BR Weekly Elite Bundle", diamonds: null, label: "Weekly Elite Bundle" },
  "26556": { productId: "26556", spu: "mobilelegends BR Monthly Epic Bundle", diamonds: null, label: "Monthly Epic Bundle" },
  "33": { productId: "33", spu: "mobilelegends BR Passagem do crepúsculo", diamonds: null, label: "Twilight Pass" },
  "16642": { productId: "16642", spu: "Mobile Legends BR - Passe Semanal de Diamante", diamonds: null, label: "Weekly Diamond Pass" },
} as const satisfies Record<string, SupplierPack>;

export type SupplierProductId = keyof typeof SUPPLIER_PACKS;

/* ------------------------------------------------------------------ */
/* The mapping                                                         */
/* ------------------------------------------------------------------ */

export type FulfilmentPart = {
  supplierProductId: SupplierProductId;
  /** How many times to buy this pack. Always >= 1. */
  quantity: number;
};

/**
 * `null` means "not mapped yet" — deliberately distinct from an empty array.
 * A product with a null plan cannot be delivered, so it must not be sold, and
 * `assertFulfillable()` blocks it at order creation rather than discovering it
 * after the customer has paid.
 */
export type FulfilmentPlan = FulfilmentPart[] | null;

/**
 * Why a plan is still null. Surfaced by `npm run catalogue:verify` so an
 * unmapped product reads as an open question rather than an oversight.
 *
 * Empty as of 2026-08-16 — every catalogue product is mapped. Keep the
 * mechanism: the next product the owner adds arrives unmapped, and it must be
 * refused at checkout with a stated reason rather than silently sold.
 */
export const UNMAPPED_REASONS: Record<string, string> = {};

/**
 * Every catalogue SKU and the supplier packs that fulfil it.
 *
 * Compositions are chosen for the fewest supplier calls first, then lowest
 * supplier cost. Fewest calls matters more than it looks: each call is an
 * independent chance to half-deliver an order, and 344 as `172 × 2` (two
 * calls) costs exactly the same as `86 × 4` (four calls).
 */
export const FULFILMENT_PLANS: Record<string, FulfilmentPlan> = {
  /* ---- Diamonds: 8 map straight across, 5 are compositions ---- */

  "ml-dia-86": [{ supplierProductId: "13", quantity: 1 }],
  "ml-dia-172": [{ supplierProductId: "23", quantity: 1 }],
  "ml-dia-257": [{ supplierProductId: "25", quantity: 1 }],

  /** 172 × 2. Owner-specified. */
  "ml-dia-344": [{ supplierProductId: "23", quantity: 2 }],

  /** 257 × 2. Owner-specified. */
  "ml-dia-514": [{ supplierProductId: "25", quantity: 2 }],

  /** 86 + (257 × 2). Owner-specified: "one 86 package and one 514 package". */
  "ml-dia-600": [
    { supplierProductId: "13", quantity: 1 },
    { supplierProductId: "25", quantity: 2 },
  ],

  "ml-dia-706": [{ supplierProductId: "26", quantity: 1 }],

  /** 706 + (172 × 2) = 1050. The only exact combination; three calls. */
  "ml-dia-1050": [
    { supplierProductId: "26", quantity: 1 },
    { supplierProductId: "23", quantity: 2 },
  ],

  /** 706 × 2. */
  "ml-dia-1412": [{ supplierProductId: "26", quantity: 2 }],

  "ml-dia-2195": [{ supplierProductId: "27", quantity: 1 }],
  "ml-dia-3688": [{ supplierProductId: "28", quantity: 1 }],
  "ml-dia-5532": [{ supplierProductId: "29", quantity: 1 }],
  "ml-dia-9288": [{ supplierProductId: "30", quantity: 1 }],

  /*
   * ---- Double Diamonds ----
   *
   * The supplier's four flat packs, the only ones whose `spu` carries no
   * `&bonus`. That is the tell: these are the tiers the game's first-recharge
   * promotion doubles, so SmileOne delivers the single amount and Moonton
   * grants the match. One call each.
   *
   * Confirmed by the owner's own pricing, which was set from these packs at
   * the same ~60 PKR-per-BRL as the rest of the catalogue (250 PKR ≈ 4.00 BRL
   * for the 55 pack; 1,150 PKR ≈ 19.75 for the 275).
   */
  "ml-dbl-50": [{ supplierProductId: "22590", quantity: 1 }],
  "ml-dbl-150": [{ supplierProductId: "22591", quantity: 1 }],
  "ml-dbl-250": [{ supplierProductId: "22592", quantity: 1 }],
  "ml-dbl-500": [{ supplierProductId: "22593", quantity: 1 }],

  /* ---- Passes: one supplier pack each ---- */

  "ml-pass-weekly-elite": [{ supplierProductId: "26555", quantity: 1 }],
  "ml-pass-weekly": [{ supplierProductId: "16642", quantity: 1 }],
  "ml-pass-monthly-epic": [{ supplierProductId: "26556", quantity: 1 }],
  "ml-pass-twilight": [{ supplierProductId: "33", quantity: 1 }],

  /* ---- Combos: repeats of the weekly pass ---- */

  "ml-combo-3x-weekly": [{ supplierProductId: "16642", quantity: 3 }],
  "ml-combo-5x-weekly": [{ supplierProductId: "16642", quantity: 5 }],
  "ml-combo-10x-weekly": [{ supplierProductId: "16642", quantity: 10 }],

  /*
   * Pass plus diamonds. No pack delivers exactly 150 or 50, so these use the
   * nearest — 165 and 55 — and the catalogue was renamed to match rather than
   * advertising a number the supplier cannot deliver (owner, 2026-08-16). The
   * owner's 1,150 PKR price for both was itself set from these packs.
   */
  "ml-combo-1pass-150dia": [
    { supplierProductId: "16642", quantity: 1 },
    { supplierProductId: "22591", quantity: 1 },
  ],
  "ml-combo-2pass-50dia": [
    { supplierProductId: "16642", quantity: 2 },
    { supplierProductId: "22590", quantity: 1 },
  ],
};

/* ------------------------------------------------------------------ */
/* Derived helpers                                                     */
/* ------------------------------------------------------------------ */

/** Total supplier calls a plan needs. This is the partial-failure surface. */
export function planCallCount(plan: FulfilmentPart[]): number {
  return plan.reduce((total, part) => total + part.quantity, 0);
}

/** Total diamonds a plan delivers. Passes contribute nothing. */
export function planDiamondTotal(plan: FulfilmentPart[]): number {
  return plan.reduce((total, part) => {
    const diamonds = SUPPLIER_PACKS[part.supplierProductId].diamonds ?? 0;
    return total + diamonds * part.quantity;
  }, 0);
}

/** Passes a plan delivers, counted separately — they are not diamonds. */
export function planPassCount(plan: FulfilmentPart[]): number {
  return plan.reduce((total, part) => {
    const isPass = SUPPLIER_PACKS[part.supplierProductId].diamonds === null;
    return total + (isPass ? part.quantity : 0);
  }, 0);
}

/** Operator-facing summary, e.g. "1× 706 Diamonds + 2× 172 Diamonds". */
export function describePlan(plan: FulfilmentPart[]): string {
  return plan
    .map((part) => `${part.quantity}× ${SUPPLIER_PACKS[part.supplierProductId].label}`)
    .join(" + ");
}

/**
 * The diamonds a supplier is expected to deliver for a catalogue item.
 *
 * Double Diamonds are the exception and the reason this is a function rather
 * than a field read: the bonus half of "250 + 250" is granted by the game's
 * own first-recharge promotion, not by the supplier, so the supplier only ever
 * delivers the paid half. Treating `diamondAmount + bonusDiamonds` as the
 * target there would double every such order.
 */
export function expectedSupplierDiamonds(item: CatalogueItem): number {
  if (item.kind === "double_diamonds") return item.diamondAmount ?? 0;
  return (item.diamondAmount ?? 0) + (item.bonusDiamonds ?? 0);
}

/* ------------------------------------------------------------------ */
/* Call logic — which supplier calls an order still needs               */
/* ------------------------------------------------------------------ */

/** A `createorder` call that already succeeded, as recorded on the order. */
export type CompletedDelivery = { supplierProductId: string };

/**
 * Expands a plan into the individual supplier calls that have NOT yet been
 * made, in plan order.
 *
 * This is the idempotency rule for composed orders, and it matters more than
 * the single-pack case rule 3 already covers. "1050 Diamonds" is three calls;
 * if the first two land and the third times out, a naive retry re-runs all
 * three and the customer receives 1050 extra diamonds at the owner's expense.
 * Counting what actually landed and subtracting is what prevents that.
 *
 * Deliberately compares by pack, not by position: the supplier tells us which
 * product a call bought, not which line of our plan it was for, so two calls
 * for the same pack are interchangeable.
 */
export function remainingCalls(
  plan: FulfilmentPart[],
  deliveries: readonly CompletedDelivery[],
): SupplierProductId[] {
  const deliveredByPack = new Map<string, number>();
  for (const delivery of deliveries) {
    deliveredByPack.set(
      delivery.supplierProductId,
      (deliveredByPack.get(delivery.supplierProductId) ?? 0) + 1,
    );
  }

  const calls: SupplierProductId[] = [];
  for (const part of plan) {
    const alreadyDone = deliveredByPack.get(part.supplierProductId) ?? 0;
    /*
     * Clamped at zero. More deliveries than the plan calls for means something
     * has gone wrong — a double-run, or a plan edited under a live order — and
     * the safe response is to make no further calls, never a negative number
     * that a caller might misread as "one more".
     */
    const outstanding = Math.max(0, part.quantity - alreadyDone);
    for (let i = 0; i < outstanding; i += 1) calls.push(part.supplierProductId);
  }
  return calls;
}

/** True when every pack in the plan has been delivered. */
export function isFullyDelivered(
  plan: FulfilmentPart[],
  deliveries: readonly CompletedDelivery[],
): boolean {
  return remainingCalls(plan, deliveries).length === 0;
}

/**
 * Diamonds actually delivered so far — what the customer has right now, as
 * opposed to what they paid for. This is the number an operator needs when an
 * order half-fails and someone has to decide what to do about it.
 */
export function deliveredDiamonds(deliveries: readonly CompletedDelivery[]): number {
  return deliveries.reduce((total, delivery) => {
    const pack = SUPPLIER_PACKS[delivery.supplierProductId as SupplierProductId];
    return total + (pack?.diamonds ?? 0);
  }, 0);
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

export type PlanCheck = {
  sku: string;
  displayName: string;
  status: "ok" | "unmapped" | "mismatch" | "missing";
  expectedDiamonds: number;
  plannedDiamonds: number;
  calls: number;
  detail: string;
};

/**
 * Checks every catalogue product against its plan.
 *
 * This is the control that makes the hand-written mapping safe: a typo that
 * turns `quantity: 2` into `quantity: 1` silently halves a customer's delivery,
 * and no amount of care while editing catches that reliably. Arithmetic does.
 */
export function verifyFulfilmentPlans(): PlanCheck[] {
  return MOBILE_LEGENDS_CATALOGUE.map((item) => {
    const expectedDiamonds = expectedSupplierDiamonds(item);
    const plan = FULFILMENT_PLANS[item.sku];

    const base = {
      sku: item.sku,
      displayName: item.displayName,
      expectedDiamonds,
      plannedDiamonds: 0,
      calls: 0,
    };

    if (plan === undefined) {
      return {
        ...base,
        status: "missing" as const,
        detail: "No entry in FULFILMENT_PLANS. Every catalogue SKU needs one, even if null.",
      };
    }

    if (plan === null) {
      return {
        ...base,
        status: "unmapped" as const,
        detail: UNMAPPED_REASONS[item.sku] ?? "Unmapped, and no reason recorded.",
      };
    }

    const plannedDiamonds = planDiamondTotal(plan);
    const calls = planCallCount(plan);

    if (plannedDiamonds !== expectedDiamonds) {
      return {
        ...base,
        status: "mismatch" as const,
        plannedDiamonds,
        calls,
        detail: `${describePlan(plan)} delivers ${plannedDiamonds}, catalogue advertises ${expectedDiamonds}.`,
      };
    }

    return {
      ...base,
      status: "ok" as const,
      plannedDiamonds,
      calls,
      detail: describePlan(plan),
    };
  });
}

/** True when the product can actually be delivered. */
export function isFulfillable(sku: string): boolean {
  const plan = FULFILMENT_PLANS[sku];
  return Array.isArray(plan) && plan.length > 0;
}

export function planForSku(sku: string): FulfilmentPart[] | null {
  const plan = FULFILMENT_PLANS[sku];
  return Array.isArray(plan) && plan.length > 0 ? plan : null;
}

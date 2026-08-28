import "server-only";

import {
  deliveredDiamonds,
  isFullyDelivered,
  type SupplierProductId,
} from "@/lib/fulfilment-plan";
import { connectToDatabase, assertScalar } from "@/lib/models/db";
import { GameModel } from "@/lib/models/game";
import { OrderModel, generateOrderId } from "@/lib/models/order";
import { ProductModel } from "@/lib/models/product";
import { notifyOrderSaved } from "@/lib/services/email/notify";
import { verifyGameAccount } from "@/lib/services/smileone/verify-account";
import { normalisePkPhone } from "@/lib/utils/phone";

/**
 * Order creation.
 *
 * The single rule this file exists to enforce: **the price is read from our
 * own database, never accepted from the caller.** The client sends a SKU and
 * delivery details; what it costs is decided here (rule 1). There is
 * deliberately no price parameter to pass.
 *
 * The account is re-verified here too, for the same reason. /verify-account is
 * a separate public endpoint, so a caller can simply not call it — every check
 * that lives only there (the region block, and getrole's defence against a
 * mistyped Player ID) is skippable by posting straight to this one. Repeating
 * the lookup costs one read-only supplier call per order and makes those
 * checks unavoidable.
 */

export type CreateOrderInput = {
  sku: string;
  playerId: string;
  zoneId: string;
  /**
   * The username the customer saw and confirmed. Recorded on the order only
   * after the server has re-derived it — this value is used to notice a
   * disagreement, never to populate the order.
   */
  confirmedUsername: string;
  contactEmail: string;
  contactPhone: string;
};

export type CreatedOrder = {
  orderId: string;
  pricePkr: number;
  displayName: string;
};

export class ProductUnavailableError extends Error {
  constructor() {
    super("That package is no longer available.");
    this.name = "ProductUnavailableError";
  }
}

/**
 * Raised when a product has no fulfilment plan — it is on sale but nothing
 * knows which supplier packs deliver it.
 *
 * Separate from ProductUnavailableError because the two are opposite problems:
 * one is a product that went away, this is a product that is present and
 * cannot be delivered. Taking money for it and discovering that afterwards is
 * precisely the failure rule 8 exists to prevent, so it is refused here, at
 * the last moment before an order record exists.
 */
export class ProductNotFulfillableError extends Error {
  constructor(readonly sku: string) {
    super("That package can't be delivered yet. Please choose another.");
    this.name = "ProductNotFulfillableError";
  }
}

export async function createPendingOrder(
  input: CreateOrderInput,
): Promise<CreatedOrder> {
  await connectToDatabase();

  // assertScalar blocks NoSQL operator injection: a JSON body can carry
  // { sku: { $ne: null } }, which would otherwise match an arbitrary product
  // and let a caller pick the cheapest one (rule 6).
  const sku = assertScalar(input.sku, "sku");

  const product = await ProductModel.findOne({ sku, isActive: true })
    .select("_id game displayName pricePkr basePriceUsdCents fulfilmentPlan")
    .lean();

  if (!product) throw new ProductUnavailableError();

  const game = await GameModel.findById(product.game)
    .select("_id requiresZoneId smileOneProduct")
    .lean();
  if (!game) throw new ProductUnavailableError();

  /*
   * Refuse before an order exists, not after payment.
   *
   * Six catalogue products are still awaiting the owner's confirmation of how
   * they map onto supplier packs (see lib/fulfilment-plan.ts). Until that
   * lands they are undeliverable, and the only honest thing to do is decline
   * the sale rather than accept money against a delivery nobody can perform.
   */
  const fulfilmentPlan: { supplierProductId: string; quantity: number }[] =
    product.fulfilmentPlan ?? [];
  if (fulfilmentPlan.length === 0) {
    console.error("[orders] refused an order for an unmapped product", { sku });
    throw new ProductNotFulfillableError(String(sku));
  }

  /*
   * Re-verify the account. Ordered after the cheap database checks above so a
   * dead SKU is rejected without troubling the supplier, and before the order
   * row exists so a refusal leaves nothing behind to clean up.
   *
   * AccountNotFoundError, RegionNotServedError and SmileOneError all propagate
   * to the controller, which turns them into the same messages the lookup step
   * gives. The account being checked against the pack we will actually buy —
   * not the catalogue's nominal SKU — is what makes the per-product multiplier
   * in the region cost gate apply to the right thing.
   */
  const verification = await verifyGameAccount({
    smileOneProduct: game.smileOneProduct,
    smileOneProductId: fulfilmentPlan[0].supplierProductId,
    playerId: input.playerId,
    zoneId: input.zoneId,
  });

  /*
   * A disagreement here does not change where the diamonds go — that is fixed
   * by the Player ID, which is the same in both lookups — so it is not worth
   * refusing a sale over. It does mean the customer confirmed a name that is
   * no longer what the account is called, which is worth knowing about if one
   * of them later disputes what they bought.
   */
  if (verification.username !== input.confirmedUsername) {
    console.warn("[orders] confirmed username disagreed with re-verification", {
      sku,
      confirmed: input.confirmedUsername,
      verified: verification.username,
    });
  }

  const order = await OrderModel.create({
    orderId: generateOrderId(),
    product: product._id,
    game: product.game,
    playerId: input.playerId,
    zoneId: game.requiresZoneId ? input.zoneId : null,
    // The server's answer, not the caller's claim.
    confirmedUsername: verification.username,

    // Straight from the catalogue document read above. Nothing the caller
    // sent influences this number.
    pricePkr: product.pricePkr,
    pricing: {
      basePriceUsdCents: product.basePriceUsdCents ?? null,
      // Prices are owner-set retail PKR, so no conversion or markup is applied.
      // Recorded as the identity so the snapshot stays self-describing rather
      // than implying a rate was used and then lost.
      exchangeRate: 1,
      markupPercentage: 0,
      // Straight from the supplier's own answer a moment ago. It used to be
      // echoed by the client, which meant the number recorded against a real
      // order was whatever the caller felt like sending.
      supplierChangePrice: verification.supplierChangePrice,
    },

    /*
     * Frozen at order time, like `pricing` above and for the same reason: the
     * order must deliver what was agreed when the customer bought, not what
     * the catalogue says whenever fulfilment happens to run.
     */
    fulfilmentPlan: fulfilmentPlan.map((part) => ({
      supplierProductId: part.supplierProductId,
      quantity: part.quantity,
    })),
    fulfilmentDeliveries: [],

    status: "pending",
    statusHistory: [
      { from: "pending", to: "pending", note: "Order created at checkout", at: new Date() },
    ],

    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    contactPhoneNormalised: normalisePkPhone(input.contactPhone),
  });

  /*
   * Sent here, immediately, and never awaited.
   *
   * The order ID exists nowhere else the customer can reach: they are about to
   * be redirected to a payment page, and if they close the tab the tracking
   * form cannot help someone who does not have it. Waiting until payment
   * succeeds would withhold it from exactly the people most likely to need
   * support.
   *
   * A failing mailbox must not fail an order that has already been written, so
   * this cannot throw — see `fireAndForget` in the notify module.
   */
  notifyOrderSaved({
    orderId: order.orderId,
    displayName: product.displayName,
    pricePkr: order.pricePkr,
    playerId: order.playerId,
    zoneId: order.zoneId ?? null,
    confirmedUsername: order.confirmedUsername ?? null,
    contactEmail: order.contactEmail,
  });

  return {
    orderId: order.orderId,
    pricePkr: order.pricePkr,
    displayName: product.displayName,
  };
}

/**
 * Guest order lookup.
 *
 * Requires a matching contact detail as well as the order ID. The order ID
 * alone must never be enough to read an order — that is the IDOR guard, and it
 * is why this takes both. Order IDs are printed on a confirmation page,
 * forwarded over WhatsApp and left in browser history; a customer's delivery
 * target and contact details are not things any of those should hand over.
 *
 * Returns only what the customer needs to see. Nothing here exposes the
 * supplier, the packs an order is composed of, or our internal status names —
 * the controller maps the status to customer language before it goes further.
 */
export type GuestOrderView = {
  orderId: string;
  status: string;
  displayName: string;
  pricePkr: number;
  confirmedUsername: string | null;
  playerId: string;
  zoneId: string | null;
  createdAt: Date;
  /** Diamonds that have actually reached the account so far. */
  diamondsDelivered: number;
  /** True when some of the order has landed and some has not. */
  partiallyDelivered: boolean;
};

export async function findOrderForGuest(args: {
  orderId: string;
  contact: string;
}): Promise<GuestOrderView | null> {
  await connectToDatabase();

  const orderId = String(assertScalar(args.orderId, "orderId")).toUpperCase();
  const contact = String(assertScalar(args.contact, "contact")).trim();

  /*
   * Email or phone, and the phone is matched on the normalised form so
   * `0322 4810876` and `+923224810876` find the same order. Both branches are
   * built from the caller's own input and are only ever plain strings —
   * `assertScalar` above is what stops `{ $ne: null }` arriving here and
   * turning this into "any order with this ID", which would defeat the whole
   * guard (rule 6).
   */
  const matches: Record<string, string>[] = [{ contactEmail: contact.toLowerCase() }];

  const normalisedPhone = normalisePkPhone(contact);
  if (normalisedPhone) {
    matches.push({ contactPhoneNormalised: normalisedPhone });
    // Orders written before the normalised field existed still match on the
    // raw string, which is exact but better than nothing for that cohort.
    matches.push({ contactPhone: contact });
  }

  const order = await OrderModel.findOne({ orderId, $or: matches })
    .select(
      "orderId status pricePkr confirmedUsername playerId zoneId createdAt product " +
        "fulfilmentPlan fulfilmentDeliveries",
    )
    .lean();

  if (!order) return null;

  // Read the product separately rather than populating: `.populate<T>()` on a
  // lean query widens the result type to include an array form, which then
  // has to be narrowed back at every field access for no benefit here.
  const product = await ProductModel.findById(order.product)
    .select("displayName")
    .lean();

  const deliveries = order.fulfilmentDeliveries ?? [];
  const plan = (order.fulfilmentPlan ?? []).map((part: {
    supplierProductId: string;
    quantity: number;
  }) => ({
    supplierProductId: part.supplierProductId as SupplierProductId,
    quantity: part.quantity,
  }));

  return {
    orderId: order.orderId,
    status: order.status,
    displayName: product?.displayName ?? "Package",
    pricePkr: order.pricePkr,
    confirmedUsername: order.confirmedUsername ?? null,
    playerId: order.playerId,
    zoneId: order.zoneId ?? null,
    createdAt: order.createdAt,
    diamondsDelivered: deliveredDiamonds(deliveries),
    /*
     * Worth telling a customer about, because they can see it in the game
     * before we can explain it: a composed order that half-lands leaves them
     * looking at fewer diamonds than they paid for. Saying so plainly beats
     * letting them conclude they were cheated.
     */
    partiallyDelivered:
      deliveries.length > 0 && plan.length > 0 && !isFullyDelivered(plan, deliveries),
  };
}

import "server-only";

import { connectToDatabase, assertScalar } from "@/lib/models/db";
import { GameModel } from "@/lib/models/game";
import { OrderModel, generateOrderId } from "@/lib/models/order";
import { ProductModel } from "@/lib/models/product";

/**
 * Order creation.
 *
 * The single rule this file exists to enforce: **the price is read from our
 * own database, never accepted from the caller.** The client sends a SKU and
 * delivery details; what it costs is decided here (rule 1). There is
 * deliberately no price parameter to pass.
 */

export type CreateOrderInput = {
  sku: string;
  playerId: string;
  zoneId: string;
  /** The username getrole returned and the customer confirmed. */
  confirmedUsername: string;
  supplierChangePrice: string | null;
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

export async function createPendingOrder(
  input: CreateOrderInput,
): Promise<CreatedOrder> {
  await connectToDatabase();

  // assertScalar blocks NoSQL operator injection: a JSON body can carry
  // { sku: { $ne: null } }, which would otherwise match an arbitrary product
  // and let a caller pick the cheapest one (rule 6).
  const sku = assertScalar(input.sku, "sku");

  const product = await ProductModel.findOne({ sku, isActive: true })
    .select("_id game displayName pricePkr basePriceUsdCents")
    .lean();

  if (!product) throw new ProductUnavailableError();

  const game = await GameModel.findById(product.game).select("_id requiresZoneId").lean();
  if (!game) throw new ProductUnavailableError();

  const order = await OrderModel.create({
    orderId: generateOrderId(),
    product: product._id,
    game: product.game,
    playerId: input.playerId,
    zoneId: game.requiresZoneId ? input.zoneId : null,
    confirmedUsername: input.confirmedUsername,

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
      supplierChangePrice: input.supplierChangePrice,
    },

    status: "pending",
    statusHistory: [
      { from: "pending", to: "pending", note: "Order created at checkout", at: new Date() },
    ],

    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
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
 * is why this takes both.
 */
export async function findOrderForGuest(args: {
  orderId: string;
  contact: string;
}): Promise<{
  orderId: string;
  status: string;
  displayName: string;
  pricePkr: number;
  confirmedUsername: string | null;
  createdAt: Date;
} | null> {
  await connectToDatabase();

  const orderId = String(assertScalar(args.orderId, "orderId")).toUpperCase();
  const contact = String(assertScalar(args.contact, "contact")).trim();

  const order = await OrderModel.findOne({
    orderId,
    $or: [{ contactEmail: contact.toLowerCase() }, { contactPhone: contact }],
  })
    .select("orderId status pricePkr confirmedUsername createdAt product")
    .lean();

  if (!order) return null;

  // Read the product separately rather than populating: `.populate<T>()` on a
  // lean query widens the result type to include an array form, which then
  // has to be narrowed back at every field access for no benefit here.
  const product = await ProductModel.findById(order.product)
    .select("displayName")
    .lean();

  return {
    orderId: order.orderId,
    status: order.status,
    displayName: product?.displayName ?? "Package",
    pricePkr: order.pricePkr,
    confirmedUsername: order.confirmedUsername ?? null,
    createdAt: order.createdAt,
  };
}

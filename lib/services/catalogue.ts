import "server-only";

import { connectToDatabase, assertScalar } from "@/lib/models/db";
import { GameModel } from "@/lib/models/game";
import { ProductModel, type ProductKind } from "@/lib/models/product";
import { KIND_ORDER } from "@/lib/catalogue-source";

/**
 * Storefront reads.
 *
 * Everything a customer sees comes from our own database, never from a
 * supplier call on the render path (Section 13). The returned shape is
 * narrowed to exactly the fields the UI uses — no Mongoose documents and no
 * raw supplier fields cross into a component (rule 7).
 */

export type StorefrontProduct = {
  id: string;
  sku: string;
  kind: ProductKind;
  displayName: string;
  tagline: string | null;
  diamondAmount: number | null;
  bonusDiamonds: number | null;
  /** Integer paisa. Read from the database, never computed client-side. */
  pricePkr: number;
  featured: boolean;
};

export type StorefrontSection = {
  kind: ProductKind;
  products: StorefrontProduct[];
};

export type CheckoutProduct = StorefrontProduct & {
  gameName: string;
  gameSlug: string;
  requiresZoneId: boolean;
};

/**
 * One product by SKU, with the game context checkout needs.
 *
 * The returned `pricePkr` is what the page displays. It is not what the
 * customer is charged — order creation re-reads the price server-side (rule 1),
 * so a catalogue edit between render and submit cannot be exploited.
 */
export async function getCheckoutProduct(
  sku: string,
): Promise<CheckoutProduct | null> {
  await connectToDatabase();

  const product = await ProductModel.findOne({
    sku: String(assertScalar(sku, "sku")),
    isActive: true,
  })
    .select("sku kind displayName tagline diamondAmount bonusDiamonds pricePkr featured game")
    .lean();

  if (!product) return null;

  const game = await GameModel.findById(product.game)
    .select("name slug requiresZoneId isActive")
    .lean();

  if (!game || !game.isActive) return null;

  return {
    id: String(product._id),
    sku: product.sku,
    kind: product.kind as ProductKind,
    displayName: product.displayName,
    tagline: product.tagline ?? null,
    diamondAmount: product.diamondAmount ?? null,
    bonusDiamonds: product.bonusDiamonds ?? null,
    pricePkr: product.pricePkr,
    featured: Boolean(product.featured),
    gameName: game.name,
    gameSlug: game.slug,
    requiresZoneId: Boolean(game.requiresZoneId),
  };
}

/**
 * Active products for one game, grouped into display sections.
 *
 * Sections come back in KIND_ORDER and empty ones are dropped, so removing
 * every pass from the catalogue removes the Passes heading too rather than
 * leaving a titled void.
 */
export async function getStorefront(
  gameSlug: string,
): Promise<{ gameName: string; sections: StorefrontSection[] } | null> {
  await connectToDatabase();

  // gameSlug is a route/config value rather than user input today, but this is
  // the query-filter boundary, so it is treated as untrusted on principle.
  const game = await GameModel.findOne({ slug: String(gameSlug), isActive: true })
    .select("_id name")
    .lean();

  if (!game) return null;

  const rows = await ProductModel.find({ game: game._id, isActive: true })
    .sort({ sortOrder: 1 })
    .select("sku kind displayName tagline diamondAmount bonusDiamonds pricePkr featured")
    .lean();

  const products: StorefrontProduct[] = rows.map((r) => ({
    id: String(r._id),
    sku: r.sku,
    kind: r.kind as ProductKind,
    displayName: r.displayName,
    tagline: r.tagline ?? null,
    diamondAmount: r.diamondAmount ?? null,
    bonusDiamonds: r.bonusDiamonds ?? null,
    pricePkr: r.pricePkr,
    featured: Boolean(r.featured),
  }));

  const sections = KIND_ORDER.map((kind) => ({
    kind,
    products: products.filter((p) => p.kind === kind),
  })).filter((section) => section.products.length > 0);

  return { gameName: game.name, sections };
}

import "server-only";

import { Schema, type InferSchemaType, type Types } from "mongoose";

import { defineModel, integerMoneyField } from "./define-model.ts";

/**
 * The four things a customer can buy. They are genuinely different products,
 * not one product with a flag: a pass has no diamond count, a combo bundles
 * several items, and a double-diamond offer's headline number is the bonus.
 * The card UI renders a different figure per kind.
 */
export const PRODUCT_KINDS = [
  "diamonds",
  "pass",
  "combo",
  "double_diamonds",
] as const;

export type ProductKind = (typeof PRODUCT_KINDS)[number];

/**
 * A purchasable item in the storefront.
 *
 * The catalogue lives in our database rather than being fetched per page view
 * (Section 13): a storefront render must never depend on a supplier round
 * trip.
 *
 * PRICING. `pricePkr` is the authoritative retail price in integer paisa, set
 * by the owner, and is **not** computed from a base price, exchange rate, or
 * markup — the owner's published prices already include their margin. The
 * exchange-rate/markup path in AppConfig remains for any future product that
 * is priced off a live supplier rate; nothing in the current catalogue uses
 * it. Non-negotiable rule 1 is unaffected: the price still comes from our own
 * database server-side and is never accepted from the client.
 *
 * `basePriceUsdCents` and `supplierRawPrice` are therefore optional supplier
 * reference data, recorded when a product is matched to a SmileOne SKU so
 * margin stays auditable — never inputs to what the customer is charged.
 */
const productSchema = new Schema(
  {
    /**
     * Stable owner-facing code, e.g. "ml-dia-86". This is the catalogue's
     * natural key: the seed upserts on it, so re-running after an owner
     * renames a product updates that product instead of creating a second
     * one. Also the future URL segment.
     */
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9-]+$/, "sku must be lowercase alphanumeric with hyphens"],
    },

    kind: {
      type: String,
      enum: PRODUCT_KINDS,
      required: true,
      default: "diamonds",
    },

    /**
     * SmileOne's own product identifier.
     *
     * Optional and sparse-unique: the owner's catalogue is authored ahead of
     * the supplier mapping, and passes and combos may never correspond to a
     * single SmileOne SKU. A non-sparse unique index would reject the second
     * product without one.
     */
    smileOneProductId: {
      type: String,
      default: null,
      trim: true,
    },

    game: {
      type: Schema.Types.ObjectId,
      ref: "Game",
      required: true,
    },

    /**
     * Admin-curated customer-facing name.
     *
     * SmileOne's `spu` strings are inconsistent and abbreviated
     * ("mobilelegends BR 78 &8 Diamond") and must never be displayed verbatim.
     */
    displayName: { type: String, required: true, trim: true },

    /** The raw supplier `spu`. Retained for admin matching; never rendered. */
    spu: { type: String, default: null, trim: true },

    /**
     * Short line under the title, e.g. a combo's composition. Carries detail
     * the title cannot without becoming a sentence.
     */
    tagline: { type: String, default: null, trim: true, maxlength: 120 },

    /**
     * Diamonds the customer pays for. Null for passes, which are time-based
     * and have no diamond count at all.
     */
    diamondAmount: {
      type: Number,
      default: null,
      min: 1,
      validate: {
        validator: (v: number | null) => v === null || Number.isInteger(v),
        message: "diamondAmount must be a whole number of diamonds",
      },
    },

    /**
     * Extra diamonds granted on top of `diamondAmount`, for double-diamond
     * offers: "50+50" is 50 paid plus 50 free, delivering 100. Kept separate
     * rather than folded into the total because the bonus IS the offer, and
     * the card has to be able to say so.
     */
    bonusDiamonds: {
      type: Number,
      default: null,
      min: 1,
      validate: {
        validator: (v: number | null) => v === null || Number.isInteger(v),
        message: "bonusDiamonds must be a whole number of diamonds",
      },
    },

    /**
     * Retail price in integer paisa. Owner-set and authoritative — see the
     * pricing note above. This is the number the customer pays.
     */
    pricePkr: integerMoneyField("paisa"),

    /**
     * Supplier reference only. Never an input to `pricePkr`.
     *
     * Not built from `integerMoneyField` because that helper is `required`
     * with an unconditional integer validator, and Mongoose runs custom
     * validators on an explicit `null` — the spread would reject every
     * owner-authored product that has no supplier mapping yet.
     */
    basePriceUsdCents: {
      type: Number,
      default: null,
      min: 0,
      validate: {
        validator: (v: number | null) => v === null || Number.isInteger(v),
        message: "basePriceUsdCents must be an integer (US cents)",
      },
    },

    /**
     * The supplier price exactly as received, before any parsing. The brief
     * flags that SmileOne prices only *appear* to be USD; keeping the original
     * string means that assumption can be re-checked against real data
     * instead of being lost at parse time.
     */
    supplierRawPrice: { type: String, default: null, trim: true },

    /**
     * Withheld from the storefront when false. The sync marks products absent
     * from a fresh supplier response inactive rather than deleting them —
     * orders reference products, and history must stay readable.
     */
    isActive: { type: Boolean, required: true, default: false },

    /**
     * Marks one card per section as the recommended tier. Decorative
     * emphasis only — it never changes the price or what is delivered.
     */
    featured: { type: Boolean, required: true, default: false },

    /** Ascending display order across the whole catalogue. */
    sortOrder: { type: Number, required: true, default: 0 },

    /**
     * When the supplier sync last confirmed this entry. Null for
     * owner-authored products that no sync has touched — defaulting to "now"
     * would claim a supplier confirmation that never happened.
     */
    lastSyncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Storefront listing: active items for one game, grouped by kind, in order.
productSchema.index({ game: 1, isActive: 1, kind: 1, sortOrder: 1 });

/*
 * Unique only across products that actually have a supplier mapping.
 *
 * `sparse: true` is NOT sufficient here: a sparse index skips documents where
 * the field is *missing*, but this field defaults to an explicit `null`, so
 * every unmapped product would still be indexed and the second one would
 * collide on `null`. A partial index keyed on the value being a string is the
 * construct that actually expresses "unique among the ones that have it".
 */
productSchema.index(
  { smileOneProductId: 1 },
  {
    unique: true,
    partialFilterExpression: { smileOneProductId: { $type: "string" } },
  },
);

// Admin review: what did the last sync fail to touch?
productSchema.index({ lastSyncedAt: -1 });

export type Product = InferSchemaType<typeof productSchema> & {
  _id: Types.ObjectId;
};

export const ProductModel = defineModel("Product", productSchema);

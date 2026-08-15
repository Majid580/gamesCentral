import "server-only";

import { Schema, type InferSchemaType, type Types } from "mongoose";

import { defineModel, integerMoneyField } from "./define-model.ts";

/**
 * A purchasable diamond package, synced from SmileOne's `productlist` and
 * curated by an admin.
 *
 * The catalogue lives in our database rather than being fetched per page view
 * (Section 13): a storefront render must never depend on a supplier round
 * trip. A scheduled sync refreshes it.
 *
 * Note on `basePriceUsdCents`. The brief names this field `basePriceUsd`, but
 * storing a supplier price as a float would break non-negotiable rule 5 the
 * moment it is multiplied by the exchange rate and the markup. It is therefore
 * stored as integer cents, and the untouched supplier string is kept beside it
 * in `supplierRawPrice` so a reconciliation can always recover exactly what
 * SmileOne sent.
 */
const productSchema = new Schema(
  {
    /** SmileOne's own product identifier. Unique — a repeated sync upserts. */
    smileOneProductId: {
      type: String,
      required: true,
      unique: true,
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
    spu: { type: String, required: true, trim: true },

    /** Diamonds delivered, used for sorting and for the package label. */
    diamondAmount: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "diamondAmount must be a whole number of diamonds",
      },
    },

    /** Supplier price in integer US cents. See the note above. */
    basePriceUsdCents: integerMoneyField("US cents"),

    /**
     * The supplier price exactly as received, before any parsing. The brief
     * flags that SmileOne prices only *appear* to be USD; keeping the original
     * string means that assumption can be re-checked against real data
     * instead of being lost at parse time.
     */
    supplierRawPrice: { type: String, required: true, trim: true },

    /**
     * Withheld from the storefront when false. The sync marks products absent
     * from a fresh supplier response inactive rather than deleting them —
     * orders reference products, and history must stay readable.
     */
    isActive: { type: Boolean, required: true, default: false },

    /** Ascending display order within a game; falls back to diamondAmount. */
    sortOrder: { type: Number, required: true, default: 0 },

    /** When the supplier sync last confirmed this entry. */
    lastSyncedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

// Storefront listing: active packages for one game, cheapest first.
productSchema.index({ game: 1, isActive: 1, sortOrder: 1, diamondAmount: 1 });

// Admin review: what did the last sync fail to touch?
productSchema.index({ lastSyncedAt: -1 });

export type Product = InferSchemaType<typeof productSchema> & {
  _id: Types.ObjectId;
};

export const ProductModel = defineModel("Product", productSchema);

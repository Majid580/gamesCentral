import "server-only";

import { Schema, type InferSchemaType, type Types } from "mongoose";

import { defineModel } from "./define-model.ts";

/**
 * A game we sell top-ups for.
 *
 * Only Mobile Legends ships at launch, but games are first-class in the schema
 * from day one — the UI filters to a game rather than the data model assuming
 * a single title. Adding a second game must never require a migration.
 *
 * This collection also owns the per-game knowledge the SmileOne integration
 * needs and that has nowhere else to live: the exact `product` string their
 * API expects, and whether the game identifies an account by Player ID alone
 * or by Player ID + Zone ID.
 */
const gameSchema = new Schema(
  {
    /** URL segment and stable internal key, e.g. "mobile-legends". */
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"],
    },

    /** Customer-facing title, e.g. "Mobile Legends: Bang Bang". */
    name: { type: String, required: true, trim: true },

    /**
     * The literal value SmileOne's API expects for its `product` parameter
     * (e.g. "mobilelegends"). Supplier-facing and never shown to a customer.
     */
    smileOneProduct: { type: String, required: true, trim: true },

    /**
     * Whether checkout must collect a Zone ID alongside the Player ID.
     * Mobile Legends does; not every title will.
     */
    requiresZoneId: { type: Boolean, required: true, default: true },

    /** Hides the game from the storefront without deleting its products. */
    isActive: { type: Boolean, required: true, default: true },

    /** Ascending display order on the storefront. */
    sortOrder: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

// Storefront listing: active games in display order.
gameSchema.index({ isActive: 1, sortOrder: 1 });

export type Game = InferSchemaType<typeof gameSchema> & { _id: Types.ObjectId };

export const GameModel = defineModel("Game", gameSchema);

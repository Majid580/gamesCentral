import "server-only";

import { Schema, type InferSchemaType, type Types } from "mongoose";

import { defineModel } from "./define-model.ts";

/**
 * Runtime-editable pricing configuration — a singleton document.
 *
 * The exchange rate and markup are never hardcoded and never live in frontend
 * code (Section 10). Environment variables supply the boot defaults; this
 * document lets an admin change them without a redeploy, which matters because
 * the USD->PKR rate moves.
 *
 * Singleton enforcement is a fixed `key` with a unique index rather than a
 * convention. "Only ever one document" enforced by discipline eventually
 * becomes two documents and a pricing bug.
 */
const SINGLETON_KEY = "global";

const appConfigSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: SINGLETON_KEY,
      enum: [SINGLETON_KEY],
    },

    /** Percentage added on top of the converted base price. 20 = +20%. */
    markupPercentage: { type: Number, required: true, min: 0, max: 500 },

    /** PKR per 1 USD. */
    exchangeRate: { type: Number, required: true, min: 0 },

    /**
     * Blocks new orders while leaving the site readable. Lets an admin stop
     * taking money the moment SmileOne or PayFast is misbehaving, instead of
     * accumulating orders that cannot be fulfilled.
     */
    ordersPaused: { type: Boolean, required: true, default: false },

    /** Shown to customers when `ordersPaused` is true. */
    pausedMessage: { type: String, trim: true, maxlength: 300, default: null },

    /** Audit trail for who last changed the pricing inputs. */
    updatedBy: { type: String, trim: true, default: null },
  },
  { timestamps: true },
);

export const APP_CONFIG_SINGLETON_KEY = SINGLETON_KEY;

export type AppConfig = InferSchemaType<typeof appConfigSchema> & {
  _id: Types.ObjectId;
};

export const AppConfigModel = defineModel("AppConfig", appConfigSchema);

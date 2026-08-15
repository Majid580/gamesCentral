import "server-only";

import { randomInt } from "node:crypto";

import { Schema, type InferSchemaType, type Types } from "mongoose";

import { defineModel, integerMoneyField } from "./define-model.ts";

/* ------------------------------------------------------------------ */
/* Status machine                                                      */
/* ------------------------------------------------------------------ */

export const ORDER_STATUSES = [
  "pending",
  "awaiting_payment",
  "paid",
  "fulfilling",
  "fulfilled",
  "paid_pending_fulfillment",
  "failed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The only legal transitions. The service layer enforces this; it lives here
 * so the permitted values and the permitted moves between them cannot drift
 * apart in separate files.
 *
 * The critical property is what is missing: **once an order reaches `paid`,
 * `failed` is unreachable.** After money has changed hands the only sink for a
 * problem is `paid_pending_fulfillment`, which surfaces in the admin dashboard
 * for manual recovery. That is non-negotiable rule 8 — a payment must never be
 * silently lost — expressed as a graph rather than as a code review comment.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  {
    // Created, customer has not been sent to the payment gateway yet.
    pending: ["awaiting_payment", "failed"],
    // Handed off to PayFast; no money confirmed.
    awaiting_payment: ["paid", "failed"],
    // Payment independently verified server-to-server. No route to `failed`.
    paid: ["fulfilling"],
    // `createorder` in flight. Guarded by an atomic conditional update so two
    // concurrent requests can never both deliver (rule 3).
    fulfilling: ["fulfilled", "paid_pending_fulfillment"],
    // Terminal, success.
    fulfilled: [],
    // Paid but undelivered. Admin retries or delivers manually.
    paid_pending_fulfillment: ["fulfilling", "fulfilled"],
    // Terminal, failed before any money was taken.
    failed: [],
  };

/** Whether a status change is permitted. Same status is not a transition. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Statuses where the customer has paid but has not received diamonds. */
export const OWED_FULFILMENT_STATUSES: readonly OrderStatus[] = [
  "paid",
  "fulfilling",
  "paid_pending_fulfillment",
];

/* ------------------------------------------------------------------ */
/* Order ID                                                            */
/* ------------------------------------------------------------------ */

/**
 * Crockford-style alphabet with 0/O/1/I/L removed — order IDs get read aloud
 * over WhatsApp and typed back into the order-status form by hand.
 */
const ORDER_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Generates a public order reference, e.g. "GC-7K2PM-QX9RT".
 *
 * Random rather than sequential: guest order lookup takes an order ID, so a
 * predictable counter would let anyone walk the whole order book. `randomInt`
 * is drawn from the CSPRNG and is free of the modulo bias a naive
 * `randomBytes[i] % 31` would introduce.
 */
export function generateOrderId(): string {
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out += ORDER_ID_ALPHABET[randomInt(ORDER_ID_ALPHABET.length)];
  }
  return `GC-${out.slice(0, 5)}-${out.slice(5)}`;
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const statusHistorySchema = new Schema(
  {
    from: { type: String, enum: ORDER_STATUSES, required: true },
    to: { type: String, enum: ORDER_STATUSES, required: true },
    /** Why. Operator-facing; never contains a raw upstream payload. */
    note: { type: String, trim: true, maxlength: 500 },
    at: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      default: generateOrderId,
    },

    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    game: { type: Schema.Types.ObjectId, ref: "Game", required: true },

    /* ---- delivery target ---- */

    /** In-game account identifier the diamonds are sent to. */
    playerId: { type: String, required: true, trim: true },

    /** Absent for games where `Game.requiresZoneId` is false. */
    zoneId: { type: String, trim: true },

    /**
     * The in-game username `getrole` returned and the customer confirmed.
     *
     * This is the safety net against a mistyped Player ID delivering to a
     * stranger, so it is recorded on the order as evidence of what the
     * customer agreed to buy — not merely displayed once during checkout.
     */
    confirmedUsername: { type: String, trim: true },

    /* ---- money ---- */

    /** Amount charged, in integer paisa. Recomputed server-side, never sent by the client. */
    pricePkr: integerMoneyField("paisa"),

    /**
     * The inputs that produced `pricePkr`, frozen at purchase time.
     *
     * The exchange rate and markup are configurable and will change. Without
     * a snapshot, an order's total becomes unreproducible the first time
     * either is edited, and a customer dispute months later cannot be settled.
     */
    pricing: {
      /**
       * Nullable: under the owner-set pricing model most products have no
       * supplier base price at all, and requiring one here made every order
       * fail validation. When a product is later mapped to a SmileOne SKU this
       * captures what the supplier charged, so margin stays auditable.
       */
      basePriceUsdCents: {
        type: Number,
        default: null,
        min: 0,
        validate: {
          validator: (v: number | null) => v === null || Number.isInteger(v),
          message: "pricing.basePriceUsdCents must be an integer (US cents)",
        },
      },
      /** 1 and 0 for owner-priced products: recorded so the snapshot states
       *  plainly that no conversion or markup was applied, rather than leaving
       *  it ambiguous whether a rate was used and then lost. */
      exchangeRate: { type: Number, required: true, min: 0 },
      markupPercentage: { type: Number, required: true, min: 0 },
      /**
       * `getrole`'s `change_price` when it was present and overrode the cached
       * catalogue price, otherwise null. A mismatch is recorded, never
       * silently resolved.
       */
      supplierChangePrice: { type: String, default: null },
    },

    /* ---- state ---- */

    // No standalone index here: the { status, createdAt } compound below
    // already serves status-only queries via its prefix, and a second index
    // on the same field would be maintained on every write for nothing.
    status: {
      type: String,
      enum: ORDER_STATUSES,
      required: true,
      default: "pending",
    },

    statusHistory: { type: [statusHistorySchema], default: [] },

    /* ---- external references ---- */

    /** PayFast's transaction/basket reference. Set when checkout begins. */
    paymentReference: { type: String, trim: true, default: null },

    /** SmileOne's order id from `createorder`. Proof of delivery. */
    smileOneOrderId: { type: String, trim: true, default: null },

    /* ---- contact (guest checkout: no accounts in v1) ---- */

    contactEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    contactPhone: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

/* ---- indexes ---- */

// Admin dashboard: most recent orders, and the paid-but-undelivered queue.
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });

// Payment callbacks arrive keyed by the gateway's reference, not ours.
// Sparse: null until checkout starts, and nulls must not collide.
orderSchema.index({ paymentReference: 1 }, { sparse: true });

// Guest order lookup is by order ID plus a contact detail.
orderSchema.index({ contactEmail: 1, createdAt: -1 });

export type Order = InferSchemaType<typeof orderSchema> & {
  _id: Types.ObjectId;
};

export const OrderModel = defineModel("Order", orderSchema);

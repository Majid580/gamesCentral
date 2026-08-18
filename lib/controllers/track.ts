import "server-only";

import { z } from "zod";

import { findOrderForGuest } from "@/lib/services/orders";
import { checkRateLimit, orderLookupRules } from "@/lib/services/rate-limit";

/**
 * Guest order tracking.
 *
 * Two jobs, and the second is the interesting one:
 *
 *   1. Look the order up behind the IDOR guard — order ID *and* a matching
 *      contact detail, never the ID alone.
 *   2. Translate our internal status into something a customer should be told.
 *      `paid_pending_fulfillment` is a precise and useful name for an operator
 *      and a frightening piece of jargon for the person who paid. Mapping it
 *      here rather than in the component also keeps our state machine out of
 *      the browser, where it is a map of the system for anyone probing it.
 */

export const lookupOrderSchema = z.object({
  /*
   * Bounded and shaped, but not strictly matched against the generator's
   * format. A customer who drops the hyphens or types lowercase should get
   * their order, not a validation error — the `GC-` form is normalised below.
   */
  orderId: z
    .string()
    .trim()
    .min(4, "Enter the order ID from your confirmation.")
    .max(32, "That doesn't look like an order ID."),
  contact: z
    .string()
    .trim()
    .min(3, "Enter the email or phone number you used at checkout.")
    .max(160),
});

/** The only status vocabulary the browser ever sees. */
export type CustomerStatus =
  | "not_paid"
  | "paid"
  | "delivering"
  | "delivered"
  | "attention"
  | "cancelled";

export type TrackedOrder = {
  orderId: string;
  status: CustomerStatus;
  headline: string;
  detail: string;
  displayName: string;
  pricePkr: number;
  playerId: string;
  zoneId: string | null;
  confirmedUsername: string | null;
  placedAt: string;
  diamondsDelivered: number;
  partiallyDelivered: boolean;
};

export type TrackResult =
  | { ok: true; data: TrackedOrder }
  | { ok: false; status: number; error: string; retryAfterSeconds?: number };

/**
 * What each internal status means to the person who paid.
 *
 * Two rules run through all of it. Never claim money moved when it did not,
 * and never leave someone who has paid without a next step — the two states
 * where something has gone wrong both end in an instruction, not an apology.
 */
const CUSTOMER_VIEW: Record<
  string,
  { status: CustomerStatus; headline: string; detail: string }
> = {
  pending: {
    status: "not_paid",
    headline: "Not paid yet",
    detail:
      "This order is saved but payment hasn't been completed, so nothing has been sent and nothing has been charged.",
  },
  awaiting_payment: {
    status: "not_paid",
    headline: "Waiting for payment",
    detail:
      "You were sent to the payment page but we haven't had confirmation back yet. If you did pay, this usually updates within a few minutes.",
  },
  paid: {
    status: "paid",
    headline: "Payment confirmed",
    detail: "Your payment has been verified and your diamonds are being sent now.",
  },
  fulfilling: {
    status: "delivering",
    headline: "Sending your diamonds",
    detail: "Delivery is in progress. This normally takes a minute or two.",
  },
  fulfilled: {
    status: "delivered",
    headline: "Delivered",
    detail: "Everything in this order has been sent to your account. Enjoy!",
  },
  paid_pending_fulfillment: {
    status: "attention",
    headline: "Paid — delivery needs a hand",
    detail:
      "Your payment went through, but the automatic delivery didn't complete. This order is in our queue and a person is finishing it. Nothing is lost, and you have not been charged twice.",
  },
  failed: {
    status: "cancelled",
    headline: "Not completed",
    detail:
      "This order was not completed and no payment was taken. You're welcome to place a new one.",
  },
};

const UNKNOWN_VIEW = {
  status: "attention" as const,
  headline: "Needs checking",
  detail: "Please contact us with your order ID and we'll look into it right away.",
};

/**
 * Normalises what people actually type: `gc7k2pmqx9rt`, `GC-7K2PM-QX9RT`,
 * or the same with stray spaces. Anything non-alphanumeric is dropped and the
 * canonical hyphens are put back, so a customer reading the ID off a phone
 * screen does not have to reproduce the punctuation exactly.
 */
function normaliseOrderId(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = cleaned.startsWith("GC") ? cleaned.slice(2) : cleaned;
  if (body.length !== 10) return cleaned;
  return `GC-${body.slice(0, 5)}-${body.slice(5)}`;
}

export async function lookupOrder(
  body: unknown,
  context: { ip: string },
): Promise<TrackResult> {
  const parsed = lookupOrderSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues[0]?.message ?? "Check the details and try again.",
    };
  }

  const orderId = normaliseOrderId(parsed.data.orderId);

  /*
   * Limited before the query, on two axes. The per-IP rule stops someone
   * working through a contact list; the per-order rule stops them working
   * through contact details for one order ID they already have, which is the
   * only realistic way past the second factor.
   */
  const limit = await checkRateLimit(orderLookupRules(context.ip, orderId));
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: "Too many lookups. Please wait a moment and try again.",
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  const order = await findOrderForGuest({ orderId, contact: parsed.data.contact });

  if (!order) {
    /*
     * One message for "no such order" and for "wrong contact detail", on
     * purpose. Distinguishing them would confirm that a given order ID exists,
     * turning the ID alone into an oracle — which is most of what the second
     * factor is here to prevent.
     */
    return {
      ok: false,
      status: 404,
      error:
        "We couldn't find an order with those details. Check the order ID and use the same email or phone number you gave at checkout.",
    };
  }

  const view = CUSTOMER_VIEW[order.status] ?? UNKNOWN_VIEW;

  if (!CUSTOMER_VIEW[order.status]) {
    // A status with no customer wording is a bug in this file, not a customer
    // problem — they still get a sensible page, and we get told about it.
    console.error("[track] no customer wording for status", { status: order.status });
  }

  return {
    ok: true,
    data: {
      orderId: order.orderId,
      status: view.status,
      headline: view.headline,
      detail: view.detail,
      displayName: order.displayName,
      pricePkr: order.pricePkr,
      playerId: order.playerId,
      zoneId: order.zoneId,
      confirmedUsername: order.confirmedUsername,
      placedAt: order.createdAt.toISOString(),
      diamondsDelivered: order.diamondsDelivered,
      partiallyDelivered: order.partiallyDelivered,
    },
  };
}

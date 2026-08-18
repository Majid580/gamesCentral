import "server-only";

import { z } from "zod";

import { connectToDatabase, assertScalar } from "@/lib/models/db";
import { OrderModel } from "@/lib/models/order";
import { ProductModel } from "@/lib/models/product";
import { fulfilOrderInBackground } from "@/lib/services/fulfilment";
import {
  getAccessToken,
  isPayFastConfigured,
  PayFastError,
  PayFastNotConfiguredError,
} from "@/lib/services/payfast/client";
import {
  buildHostedCheckoutForm,
  PayFastFieldsUnreviewedError,
  type HostedCheckoutForm,
} from "@/lib/services/payfast/hosted-checkout";
import { verifyAndSettleOrder } from "@/lib/services/payfast/verify-payment";

/**
 * Payment orchestration.
 *
 * Two jobs, deliberately kept apart:
 *   - `beginPayment` moves an order to `awaiting_payment` and builds the
 *     handoff to PayFast. It never touches money.
 *   - `settlePayment` re-checks with PayFast and moves the order to `paid`.
 *     It is the only path to `paid`, and it trusts nothing but our own order id.
 */

export const beginPaymentSchema = z.object({
  orderId: z.string().trim().min(1).max(32),
});

export type PaymentResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/* ------------------------------------------------------------------ */
/* Begin                                                               */
/* ------------------------------------------------------------------ */

export async function beginPayment(
  body: unknown,
): Promise<PaymentResult<HostedCheckoutForm>> {
  const parsed = beginPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid order reference." };
  }

  if (!isPayFastConfigured()) {
    /*
     * Said plainly rather than dressed up as a temporary glitch. PayFast add
     * the merchant account at go-live, so until then this is the expected
     * state, and pretending otherwise would send customers into a retry loop.
     */
    return {
      ok: false,
      status: 503,
      error:
        "Online payment isn't live yet. Your order is saved — please contact us to complete it.",
    };
  }

  await connectToDatabase();

  const orderId = String(assertScalar(parsed.data.orderId, "orderId")).toUpperCase();

  const order = await OrderModel.findOne({ orderId })
    .select("_id orderId status pricePkr contactEmail contactPhone product")
    .lean();

  if (!order) {
    return { ok: false, status: 404, error: "We couldn't find that order." };
  }

  /*
   * Only a fresh order may be sent to the gateway. Re-sending one that is
   * already paid would invite a second charge for the same diamonds, which is
   * far worse than making the customer start again.
   */
  if (order.status !== "pending") {
    const alreadyPaid = ["paid", "fulfilling", "fulfilled", "paid_pending_fulfillment"].includes(
      order.status,
    );
    return {
      ok: false,
      status: 409,
      error: alreadyPaid
        ? "This order has already been paid."
        : "This order can't be paid for again. Please start a new one.",
    };
  }

  const product = await ProductModel.findById(order.product).select("displayName").lean();

  let form: HostedCheckoutForm;
  try {
    const accessToken = await getAccessToken();
    form = buildHostedCheckoutForm({
      orderId: order.orderId,
      pricePkr: order.pricePkr,
      description: product?.displayName ?? "Mobile Legends top-up",
      contactEmail: order.contactEmail,
      contactPhone: order.contactPhone,
      accessToken,
    });
  } catch (error) {
    if (error instanceof PayFastFieldsUnreviewedError) {
      // A configuration mistake, not a customer problem. Loud on our side.
      console.error("[payfast] refused to build a production redirect", {
        message: error.message,
      });
      return {
        ok: false,
        status: 503,
        error: "Online payment isn't available right now. Please contact us.",
      };
    }
    if (error instanceof PayFastNotConfiguredError || error instanceof PayFastError) {
      console.error("[payfast] could not start a payment", {
        orderId,
        detail: error.message,
      });
      return {
        ok: false,
        status: 503,
        error: "We can't reach the payment provider right now. Nothing has been charged.",
      };
    }
    throw error;
  }

  /*
   * Transition only after the handoff is successfully built. Moving first
   * would strand the order in `awaiting_payment` whenever the gateway is down,
   * with no payment ever coming and no way back to `pending`.
   *
   * Conditional on the status we read, so two clicks cannot both proceed.
   */
  const moved = await OrderModel.findOneAndUpdate(
    { _id: order._id, status: "pending" },
    {
      $set: { status: "awaiting_payment" },
      $push: {
        statusHistory: {
          from: "pending",
          to: "awaiting_payment",
          note: "Handed off to PayFast hosted checkout",
          at: new Date(),
        },
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!moved) {
    return { ok: false, status: 409, error: "This order is already being paid for." };
  }

  return { ok: true, data: form };
}

/* ------------------------------------------------------------------ */
/* Settle                                                              */
/* ------------------------------------------------------------------ */

/**
 * Verifies and settles an order, for both the customer's return redirect and
 * PayFast's server-to-server notification.
 *
 * Both callers pass only an order id, and neither passes anything from the
 * gateway's payload. That is the whole design: the two entry points differ in
 * *when* they fire, never in what they are believed about.
 */
export async function settlePayment(
  orderIdInput: unknown,
): Promise<PaymentResult<{ paid: boolean; reason?: string }>> {
  const parsed = z.string().trim().min(1).max(32).safeParse(orderIdInput);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid order reference." };
  }

  const outcome = await verifyAndSettleOrder(parsed.data);

  if (outcome.settled) {
    /*
     * Payment confirmed, so delivery may begin — this is the only place in the
     * app where that sentence is true (rule 2). Started here rather than inside
     * `verifyAndSettleOrder` so verification stays a pure question with a
     * yes/no answer, and the decision to act on it is visible in the caller.
     *
     * Deliberately not awaited: see `fulfilOrderInBackground`. Deliberately
     * fired even when the payment was already settled by the other trigger —
     * the atomic claim inside decides who actually delivers, and a webhook
     * arriving after a redirect settled the order is precisely how a
     * fulfilment that never started gets a second chance.
     */
    fulfilOrderInBackground(parsed.data, "payment settled");

    return { ok: true, data: { paid: true } };
  }

  // The reason is for our logs and the admin screen, never for the customer.
  console.warn("[payfast] order not settled", {
    orderId: parsed.data,
    reason: outcome.reason,
    detail: outcome.detail,
  });

  return { ok: true, data: { paid: false, reason: outcome.reason } };
}

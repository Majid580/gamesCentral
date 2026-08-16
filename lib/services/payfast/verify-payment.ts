import "server-only";

import { connectToDatabase, assertScalar } from "@/lib/models/db";
import { OrderModel } from "@/lib/models/order";
import {
  fetchTransactionByBasketId,
  PayFastError,
  type PayFastTransaction,
} from "@/lib/services/payfast/client";
import { amountStringToPaisa, paisaToAmountString } from "@/lib/utils/money";

/**
 * Independent payment verification — non-negotiable rule 2.
 *
 * Nothing in this file trusts anything the browser or a webhook body says. The
 * only input is our own order id; the amount and status are re-fetched from
 * PayFast server-to-server and compared against what we recorded when the
 * order was created. A redirect saying "payment successful" and a webhook body
 * claiming the same are both, on their own, a stranger's assertion.
 *
 * FAIL CLOSED. PayFast Pakistan's response field names are not confirmed (see
 * ./client.ts), so this can encounter a shape it does not recognise. The rule
 * throughout: an unreadable response is "not paid". Never "probably fine". The
 * cost of a false negative is an order that an operator settles by hand; the
 * cost of a false positive is diamonds delivered for money that never arrived.
 */

/**
 * Gateway status strings that mean the money actually moved.
 *
 * An allowlist, not a blocklist of failures. A blocklist treats every status
 * it has not seen before as success, which is precisely backwards for a
 * gateway whose vocabulary we have not confirmed.
 */
const PAID_STATUSES = [
  "completed",
  "success",
  "successful",
  "paid",
  "approved",
  "captured",
];

export type VerificationOutcome =
  | { settled: true; alreadySettled: boolean; transactionId: string | null }
  | {
      settled: false;
      reason:
        | "order_not_found"
        | "not_awaiting_payment"
        | "gateway_unreachable"
        | "not_paid"
        | "unreadable_response"
        | "amount_mismatch";
      detail: string;
    };

/**
 * Verifies a payment against PayFast and, only if it genuinely checks out,
 * moves the order to `paid`.
 *
 * Safe to call repeatedly and from more than one place at once — the redirect
 * handler and the webhook both call it for the same order, frequently at the
 * same moment. That is the intended design rather than a tolerated race: two
 * independent triggers mean a customer who closes the tab still gets settled.
 */
export async function verifyAndSettleOrder(
  orderIdInput: string,
): Promise<VerificationOutcome> {
  await connectToDatabase();

  const orderId = String(assertScalar(orderIdInput, "orderId")).toUpperCase();

  const order = await OrderModel.findOne({ orderId })
    .select("_id orderId status pricePkr paymentReference")
    .lean();

  if (!order) {
    return { settled: false, reason: "order_not_found", detail: `No order ${orderId}` };
  }

  /*
   * Already settled — report success rather than an error. Both the redirect
   * and the webhook race to verify the same order, and the loser must not
   * surface a scary message to a customer whose payment went through fine.
   */
  if (["paid", "fulfilling", "fulfilled", "paid_pending_fulfillment"].includes(order.status)) {
    return {
      settled: true,
      alreadySettled: true,
      transactionId: order.paymentReference ?? null,
    };
  }

  if (order.status !== "awaiting_payment") {
    return {
      settled: false,
      reason: "not_awaiting_payment",
      detail: `Order ${orderId} is ${order.status}, not awaiting_payment`,
    };
  }

  let transaction: PayFastTransaction;
  try {
    transaction = await fetchTransactionByBasketId(order.orderId);
  } catch (error) {
    /*
     * Unreachable is not unpaid. The order stays in awaiting_payment so a
     * retry — or the other trigger, or an operator — can settle it later.
     * Marking it failed here would strand a real payment (rule 8).
     */
    const detail = error instanceof PayFastError ? error.message : String(error);
    console.error("[payfast] verification could not reach the gateway", {
      orderId,
      detail,
    });
    return { settled: false, reason: "gateway_unreachable", detail };
  }

  /* ---- did the money move? ---- */

  if (!transaction.statusText) {
    console.error("[payfast] transaction response had no readable status", {
      orderId,
      observedKeys: transaction.observedKeys,
    });
    return {
      settled: false,
      reason: "unreadable_response",
      detail: `No status field. Keys seen: ${transaction.observedKeys.join(", ") || "none"}`,
    };
  }

  const isPaid = PAID_STATUSES.includes(transaction.statusText.trim().toLowerCase());
  if (!isPaid) {
    return {
      settled: false,
      reason: "not_paid",
      detail: `Gateway status "${transaction.statusText}" is not a settled status`,
    };
  }

  /* ---- is it the amount we asked for? ---- */

  const chargedPaisa =
    transaction.amountText === null ? null : amountStringToPaisa(transaction.amountText);

  if (chargedPaisa === null) {
    console.error("[payfast] transaction amount was unreadable", {
      orderId,
      observedKeys: transaction.observedKeys,
    });
    return {
      settled: false,
      reason: "unreadable_response",
      detail: "Amount field missing or not a plain decimal",
    };
  }

  if (chargedPaisa !== order.pricePkr) {
    /*
     * The gateway says paid, for a different amount than we asked for. Treated
     * as a security event, not a rounding annoyance: it is what a tampered
     * amount looks like from this side. The order deliberately stays in
     * awaiting_payment — money may well have moved, so `failed` would be a lie
     * and would also close the only route to recovery.
     */
    console.error("[payfast] AMOUNT MISMATCH — refusing to settle", {
      orderId,
      expected: paisaToAmountString(order.pricePkr),
      charged: paisaToAmountString(chargedPaisa),
    });

    await OrderModel.updateOne(
      { _id: order._id },
      {
        $push: {
          statusHistory: {
            from: order.status,
            to: order.status,
            note:
              `PayFast reported a settled payment of ${paisaToAmountString(chargedPaisa)} ` +
              `against an order for ${paisaToAmountString(order.pricePkr)}. Not settled — needs review.`,
            at: new Date(),
          },
        },
      },
    );

    return {
      settled: false,
      reason: "amount_mismatch",
      detail: `Expected ${paisaToAmountString(order.pricePkr)}, gateway charged ${paisaToAmountString(chargedPaisa)}`,
    };
  }

  /* ---- settle, once ---- */

  /*
   * Atomic conditional update on the current status (rule 3). If the webhook
   * and the redirect arrive together, exactly one update matches; the other
   * sees no document and falls through to the already-settled read below.
   */
  const settled = await OrderModel.findOneAndUpdate(
    { _id: order._id, status: "awaiting_payment" },
    {
      $set: {
        status: "paid",
        paymentReference: transaction.transactionId ?? order.paymentReference ?? null,
      },
      $push: {
        statusHistory: {
          from: "awaiting_payment",
          to: "paid",
          note: `Verified server-to-server with PayFast for ${paisaToAmountString(order.pricePkr)}`,
          at: new Date(),
        },
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!settled) {
    // Lost the race. The other caller settled it, which is a success.
    return { settled: true, alreadySettled: true, transactionId: transaction.transactionId };
  }

  console.info("[payfast] order settled", { orderId, status: settled.status });

  return { settled: true, alreadySettled: false, transactionId: transaction.transactionId };
}

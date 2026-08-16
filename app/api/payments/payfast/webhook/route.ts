import { NextResponse } from "next/server";

import { settlePayment } from "@/lib/controllers/payments";

/**
 * PayFast's server-to-server payment notification.
 *
 * The payload is read for exactly one thing: which order it concerns. Every
 * claim it makes about status or amount is ignored, and the money is confirmed
 * by re-fetching the transaction from PayFast using our own basket id
 * (rule 2). That is why this handler needs no signature check to be safe —
 * a forged notification can, at most, make us ask PayFast about an order we
 * already know, and PayFast's answer is what decides.
 *
 * Always answers 200. A gateway that receives an error retries, and retrying
 * cannot fix a payment that did not happen — it only produces noise. Whether
 * we settled the order is recorded in our own logs and on the order itself.
 */
export async function POST(request: Request) {
  const basketId = await readBasketId(request);

  if (!basketId) {
    console.warn("[payfast] webhook arrived without a recognisable basket id");
    return NextResponse.json({ received: true });
  }

  const result = await settlePayment(basketId);

  console.info("[payfast] webhook processed", {
    basketId,
    settled: result.ok ? result.data.paid : false,
  });

  return NextResponse.json({ received: true });
}

/**
 * Finds our order id in the notification, whatever shape it arrives in.
 *
 * PayFast Pakistan's notification format is unconfirmed, so this accepts both
 * form-encoded and JSON bodies and several plausible key spellings. Reading
 * the wrong key simply means no settlement happens here — the customer's
 * return redirect settles it instead, and an operator can settle it by hand.
 * There is no shape of this body that can cause a false settlement.
 */
async function readBasketId(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";

  let record: Record<string, unknown> = {};
  try {
    if (contentType.includes("application/json")) {
      record = (await request.json()) as Record<string, unknown>;
    } else {
      record = Object.fromEntries((await request.formData()).entries());
    }
  } catch {
    return null;
  }

  for (const key of ["basket_id", "BASKET_ID", "basketId", "order_id", "ORDER_ID"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

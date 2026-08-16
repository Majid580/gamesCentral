import { NextResponse } from "next/server";

import { settlePayment } from "@/lib/controllers/payments";
import { checkRateLimit, clientIp, paymentSettleRules } from "@/lib/services/rate-limit";

/**
 * Triggered when the customer returns from PayFast.
 *
 * It carries no authority. The order id is a request to go and *check* with
 * PayFast, and the answer comes from PayFast alone — so anyone calling this
 * for someone else's order achieves nothing except correctly settling a
 * payment that really happened.
 *
 * It exists alongside the webhook because the two fail differently: a customer
 * who closes the tab is covered by the webhook, and a webhook that never
 * arrives is covered by this.
 */
export async function POST(request: Request) {
  const limit = await checkRateLimit(paymentSettleRules(clientIp(request.headers)));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const orderId = (body as { orderId?: unknown })?.orderId;
  const result = await settlePayment(orderId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  /*
   * Only whether it settled. The reason a verification failed is operator
   * detail — it names our internal states and what the gateway told us, and
   * neither belongs in a customer's browser (rule 7).
   */
  return NextResponse.json({ paid: result.data.paid });
}

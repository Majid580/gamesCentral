import { NextResponse } from "next/server";

import { createOrder } from "@/lib/controllers/checkout";
import { clientIp } from "@/lib/services/rate-limit";

/**
 * Creates a `pending` order priced from our own database.
 *
 * Phase 5 replaces the response's `next` field with a PayFast redirect. Until
 * then the order is real and recorded, but no payment is taken.
 *
 * Rate limited on two axes, because creating an order sends the customer an
 * email and this endpoint is public — see `orderCreateRules`.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const result = await createOrder(body, { ip: clientIp(request.headers) });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, fields: result.fields },
      {
        status: result.status,
        // Truthful when the limiter set it; absent otherwise.
        headers: result.retryAfterSeconds
          ? { "Retry-After": String(result.retryAfterSeconds) }
          : undefined,
      },
    );
  }

  return NextResponse.json({
    orderId: result.data.orderId,
    pricePkr: result.data.pricePkr,
    displayName: result.data.displayName,
    priceChanged: result.data.priceChanged,
  });
}

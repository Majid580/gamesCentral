import { NextResponse } from "next/server";

import { createOrder } from "@/lib/controllers/checkout";

/**
 * Creates a `pending` order priced from our own database.
 *
 * Phase 5 replaces the response's `next` field with a PayFast redirect. Until
 * then the order is real and recorded, but no payment is taken.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const result = await createOrder(body);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, field: result.field },
      { status: result.status },
    );
  }

  return NextResponse.json({
    orderId: result.data.orderId,
    pricePkr: result.data.pricePkr,
    displayName: result.data.displayName,
    priceChanged: result.data.priceChanged,
  });
}

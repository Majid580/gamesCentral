import { NextResponse } from "next/server";

import { beginPayment } from "@/lib/controllers/payments";

/**
 * Hands a pending order off to PayFast's hosted checkout.
 *
 * Returns the form the browser must POST rather than redirecting here: hosted
 * checkout needs a form POST from the customer's own browser, which a server
 * fetch cannot perform on their behalf.
 *
 * Thin by design — the status transition and every decision live in the
 * controller.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const result = await beginPayment(body);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  /*
   * The action URL and field set are what the browser needs to reach the
   * payment page. They contain no secret: the access token is short-lived and
   * scoped to this one transaction, and the merchant id is public by design in
   * a redirect flow. The `secured_key` never leaves the server.
   */
  return NextResponse.json({ action: result.data.action, fields: result.data.fields });
}

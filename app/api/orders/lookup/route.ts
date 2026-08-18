import { NextResponse } from "next/server";

import { lookupOrder } from "@/lib/controllers/track";
import { clientIp } from "@/lib/services/rate-limit";

/**
 * Guest order lookup.
 *
 * POST rather than GET, and the reason is privacy rather than semantics: a GET
 * would put the customer's email or phone number in a URL, where it lands in
 * server logs, browser history, and any Referer header the page later sends.
 *
 * Thin by design — the IDOR guard, the rate limits and the customer-facing
 * wording all live below this, in the controller and the service.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const result = await lookupOrder(body, { ip: clientIp(request.headers) });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      {
        status: result.status,
        headers: result.retryAfterSeconds
          ? { "Retry-After": String(result.retryAfterSeconds) }
          : undefined,
      },
    );
  }

  return NextResponse.json(result.data);
}

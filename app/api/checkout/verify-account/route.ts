import { NextResponse } from "next/server";

import { verifyAccount } from "@/lib/controllers/checkout";
import { clientIp } from "@/lib/services/rate-limit";

/**
 * Looks up the in-game account behind a Player ID + Zone ID.
 *
 * Thin by design: parse the body, read the caller's address, delegate, shape
 * the response. All logic is in the controller and the services beneath it —
 * the address is read here because only the route sees the request headers.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const result = await verifyAccount(body, { ip: clientIp(request.headers) });

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

  // Only the fields the UI needs — no raw supplier payload reaches the browser.
  return NextResponse.json({
    username: result.data.username,
    zone: result.data.zone,
    stubbed: result.data.stubbed,
  });
}

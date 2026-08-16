import { NextResponse } from "next/server";

import { verifyAccount } from "@/lib/controllers/checkout";

/**
 * Looks up the in-game account behind a Player ID + Zone ID.
 *
 * Thin by design: parse the body, delegate, shape the response. All logic is
 * in the controller and the services beneath it.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const result = await verifyAccount(body);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, fields: result.fields },
      { status: result.status },
    );
  }

  // Only the fields the UI needs — no raw supplier payload reaches the browser.
  return NextResponse.json({
    username: result.data.username,
    zone: result.data.zone,
    stubbed: result.data.stubbed,
  });
}

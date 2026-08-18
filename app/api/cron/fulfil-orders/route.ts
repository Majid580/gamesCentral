import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { sweepUnfulfilledOrders } from "@/lib/services/fulfilment-sweep";

/**
 * Scheduled recovery for paid orders that nobody is delivering.
 *
 * A plain authenticated route rather than a platform cron primitive, because
 * production is Hostinger: this has to be curl-able by whatever scheduler that
 * box happens to have (see CLAUDE.md). Something like:
 *
 *   curl -fsS -X POST https://gamescentral.pk/api/cron/fulfil-orders \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Every five minutes is ample. The in-process trigger does the real work; this
 * only catches what a restart or a missed webhook left behind.
 */

export const dynamic = "force-dynamic";

/**
 * Constant-time comparison that also hides the secret's length.
 *
 * `timingSafeEqual` throws on differently-sized buffers, so the usual fix is
 * to compare lengths first and return early — which quietly turns the length
 * into an oracle a prober can measure. Hashing both sides to a fixed 32 bytes
 * removes that: every comparison is the same size and takes the same time,
 * whatever was presented.
 */
function secretMatches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function authorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;

  /*
   * No secret configured means no scheduled fulfilment, not open access. The
   * alternative — treating an unset variable as "no auth required" — turns a
   * deployment mistake into a public endpoint that walks the order book.
   */
  if (!expected || expected.length < 32) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented) return false;

  return secretMatches(presented, expected);
}

/**
 * POST, not GET. This changes state and spends the owner's balance; a GET
 * would be fetched by link previews, prefetchers, and anything else that
 * assumes GET is safe.
 */
export async function POST(request: Request) {
  if (!authorised(request)) {
    // Deliberately indistinguishable from a route that does not exist.
    return new NextResponse(null, { status: 404 });
  }

  const report = await sweepUnfulfilledOrders();

  console.info("[cron] fulfilment sweep", {
    released: report.released,
    scanned: report.scanned,
    fulfilled: report.fulfilled,
    handedToAdmin: report.handedToAdmin,
    skipped: report.skipped,
    errored: report.errored,
    deferred: report.deferred,
  });

  /*
   * A summary only. The caller is a scheduler, and per-order detail is
   * operator information that belongs on the admin screen and in the log —
   * not in a response body that ends up in a cron mail spool.
   */
  return NextResponse.json({
    released: report.released,
    scanned: report.scanned,
    fulfilled: report.fulfilled,
    handedToAdmin: report.handedToAdmin,
    skipped: report.skipped,
    errored: report.errored,
    deferred: report.deferred,
  });
}

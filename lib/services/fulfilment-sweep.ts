import "server-only";

import { connectToDatabase } from "@/lib/models/db";
import { OrderModel } from "@/lib/models/order";
import { fulfilOrder } from "@/lib/services/fulfilment";

/**
 * The safety net under fulfilment.
 *
 * Delivery normally starts the moment a payment verifies, in the same process
 * that verified it. Two things stop that from finishing, and neither is exotic:
 *
 *   - the process goes away between the payment settling and the delivery
 *     completing — a deploy, a crash, an out-of-memory kill;
 *   - the trigger never fired at all — an operator settled the order by hand,
 *     or a webhook arrived while the app was down.
 *
 * In both cases a customer has paid and nobody is delivering. Rule 8 says a
 * payment must never be silently lost, and "the request that was going to
 * handle it went away" is the most ordinary way to lose one.
 *
 * Driven by `/api/cron/fulfil-orders`, which any scheduler can curl — no
 * Vercel Cron and no platform-specific primitive, because production is
 * Hostinger (see CLAUDE.md).
 */

/**
 * How long a `paid` order may sit before the sweeper takes it.
 *
 * Long enough that the in-process trigger has either finished or clearly
 * failed. Shorter would have the sweeper racing a request that is already
 * delivering the order. That is harmless — the claim is atomic — but it fills
 * the log with lost races and buries the real ones.
 */
const PAID_GRACE_MS = 2 * 60 * 1000;

/**
 * How long an order may sit in `fulfilling` before it is presumed abandoned.
 *
 * Generous, for an arithmetic reason: the largest plan in the catalogue is ten
 * weekly passes, each a separate supplier call with a 12-second timeout, so
 * two minutes of genuine work is possible. Fifteen minutes is comfortably past
 * any live run, which makes anything still sitting here a run that lost its
 * process rather than a slow one.
 */
const STALLED_FULFILLING_MS = 15 * 60 * 1000;

/** Bounded so one run can never become an unbounded burst of supplier calls. */
const MAX_PER_RUN = 25;

export type SweepReport = {
  /** Stalled `fulfilling` orders moved into the admin queue. */
  released: number;
  /** `paid` orders the in-process trigger never finished. */
  scanned: number;
  fulfilled: number;
  handedToAdmin: number;
  skipped: number;
  orders: { orderId: string; state: string; detail: string }[];
};

export async function sweepUnfulfilledOrders(): Promise<SweepReport> {
  await connectToDatabase();

  const released = await releaseStalledFulfilling();

  const candidates = await OrderModel.find({
    status: "paid",
    updatedAt: { $lt: new Date(Date.now() - PAID_GRACE_MS) },
  })
    .sort({ updatedAt: 1 })
    .limit(MAX_PER_RUN)
    .select("orderId")
    .lean();

  const report: SweepReport = {
    released,
    scanned: candidates.length,
    fulfilled: 0,
    handedToAdmin: 0,
    skipped: 0,
    orders: [],
  };

  for (const candidate of candidates) {
    /*
     * `allowRetry` stays false. The sweeper's job is orders nobody picked up,
     * not orders that were tried and failed — those are in
     * `paid_pending_fulfillment`, where a person has to decide, because the
     * reason they failed is usually still true. An automatic loop retrying
     * them would hammer the supplier with the same doomed call every minute.
     */
    const outcome = await fulfilOrder(candidate.orderId, { triggeredBy: "sweeper" });

    if (outcome.ok) {
      report.fulfilled += 1;
    } else if (outcome.state === "not_claimable") {
      // Someone else got there first. Normal, and not a problem.
      report.skipped += 1;
    } else {
      report.handedToAdmin += 1;
    }

    report.orders.push({
      orderId: candidate.orderId,
      state: outcome.state,
      detail: outcome.detail,
    });
  }

  if (report.handedToAdmin > 0 || released > 0) {
    console.error("[fulfilment] sweeper put orders in front of an operator", {
      handedToAdmin: report.handedToAdmin,
      released,
    });
  }

  return report;
}

/**
 * Moves abandoned `fulfilling` orders into the admin queue.
 *
 * Kept separate from `fulfilOrder` rather than added to what that function may
 * claim, and the distinction is deliberate: `fulfilOrder` must never be able
 * to claim an order that is already `fulfilling`, because in the normal case
 * that means another process is mid-delivery and a second claimant would buy
 * everything twice. Only the stall window makes it safe, and only this
 * function knows about the stall window.
 *
 * It releases into `paid_pending_fulfillment`, never straight back into
 * delivery, even when nothing was in flight and an automatic resume would be
 * provably safe. A run that died is unusual enough to be worth a human
 * glance, and the note tells that human which of the two situations they are
 * looking at so the decision takes seconds.
 */
async function releaseStalledFulfilling(): Promise<number> {
  const cutoff = new Date(Date.now() - STALLED_FULFILLING_MS);

  const stalled = await OrderModel.find({
    status: "fulfilling",
    updatedAt: { $lt: cutoff },
  })
    .limit(MAX_PER_RUN)
    .select("_id orderId fulfilmentInFlight")
    .lean();

  let released = 0;

  for (const order of stalled) {
    const inFlight = order.fulfilmentInFlight;

    const note = inFlight
      ? `Fulfilment stopped with a ${inFlight.supplierProductId} purchase in flight. It is ` +
        "unknown whether that pack reached the player — check the SmileOne dashboard " +
        "before retrying, because retrying blind would buy it twice."
      : "Fulfilment stopped between supplier calls, with nothing in flight. Everything " +
        "already delivered is recorded, so a retry will deliver only the remainder.";

    /*
     * Conditional on both the status and the cutoff, so an order that resumed
     * on its own between the read and this write is left alone.
     */
    const result = await OrderModel.updateOne(
      { _id: order._id, status: "fulfilling", updatedAt: { $lt: cutoff } },
      {
        $set: { status: "paid_pending_fulfillment" },
        $push: {
          statusHistory: {
            from: "fulfilling",
            to: "paid_pending_fulfillment",
            note: note.slice(0, 500),
            at: new Date(),
          },
        },
      },
    );

    if (result.modifiedCount > 0) {
      released += 1;
      console.error("[fulfilment] released a stalled order to the admin queue", {
        orderId: order.orderId,
        hadCallInFlight: Boolean(inFlight),
      });
    }
  }

  return released;
}

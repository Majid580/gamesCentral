import "server-only";

import { connectToDatabase } from "@/lib/models/db";
import { OrderModel } from "@/lib/models/order";
import { notifyOrderNeedsAttention } from "@/lib/services/email/notify";
import { fulfilOrder, loadOrderEmailFacts } from "@/lib/services/fulfilment";

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

/**
 * Wall-clock budget for one sweep, and the reason it exists is arithmetic
 * rather than caution.
 *
 * A sweep can pick up 25 orders; the largest plan in the catalogue is ten
 * supplier calls; each call can take the client's full 12-second timeout.
 * That upper bound is fifty minutes inside a single HTTP request — long past
 * any reverse proxy's patience, and a proxy that gives up kills the process
 * mid-delivery, which is exactly the state this whole module exists to
 * prevent.
 *
 * So the sweep stops *starting* orders once the budget is spent and leaves the
 * rest for the next run. Nothing is dropped: an order the sweeper did not
 * reach is still `paid`, still past its grace period, and still first in line
 * next time. Checked between orders, never mid-order — abandoning an order
 * halfway through its packs to save a few seconds would be self-defeating.
 */
const RUN_BUDGET_MS = 60 * 1000;

export type SweepReport = {
  /** Stalled `fulfilling` orders moved into the admin queue. */
  released: number;
  /** `paid` orders the in-process trigger never finished. */
  scanned: number;
  fulfilled: number;
  handedToAdmin: number;
  skipped: number;
  /** Orders that threw. They keep their status and are retried next run. */
  errored: number;
  /** Candidates left for the next run because the time budget ran out. */
  deferred: number;
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
    errored: 0,
    deferred: 0,
    orders: [],
  };

  const deadline = Date.now() + RUN_BUDGET_MS;

  for (const [index, candidate] of candidates.entries()) {
    if (Date.now() > deadline) {
      report.deferred = candidates.length - index;
      console.warn("[fulfilment] sweep hit its time budget", {
        done: index,
        deferred: report.deferred,
      });
      break;
    }

    /*
     * Each order is isolated. Without this, one order that throws — an Atlas
     * blip, a document that fails validation — aborts the whole batch and
     * every paid order behind it waits for the next run. The one that threw is
     * not lost either: it keeps its status, so it is a candidate again next
     * time.
     *
     * `allowRetry` stays false. The sweeper's job is orders nobody picked up,
     * not orders that were tried and failed — those are in
     * `paid_pending_fulfillment`, where a person has to decide, because the
     * reason they failed is usually still true. An automatic loop retrying
     * them would hammer the supplier with the same doomed call every minute.
     */
    try {
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
    } catch (error) {
      report.errored += 1;
      const detail = error instanceof Error ? error.message : String(error);

      console.error("[fulfilment] sweep threw on an order", {
        orderId: candidate.orderId,
        detail,
      });

      report.orders.push({ orderId: candidate.orderId, state: "threw", detail });
    }
  }

  if (report.handedToAdmin > 0 || report.errored > 0 || released > 0) {
    console.error("[fulfilment] sweeper put orders in front of an operator", {
      handedToAdmin: report.handedToAdmin,
      errored: report.errored,
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

      /*
       * A stalled order is the case where nobody would otherwise find out. It
       * got here because the process handling it died, so there is no request
       * left to report anything and no operator watching — this notification
       * is the only thing standing between a paid customer and silence.
       */
      const facts = await loadOrderEmailFacts(order._id);
      if (facts) {
        notifyOrderNeedsAttention({
          facts,
          outstanding: inFlight ? [inFlight.supplierProductId] : [],
          reason: note,
          needsDashboardCheck: Boolean(inFlight),
        });
      }
    }
  }

  return released;
}

import "server-only";

import {
  SUPPLIER_PACKS,
  remainingCalls,
  type FulfilmentPart,
  type SupplierProductId,
} from "@/lib/fulfilment-plan";
import { connectToDatabase, assertScalar } from "@/lib/models/db";
import { GameModel } from "@/lib/models/game";
import { OrderModel, type OrderStatus } from "@/lib/models/order";
import type { Types } from "mongoose";
import { createSupplierOrder, SmileOneError } from "@/lib/services/smileone/client";
import { SmileOneSafetyError } from "@/lib/services/smileone/safety";

/**
 * Fulfilment — the only place in the app that delivers anything.
 *
 * ⛔ IT CANNOT DELIVER TODAY. `createSupplierOrder` runs through the live
 *    account gate in `smileone/safety.ts`, which blocks `createorder` before a
 *    socket is opened. Read `LIVE_ACCOUNT_SAFETY.md`. This module is written
 *    so the path is complete and reviewable before payments go live, and so a
 *    paid order is never left with nobody responsible for it — a blocked
 *    delivery lands in the admin queue rather than vanishing.
 *
 * The three properties everything here is arranged around:
 *
 *   1. **Only paid orders.** The claim is a conditional update on `paid` (or
 *      `paid_pending_fulfillment` for an explicit retry). There is no argument
 *      that skips it and no caller that can pass a status in.
 *
 *   2. **Never deliver the same pack twice.** The supplier's `createorder`
 *      takes no reference of ours, so calling it twice buys twice, and a
 *      composed order like "1050 Diamonds" is three separate purchases. Every
 *      call that lands is recorded individually, and a retry re-derives what
 *      is outstanding by subtraction (`remainingCalls`) rather than replaying
 *      the plan.
 *
 *   3. **Never guess about a call whose outcome is unknown.** Between the
 *      request landing at SmileOne and our record of it being written, there
 *      is a window where the diamonds are gone and we do not know it. Orders
 *      caught in that window are handed to a human with the pack named, not
 *      retried and not written off. See `fulfilmentInFlight` on the Order.
 */

/* ------------------------------------------------------------------ */
/* Outcome                                                             */
/* ------------------------------------------------------------------ */

export type FulfilmentOutcome =
  | {
      ok: true;
      /** `already` means it was complete before this call did anything. */
      state: "fulfilled" | "already";
      deliveredThisRun: number;
      detail: string;
    }
  | {
      ok: false;
      state:
        /** No such order. */
        | "not_found"
        /** Wrong status — not paid, or another worker holds the claim. */
        | "not_claimable"
        /** Paid, but nothing records which packs deliver it. */
        | "no_plan"
        /** A previous run died mid-call. A human must check the dashboard. */
        | "outcome_unknown"
        /** The supplier refused, or the safety gate did. Nothing delivered. */
        | "supplier_refused";
      deliveredThisRun: number;
      detail: string;
    };

/* ------------------------------------------------------------------ */
/* Development stub                                                    */
/* ------------------------------------------------------------------ */

/**
 * Lets the whole fulfilment path — claim, partial failure, retry, idempotency —
 * be exercised end to end without spending a rupee.
 *
 * Same shape as the account-lookup stub in `smileone/verify-account.ts`, and
 * for a stronger reason: this is the code path that spends money, so the
 * combination "stub enabled in production" must be impossible to serve rather
 * than merely discouraged. Checked at the point of use, not at module scope,
 * because `next build` imports every route with NODE_ENV=production and a
 * module-level throw would fail the build on any machine with the flag set.
 *
 * There is deliberately no NEXT_PUBLIC_ variant. Nothing the browser sends can
 * turn this on, and nothing it sends can turn it off either.
 */
function stubEnabled(): boolean {
  if (process.env.SMILEONE_FULFILMENT_STUB !== "1") return false;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SMILEONE_FULFILMENT_STUB is set in a production build. Fake deliveries " +
        "must never be recorded against real customers — unset it.",
    );
  }

  return true;
}

/**
 * Fake a failure after N successful calls, to exercise the partial-delivery
 * path. `SMILEONE_FULFILMENT_STUB_FAIL_MODE` picks which kind:
 *
 *   `refused` (default) — the supplier answered and said no. Nothing was
 *   delivered, so the order is safe to retry in full.
 *
 *   `unknown` — the connection died mid-call. Whether the pack landed is
 *   genuinely unknowable from here, which is the case the `fulfilmentInFlight`
 *   marker exists for and the one worth being able to reproduce on demand.
 */
function stubFailAfter(): number | null {
  const raw = process.env.SMILEONE_FULFILMENT_STUB_FAIL_AFTER;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function deliverOnePack(args: {
  smileOneProduct: string;
  supplierProductId: string;
  playerId: string;
  zoneId: string;
  callsAlreadyMadeThisRun: number;
}): Promise<{ supplierOrderId: string; stubbed: boolean }> {
  if (stubEnabled()) {
    const failAfter = stubFailAfter();
    if (failAfter !== null && args.callsAlreadyMadeThisRun >= failAfter) {
      if (process.env.SMILEONE_FULFILMENT_STUB_FAIL_MODE === "unknown") {
        // No upstreamStatus: indistinguishable from a real timeout, which is
        // exactly the point — the caller must treat it as unknown.
        throw new SmileOneError(
          "Stub: connection died mid-call",
          "/smilecoin/api/createorder",
        );
      }
      throw new SmileOneError(
        "Stub: supplier refused the order",
        "/smilecoin/api/createorder",
        undefined,
        "20001",
      );
    }

    /*
     * Prefixed so a stubbed delivery can never be mistaken for a real one in
     * the database or on the admin screen. An entry in `fulfilmentDeliveries`
     * is a claim that diamonds reached a player's account; a fabricated one
     * has to look fabricated.
     */
    const nonce = Math.random().toString(36).slice(2, 10).toUpperCase();
    return { supplierOrderId: `STUB-${args.supplierProductId}-${nonce}`, stubbed: true };
  }

  const { supplierOrderId } = await createSupplierOrder({
    product: args.smileOneProduct,
    productId: args.supplierProductId,
    userId: args.playerId,
    zoneId: args.zoneId,
  });

  return { supplierOrderId, stubbed: false };
}

/* ------------------------------------------------------------------ */
/* Did that call definitely not deliver?                               */
/* ------------------------------------------------------------------ */

/**
 * True only when the failure proves nothing reached the player's account.
 *
 * Two cases qualify, and nothing else does:
 *
 *   - The safety gate refused. The request was never dispatched.
 *   - The supplier answered HTTP 200 with an application-level failure status
 *     (`upstreamStatus`) — a structured "no" from the party that would have
 *     done the delivering. Insufficient balance lands here.
 *
 * A timeout, a dropped connection, an HTTP 500, or a 200 whose body we could
 * not read all return false. Each of those can happen *after* the supplier has
 * already delivered, and treating "I did not hear back" as "it did not happen"
 * is how a customer gets billed for diamonds nobody sent, or sent twice.
 */
function provesNothingWasDelivered(error: unknown): boolean {
  if (error instanceof SmileOneSafetyError) return true;
  if (error instanceof SmileOneError && error.upstreamStatus !== undefined) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* The executor                                                        */
/* ------------------------------------------------------------------ */

const CLAIMABLE_AUTOMATICALLY: readonly OrderStatus[] = ["paid"];
const CLAIMABLE_ON_RETRY: readonly OrderStatus[] = ["paid", "paid_pending_fulfillment"];

export async function fulfilOrder(
  orderIdInput: string,
  options: { allowRetry?: boolean; triggeredBy?: string } = {},
): Promise<FulfilmentOutcome> {
  await connectToDatabase();

  const orderId = String(assertScalar(orderIdInput, "orderId")).toUpperCase();
  const trigger = options.triggeredBy ?? "automatic";

  const existing = await OrderModel.findOne({ orderId })
    .select("_id orderId status game playerId zoneId smileOneOrderId")
    .lean();

  if (!existing) {
    return {
      ok: false,
      state: "not_found",
      deliveredThisRun: 0,
      detail: `No order ${orderId}`,
    };
  }

  if (existing.status === "fulfilled") {
    return {
      ok: true,
      state: "already",
      deliveredThisRun: 0,
      detail: "Already fulfilled.",
    };
  }

  const claimableFrom = options.allowRetry ? CLAIMABLE_ON_RETRY : CLAIMABLE_AUTOMATICALLY;
  const from = existing.status as OrderStatus;

  if (!claimableFrom.includes(from)) {
    return {
      ok: false,
      state: "not_claimable",
      deliveredThisRun: 0,
      detail: `Order is ${from}; fulfilment claims ${claimableFrom.join(" or ")}.`,
    };
  }

  /*
   * The claim (rule 3). Conditional on the exact status just read, so two
   * triggers arriving together — the customer's return and PayFast's webhook,
   * or a sweeper and an operator — produce exactly one winner. The loser
   * matches no document and returns `not_claimable`, which is correct: someone
   * else is already delivering this order.
   */
  const claimed = await OrderModel.findOneAndUpdate(
    { _id: existing._id, status: from },
    {
      $set: { status: "fulfilling" },
      $push: {
        statusHistory: {
          from,
          to: "fulfilling",
          note: `Fulfilment started (${trigger})`,
          at: new Date(),
        },
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!claimed) {
    return {
      ok: false,
      state: "not_claimable",
      deliveredThisRun: 0,
      detail: "Another process claimed this order first.",
    };
  }

  /* ---- a previous run died mid-call ---- */

  if (claimed.fulfilmentInFlight) {
    const pack = claimed.fulfilmentInFlight.supplierProductId;
    const label = SUPPLIER_PACKS[pack as SupplierProductId]?.label ?? `pack ${pack}`;

    await releaseToPending(
      claimed._id,
      `A previous delivery attempt for ${label} did not report back, so it is unknown ` +
        `whether it reached the player. Check the SmileOne dashboard before retrying — ` +
        `retrying blind would buy it twice.`,
    );

    console.error("[fulfilment] outcome of a previous call is unknown", {
      orderId,
      supplierProductId: pack,
      startedAt: claimed.fulfilmentInFlight.startedAt,
    });

    return {
      ok: false,
      state: "outcome_unknown",
      deliveredThisRun: 0,
      detail: `Unresolved in-flight delivery of ${label}.`,
    };
  }

  /* ---- what is left to buy ---- */

  const rawPlan: { supplierProductId: string; quantity: number }[] =
    claimed.fulfilmentPlan ?? [];

  const plan = rawPlan.map((part) => ({
    supplierProductId: part.supplierProductId as SupplierProductId,
    quantity: part.quantity,
  })) satisfies FulfilmentPart[];

  if (plan.length === 0) {
    /*
     * Paid, with no record of what delivers it. Not an error to swallow and
     * not something to guess from the catalogue: the plan is snapshotted at
     * purchase precisely so an order delivers what was agreed, and an order
     * without one has to be looked at by a person.
     */
    await releaseToPending(
      claimed._id,
      "This order has no fulfilment plan recorded, so nothing knows which supplier " +
        "packs deliver it. Deliver by hand and mark it fulfilled.",
    );
    console.error("[fulfilment] paid order has no fulfilment plan", { orderId });
    return {
      ok: false,
      state: "no_plan",
      deliveredThisRun: 0,
      detail: "No fulfilment plan on the order.",
    };
  }

  const outstanding = remainingCalls(plan, claimed.fulfilmentDeliveries ?? []);

  if (outstanding.length === 0) {
    // Everything already landed — a previous run delivered it all and failed
    // before it could mark the order. Finish the bookkeeping, buy nothing.
    await markFulfilled(claimed._id, "All packs were already delivered; order closed.");
    return {
      ok: true,
      state: "fulfilled",
      deliveredThisRun: 0,
      detail: "Nothing outstanding.",
    };
  }

  const game = await GameModel.findById(claimed.game).select("smileOneProduct").lean();
  if (!game) {
    await releaseToPending(
      claimed._id,
      "The game this order belongs to is missing from the database, so the supplier " +
        "call cannot be addressed. Needs investigation before delivery.",
    );
    return {
      ok: false,
      state: "no_plan",
      deliveredThisRun: 0,
      detail: "Order references a game that no longer exists.",
    };
  }

  /* ---- deliver, one pack at a time ---- */

  let delivered = 0;
  let anyStubbed = false;

  for (const supplierProductId of outstanding) {
    /*
     * The marker goes down BEFORE the request goes out. If this process dies
     * anywhere in the next few seconds, the next run finds it and stops rather
     * than re-buying a pack that may already have landed. Sequential, never
     * parallel: each call is an independent purchase, and a failure must stop
     * the rest instead of racing three more out the door.
     */
    await OrderModel.updateOne(
      { _id: claimed._id },
      { $set: { fulfilmentInFlight: { supplierProductId, startedAt: new Date() } } },
    );

    let result: { supplierOrderId: string; stubbed: boolean };
    try {
      result = await deliverOnePack({
        smileOneProduct: game.smileOneProduct,
        supplierProductId,
        playerId: claimed.playerId,
        zoneId: claimed.zoneId ?? "",
        callsAlreadyMadeThisRun: delivered,
      });
    } catch (error) {
      const label = SUPPLIER_PACKS[supplierProductId]?.label ?? supplierProductId;
      const message = error instanceof Error ? error.message : String(error);

      if (provesNothingWasDelivered(error)) {
        // A definite "no". Clear the marker so a retry is free to try again.
        await OrderModel.updateOne(
          { _id: claimed._id },
          { $set: { fulfilmentInFlight: null } },
        );

        const blockedByGate = error instanceof SmileOneSafetyError;

        await releaseToPending(
          claimed._id,
          blockedByGate
            ? `Automatic delivery is switched off (live-account safety gate), so ${label} ` +
                `was not sent. Deliver this order by hand from the SmileOne dashboard.`
            : `The supplier refused the ${label} purchase. Nothing was delivered for it. ` +
                `Safe to retry once the cause is known.`,
        );

        console.error("[fulfilment] supplier refused", {
          orderId,
          supplierProductId,
          deliveredThisRun: delivered,
          blockedByGate,
          detail: message,
        });

        return {
          ok: false,
          state: "supplier_refused",
          deliveredThisRun: delivered,
          detail: message,
        };
      }

      /*
       * Unknown. The marker deliberately stays set: it is the record that a
       * call went out and never reported back, and it is what stops the next
       * run — automatic or human — from buying the pack a second time.
       */
      await releaseToPending(
        claimed._id,
        `The ${label} purchase did not report back, so it is unknown whether it reached ` +
          `the player. Check the SmileOne dashboard before retrying.`,
      );

      console.error("[fulfilment] delivery outcome unknown", {
        orderId,
        supplierProductId,
        deliveredThisRun: delivered,
        detail: message,
      });

      return {
        ok: false,
        state: "outcome_unknown",
        deliveredThisRun: delivered,
        detail: message,
      };
    }

    /*
     * Landed. Record it and clear the marker in one write, so there is no
     * moment where the delivery is known but the marker still says a call is
     * outstanding.
     */
    await OrderModel.updateOne(
      { _id: claimed._id },
      {
        $push: {
          fulfilmentDeliveries: {
            supplierProductId,
            supplierOrderId: result.supplierOrderId,
            at: new Date(),
          },
        },
        $set: { fulfilmentInFlight: null },
      },
    );

    // Kept for continuity with the admin screen, which shows a single supplier
    // reference. Conditional so a composed order keeps the first one.
    await OrderModel.updateOne(
      { _id: claimed._id, smileOneOrderId: null },
      { $set: { smileOneOrderId: result.supplierOrderId } },
    );

    delivered += 1;
    anyStubbed ||= result.stubbed;
  }

  await markFulfilled(
    claimed._id,
    anyStubbed
      ? `Delivered ${delivered} pack(s) — DEVELOPMENT STUB, nothing was really sent.`
      : `Delivered ${delivered} pack(s) via SmileOne.`,
  );

  console.info("[fulfilment] order fulfilled", { orderId, packs: delivered, trigger });

  return {
    ok: true,
    state: "fulfilled",
    deliveredThisRun: delivered,
    detail: `Delivered ${delivered} pack(s).`,
  };
}

/* ------------------------------------------------------------------ */
/* Terminal writes                                                     */
/* ------------------------------------------------------------------ */

/**
 * Hands a claimed order to the admin queue. Conditional on `fulfilling` so it
 * can only ever release a claim this run actually holds.
 *
 * Note where it does NOT go: `failed`. The customer has paid, and the status
 * machine has no edge from `paid` to `failed` for exactly this reason (rule 8).
 */
async function releaseToPending(id: Types.ObjectId, note: string): Promise<void> {
  await OrderModel.updateOne(
    { _id: id, status: "fulfilling" },
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
}

async function markFulfilled(id: Types.ObjectId, note: string): Promise<void> {
  await OrderModel.updateOne(
    { _id: id, status: "fulfilling" },
    {
      $set: { status: "fulfilled", fulfilmentInFlight: null },
      $push: {
        statusHistory: {
          from: "fulfilling",
          to: "fulfilled",
          note: note.slice(0, 500),
          at: new Date(),
        },
      },
    },
  );
}

/* ------------------------------------------------------------------ */
/* Fire-and-forget trigger                                             */
/* ------------------------------------------------------------------ */

/**
 * Starts fulfilment without making the caller wait for it.
 *
 * The customer's return from PayFast is an HTTP request that should finish in
 * milliseconds, and a ten-pack combo is ten sequential supplier calls. Holding
 * the response open for that is a page that appears to hang at the exact
 * moment the customer is most anxious about whether their money arrived.
 *
 * Nothing is lost if this process dies mid-flight: the order stays `fulfilling`
 * with its progress recorded, and the sweeper at `/api/cron/fulfil-orders`
 * picks it up. This is a plain Node process on the production host, not a
 * function that is frozen the moment its response is sent — see CLAUDE.md.
 */
export function fulfilOrderInBackground(orderId: string, triggeredBy: string): void {
  void fulfilOrder(orderId, { triggeredBy }).catch((error: unknown) => {
    // Never rethrow into an unhandled rejection: the order's own status is the
    // durable record, and losing this log must not take the process down.
    console.error("[fulfilment] background run threw", {
      orderId,
      detail: error instanceof Error ? error.message : String(error),
    });
  });
}

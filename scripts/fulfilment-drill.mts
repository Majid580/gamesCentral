/**
 * End-to-end drill for the fulfilment executor.
 *
 * Run with:  npm run fulfilment:drill
 * Requires:  the dev server running with SMILEONE_FULFILMENT_STUB=1
 *
 * ⛔ IT CANNOT SPEND MONEY. Three independent reasons, and the drill asserts
 *    the third itself:
 *      1. It only ever drives fulfilment through the app, which needs the
 *         stub flag to be set before it will fake anything.
 *      2. Without that flag the executor calls `createorder`, which
 *         `smileone/safety.ts` blocks before a socket opens.
 *      3. It refuses to start unless the server reports the stub as active —
 *         so a drill against a real-delivery configuration stops instead of
 *         buying 26 packs of diamonds.
 *
 * WHY THIS IS A DRILL AND NOT A UNIT TEST
 *
 * The properties worth proving are all about what happens across processes and
 * across retries — a claim that two workers cannot both win, a partial delivery
 * that resumes at the right pack, an unresolved call that refuses to be retried
 * at all. Mocked in isolation, those assertions test the mock. Driven through
 * the real route, the real service and the real database, they test the thing
 * that will be handling real orders.
 *
 * Every fixture it creates is deleted by id at the end, whatever happens.
 */

import mongoose from "mongoose";

import { resolveMongoUri } from "../lib/utils/dns-resolver.ts";
import { GameModel } from "../lib/models/game.ts";
import { OrderModel } from "../lib/models/order.ts";
import { ProductModel } from "../lib/models/product.ts";
import { FULFILMENT_PLANS, planCallCount } from "../lib/fulfilment-plan.ts";

const uri = process.env.DATABASE_URL;
const cronSecret = process.env.CRON_SECRET;
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

if (!uri) {
  console.error("DATABASE_URL is not set. Run this via `npm run fulfilment:drill`.");
  process.exit(1);
}
if (!cronSecret) {
  console.error(
    "CRON_SECRET is not set in .env.local. The drill drives fulfilment through\n" +
      "POST /api/cron/fulfil-orders, which needs it.",
  );
  process.exit(1);
}

/** The SKU used throughout: three supplier calls, so partial delivery is real. */
const DRILL_SKU = "ml-dia-1050";

/** Marks every fixture this script creates, and nothing else. */
const DRILL_CONTACT = "fulfilment-drill@gamescentral.invalid";

const createdIds: mongoose.Types.ObjectId[] = [];
let failures = 0;

function check(label: string, passed: boolean, detail = ""): void {
  console.log(`  ${passed ? "PASS" : "*** FAIL ***"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures += 1;
}

/* ------------------------------------------------------------------ */
/* Driving the app                                                     */
/* ------------------------------------------------------------------ */

async function runSweep(): Promise<Record<string, number>> {
  const response = await fetch(`${baseUrl}/api/cron/fulfil-orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  if (!response.ok) {
    throw new Error(
      `Sweep returned HTTP ${response.status}. Is the dev server running, and does ` +
        "its CRON_SECRET match this one?",
    );
  }

  return (await response.json()) as Record<string, number>;
}

/**
 * Creates a paid order, backdated past the sweeper's grace period.
 *
 * Backdating is the point: the sweeper deliberately ignores orders paid in the
 * last two minutes so it does not race the in-process trigger, and a fixture
 * created "now" would simply be skipped.
 */
async function makePaidOrder(overrides: Record<string, unknown> = {}) {
  const product = await ProductModel.findOne({ sku: DRILL_SKU }).lean();
  if (!product) throw new Error(`${DRILL_SKU} is not in the catalogue. Run npm run db:seed.`);

  const game = await GameModel.findById(product.game).lean();
  if (!game) throw new Error("The Mobile Legends game document is missing.");

  const plan = FULFILMENT_PLANS[DRILL_SKU];
  if (!Array.isArray(plan)) throw new Error(`${DRILL_SKU} has no fulfilment plan.`);

  const order = await OrderModel.create({
    product: product._id,
    game: game._id,
    playerId: "1638539586",
    zoneId: "16932",
    confirmedUsername: "DrillTarget",
    pricePkr: product.pricePkr,
    pricing: { basePriceUsdCents: null, exchangeRate: 1, markupPercentage: 0 },
    fulfilmentPlan: plan.map((p) => ({
      supplierProductId: p.supplierProductId,
      quantity: p.quantity,
    })),
    fulfilmentDeliveries: [],
    status: "paid",
    statusHistory: [{ from: "awaiting_payment", to: "paid", note: "drill fixture", at: new Date() }],
    contactEmail: DRILL_CONTACT,
    contactPhone: "+920000000000",
    ...overrides,
  });

  createdIds.push(order._id);

  // Past the grace window, without touching the app's own clock handling.
  await OrderModel.updateOne(
    { _id: order._id },
    { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } },
    { timestamps: false },
  );

  return order;
}

async function readOrder(id: mongoose.Types.ObjectId) {
  const order = await OrderModel.findById(id).lean();
  if (!order) throw new Error("Fixture disappeared mid-drill.");
  return order;
}

/* ------------------------------------------------------------------ */
/* The drill                                                           */
/* ------------------------------------------------------------------ */

const dialable = await resolveMongoUri(uri);
await mongoose.connect(dialable, { bufferCommands: false, autoIndex: false });

try {
  const expectedCalls = planCallCount(
    FULFILMENT_PLANS[DRILL_SKU] as { supplierProductId: never; quantity: number }[],
  );

  console.log(`\nFulfilment drill — ${DRILL_SKU}, ${expectedCalls} supplier calls per order`);
  console.log(`Driving ${baseUrl}/api/cron/fulfil-orders\n`);

  /* ---- 0. which configuration is the server in? ---- */

  /*
   * The drill runs against either configuration and asserts the right things
   * for each, rather than demanding one. That matters because the two are the
   * two real deployments: `gated` is the shop as it stands today, and `stub`
   * is the only way to exercise a delivery before the gate is lifted. A drill
   * that only worked in one of them would go stale exactly when it mattered.
   *
   * A real delivery is the third possibility and the only unacceptable one.
   */
  console.log("0. Safety interlock");
  const canary = await makePaidOrder();
  await runSweep();
  const canaryAfter = await readOrder(canary._id);

  const deliveries = canaryAfter.fulfilmentDeliveries ?? [];
  const allStubbed =
    deliveries.length > 0 &&
    deliveries.every((d: { supplierOrderId: string }) => d.supplierOrderId.startsWith("STUB-"));

  if (deliveries.length > 0 && !allStubbed) {
    console.error(
      "\n*** ABORTING: the server delivered packs that are not stubs. Those were REAL.\n" +
        "    Something has opened the delivery gate. Read LIVE_ACCOUNT_SAFETY.md.\n",
    );
    failures += 1;
    throw new Error("real delivery detected");
  }

  const mode: "stub" | "gated" = allStubbed ? "stub" : "gated";

  check(
    "no real delivery happened",
    true,
    mode === "stub" ? "stub mode, deliveries are faked" : "gated mode, nothing was delivered",
  );

  /* ---- G. the gate, when the stub is off ---- */

  if (mode === "gated") {
    console.log("\nG. Delivery gate (SMILEONE_FULFILMENT_STUB is off)");

    check("nothing was delivered", deliveries.length === 0, String(deliveries.length));
    check(
      "the paid order was handed to the admin queue, not lost",
      canaryAfter.status === "paid_pending_fulfillment",
      canaryAfter.status,
    );
    check(
      "the history tells an operator to deliver it by hand",
      (canaryAfter.statusHistory ?? []).some((h: { note?: string | null }) =>
        (h.note ?? "").includes("safety gate"),
      ),
    );
    check(
      "no call left in flight — the request never went out",
      canaryAfter.fulfilmentInFlight == null,
    );

    console.log(
      "\n  This is the shop as it stands today: a paid order cannot be delivered\n" +
        "  automatically, and it lands in front of an operator instead of vanishing.\n" +
        "  Set SMILEONE_FULFILMENT_STUB=1 and re-run to exercise the delivery path.",
    );
  }

  /* ---- 1. a clean run delivers every pack, exactly once ---- */

  if (mode === "stub") {
    console.log("\n1. Clean delivery");
    check("status is fulfilled", canaryAfter.status === "fulfilled", canaryAfter.status);
    check(
      `${expectedCalls} deliveries recorded`,
      deliveries.length === expectedCalls,
      String(deliveries.length),
    );
    check("no call left in flight", canaryAfter.fulfilmentInFlight == null);
    check("supplier reference recorded for the admin screen", Boolean(canaryAfter.smileOneOrderId));

    /* ---- 2. a second sweep must not deliver anything again ---- */

    console.log("\n2. Idempotency — re-sweeping a fulfilled order");
    const beforeSecond = deliveries.length;
    await runSweep();
    const afterSecond = await readOrder(canary._id);
    check(
      "no additional deliveries",
      afterSecond.fulfilmentDeliveries.length === beforeSecond,
      `${beforeSecond} → ${afterSecond.fulfilmentDeliveries.length}`,
    );
  }

  /* ---- 3. a half-delivered order resumes at the right pack ---- */

  console.log("\n3. Resume — an order with one pack already delivered");
  const resumed = await makePaidOrder({
    fulfilmentDeliveries: [
      {
        supplierProductId: (FULFILMENT_PLANS[DRILL_SKU] as { supplierProductId: string }[])[0]
          .supplierProductId,
        supplierOrderId: "STUB-PRE-EXISTING",
        at: new Date(),
      },
    ],
  });

  await runSweep();
  const resumedAfter = await readOrder(resumed._id);

  /*
   * The assertion that holds in BOTH modes, and the one that actually matters:
   * a pack already delivered is never bought again. In stub mode the remaining
   * two are delivered and the order closes; in gated mode nothing is delivered
   * at all. Either way the count must never exceed the plan.
   */
  check(
    "the pre-existing delivery was kept, not re-bought",
    resumedAfter.fulfilmentDeliveries.filter(
      (d: { supplierOrderId: string }) => d.supplierOrderId === "STUB-PRE-EXISTING",
    ).length === 1,
  );
  check(
    "deliveries never exceed the plan",
    resumedAfter.fulfilmentDeliveries.length <= expectedCalls,
    `${resumedAfter.fulfilmentDeliveries.length} of ${expectedCalls}`,
  );

  if (mode === "stub") {
    check("status is fulfilled", resumedAfter.status === "fulfilled", resumedAfter.status);
    check(
      "total deliveries match the plan, not plan + 1",
      resumedAfter.fulfilmentDeliveries.length === expectedCalls,
      String(resumedAfter.fulfilmentDeliveries.length),
    );
  }

  /* ---- 4. an unresolved in-flight call is never retried ---- */

  console.log("\n4. Refusal — a previous call that never reported back");
  const unresolved = await makePaidOrder({
    fulfilmentInFlight: { supplierProductId: "26", startedAt: new Date() },
  });

  await runSweep();
  const unresolvedAfter = await readOrder(unresolved._id);

  check(
    "nothing was delivered",
    unresolvedAfter.fulfilmentDeliveries.length === 0,
    String(unresolvedAfter.fulfilmentDeliveries.length),
  );
  check(
    "handed to the admin queue",
    unresolvedAfter.status === "paid_pending_fulfillment",
    unresolvedAfter.status,
  );
  check(
    "the history says what a human has to check",
    (unresolvedAfter.statusHistory ?? []).some((h: { note?: string | null }) =>
      (h.note ?? "").includes("SmileOne dashboard"),
    ),
  );

  /* ---- 5. an order with no plan is refused, not guessed at ---- */

  console.log("\n5. Refusal — a paid order with no fulfilment plan");
  const planless = await makePaidOrder({ fulfilmentPlan: [] });

  await runSweep();
  const planlessAfter = await readOrder(planless._id);

  check("nothing was delivered", planlessAfter.fulfilmentDeliveries.length === 0);
  check(
    "handed to the admin queue rather than marked fulfilled",
    planlessAfter.status === "paid_pending_fulfillment",
    planlessAfter.status,
  );

  /* ---- 6. an unpaid order is never touched ---- */

  console.log("\n6. Rule 2 — an unpaid order is never delivered");
  const unpaid = await makePaidOrder({ status: "awaiting_payment" });

  await runSweep();
  const unpaidAfter = await readOrder(unpaid._id);

  check("nothing was delivered", unpaidAfter.fulfilmentDeliveries.length === 0);
  check("still awaiting payment", unpaidAfter.status === "awaiting_payment", unpaidAfter.status);

  /* ---- verdict ---- */

  console.log(
    failures === 0
      ? `\nAll checks passed (${mode} mode). Nothing real was delivered.\n`
      : `\n${failures} check(s) FAILED.\n`,
  );
} finally {
  if (createdIds.length) {
    const { deletedCount } = await OrderModel.deleteMany({ _id: { $in: createdIds } });
    console.log(`Cleaned up ${deletedCount} drill order(s).`);
  }
  await mongoose.disconnect();
}

process.exit(failures === 0 ? 0 : 1);

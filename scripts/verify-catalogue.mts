/**
 * Checks every catalogue product against its fulfilment plan.
 *
 * The SKU -> supplier-pack mapping is hand-written (see lib/fulfilment-plan.ts
 * for why), and a hand-written mapping of numbers is exactly the kind of thing
 * that goes wrong quietly: a `quantity: 2` mistyped as `1` halves a customer's
 * delivery and nothing complains. This does the arithmetic instead.
 *
 * Run:
 *   npm run catalogue:verify
 *
 * Exits non-zero on a mismatch so it can gate a deploy. Unmapped products are
 * reported but do not fail the run — they are open questions for the owner,
 * not defects, and they are blocked from being ordered at runtime anyway.
 *
 * Touches no network and no database. Pure arithmetic over two source files.
 */

import { MOBILE_LEGENDS_CATALOGUE } from "../lib/catalogue-source.ts";
import {
  SUPPLIER_PACKS,
  deliveredDiamonds,
  describePlan,
  isFullyDelivered,
  planForSku,
  remainingCalls,
  verifyFulfilmentPlans,
} from "../lib/fulfilment-plan.ts";

const checks = verifyFulfilmentPlans();

const ok = checks.filter((c) => c.status === "ok");
const unmapped = checks.filter((c) => c.status === "unmapped");
const broken = checks.filter((c) => c.status === "mismatch" || c.status === "missing");

console.log(`\nCatalogue: ${MOBILE_LEGENDS_CATALOGUE.length} products`);
console.log(`Supplier packs available: ${Object.keys(SUPPLIER_PACKS).length}\n`);

console.log("=== Fulfillable ===");
for (const check of ok) {
  const diamonds = check.expectedDiamonds > 0 ? `${check.expectedDiamonds} dia` : "pass";
  console.log(
    `  ${check.sku.padEnd(24)} ${diamonds.padStart(9)}  ${String(check.calls).padStart(2)} call(s)  ${check.detail}`,
  );
}

if (unmapped.length) {
  console.log("\n=== Unmapped — needs the owner ===");
  for (const check of unmapped) {
    console.log(`  ${check.sku} (${check.displayName})`);
    console.log(`    ${check.detail}`);
  }
}

if (broken.length) {
  console.log("\n=== BROKEN ===");
  for (const check of broken) {
    console.log(`  ${check.sku} (${check.displayName}) — ${check.status}`);
    console.log(`    ${check.detail}`);
  }
}

/* A plan that needs many calls is a plan with many chances to half-deliver. */
const heaviest = [...ok].sort((a, b) => b.calls - a.calls).slice(0, 3);
console.log("\n=== Most supplier calls per order ===");
for (const check of heaviest) {
  const plan = planForSku(check.sku);
  console.log(`  ${check.calls} calls  ${check.sku}  ${plan ? describePlan(plan) : ""}`);
}

/* ------------------------------------------------------------------ */
/* Retry logic — the half-delivered order                              */
/* ------------------------------------------------------------------ */

/*
 * The expensive failure is not a plan that is wrong, it is a plan that is
 * right and gets run twice. "1050 Diamonds" is three calls; if two land and
 * the third times out, a retry that repeats all three hands the customer 1050
 * free diamonds at the owner's expense. These cases assert it does not.
 */
console.log("=== Retry after a partial delivery ===");

const retryCases: { name: string; sku: string; delivered: string[]; expect: string[] }[] = [
  {
    name: "nothing delivered yet -> every call",
    sku: "ml-dia-1050",
    delivered: [],
    expect: ["26", "23", "23"],
  },
  {
    name: "first pack landed -> only the rest",
    sku: "ml-dia-1050",
    delivered: ["26"],
    expect: ["23", "23"],
  },
  {
    name: "one of two identical packs landed -> one left",
    sku: "ml-dia-1050",
    delivered: ["26", "23"],
    expect: ["23"],
  },
  {
    name: "all delivered -> no calls, no double-delivery",
    sku: "ml-dia-1050",
    delivered: ["26", "23", "23"],
    expect: [],
  },
  {
    name: "more delivered than planned -> still no calls",
    sku: "ml-dia-344",
    delivered: ["23", "23", "23"],
    expect: [],
  },
  {
    name: "10x weekly pass, 4 landed -> 6 left",
    sku: "ml-combo-10x-weekly",
    delivered: Array(4).fill("16642"),
    expect: Array(6).fill("16642"),
  },
];

let retryFailures = 0;
for (const testCase of retryCases) {
  const plan = planForSku(testCase.sku);
  if (!plan) {
    console.log(`  FAIL  ${testCase.name} — ${testCase.sku} has no plan`);
    retryFailures += 1;
    continue;
  }

  const deliveries = testCase.delivered.map((supplierProductId) => ({ supplierProductId }));
  const actual = remainingCalls(plan, deliveries);
  const pass = JSON.stringify(actual) === JSON.stringify(testCase.expect);
  if (!pass) retryFailures += 1;

  console.log(
    `  ${pass ? "PASS" : "FAIL"}  ${testCase.name}\n` +
      `        delivered ${JSON.stringify(testCase.delivered)} ` +
      `-> remaining ${JSON.stringify(actual)}` +
      (pass ? "" : ` (expected ${JSON.stringify(testCase.expect)})`),
  );
}

/* The operator-facing question when an order half-fails: what did they get? */
const halfPlan = planForSku("ml-dia-1050");
if (halfPlan) {
  const partial = [{ supplierProductId: "26" }, { supplierProductId: "23" }];
  console.log(
    `\n  A half-failed 1050 order: customer has ${deliveredDiamonds(partial)} of 1050 diamonds, ` +
      `fully delivered = ${isFullyDelivered(halfPlan, partial)}`,
  );
}

console.log(
  `\n${ok.length} fulfillable · ${unmapped.length} awaiting the owner · ${broken.length} broken`,
);
console.log(`${retryCases.length - retryFailures}/${retryCases.length} retry cases pass\n`);

if (broken.length) {
  console.error("FAILED: a plan does not deliver what the catalogue advertises.\n");
  process.exit(1);
}

if (retryFailures) {
  console.error("FAILED: retry logic would re-deliver a pack that already landed.\n");
  process.exit(1);
}

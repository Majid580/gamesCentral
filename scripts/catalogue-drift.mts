/**
 * Supplier drift check — has SmileOne changed anything under us?
 *
 * ⛔ READ-ONLY. Calls `productlist` and nothing else, through
 *    `assertEndpointPermitted()` — the same allowlist gate the application
 *    uses, so `createorder` cannot be reached from here even by accident.
 *    Spends nothing. Read LIVE_ACCOUNT_SAFETY.md before changing it.
 *
 * Run:
 *   npm run catalogue:drift
 *
 * WHY THIS EXISTS
 *
 * `SUPPLIER_PACKS` in lib/fulfilment-plan.ts is a hand-copied capture of
 * `productlist` taken on 2026-08-16, and every fulfilment plan is written
 * against it. Nothing has checked it since. That capture is the sole reason we
 * believe pack 13 is "78&8 Diamond" and therefore delivers 86 diamonds — and
 * if SmileOne renumbers, renames or re-specs a pack, nothing in this codebase
 * notices. `npm run catalogue:verify` will not: it is pure arithmetic over two
 * local files and never leaves the machine.
 *
 * The failure this catches is the quiet one. A pack that disappeared makes an
 * order fail loudly at delivery, which is bad but visible. A pack whose `spu`
 * changed from "78&8 Diamond" to something else keeps working perfectly and
 * delivers the wrong number of diamonds to a paying customer, indefinitely.
 *
 * Exits non-zero when a pack a fulfilment plan depends on has vanished or
 * changed, so it can gate a deploy.
 */

import { FULFILMENT_PLANS, SUPPLIER_PACKS } from "../lib/fulfilment-plan.ts";
import { assertEndpointPermitted } from "../lib/services/smileone/safety.ts";
import { toFormBody, withSignature } from "../lib/services/smileone/sign.ts";

const BASE = (process.env.SMILEONE_API_BASE_URL ?? "").replace(/\/+$/, "");
const UID = process.env.SMILEONE_UID ?? "";
const EMAIL = process.env.SMILEONE_EMAIL ?? "";
const KEY = process.env.SMILEONE_KEY ?? "";
const PRODUCT = process.argv[2] ?? "mobilelegends";

/** When SUPPLIER_PACKS was captured, for the report header. */
const CAPTURED_ON = "2026-08-16";

/**
 * Supplier prices in BRL, observed 2026-09-06 — a separate, later baseline
 * than SUPPLIER_PACKS, because the original capture did not record price.
 *
 * Deliberately kept here and not in lib/fulfilment-plan.ts. That module is the
 * money-critical mapping of what we deliver; this is a monitoring baseline for
 * what it costs, and the two drift on completely different schedules.
 *
 * Price movement is REPORTED, never a failure. The supplier is free to reprice
 * and usually will; nothing breaks when they do. What it costs is margin,
 * which is the owner's to judge — and nothing else in this codebase watches it.
 * `region-policy.ts` guards the per-ACCOUNT multiplier, which is a different
 * number entirely and would not move if SmileOne put the 9288 pack up by 12%.
 */
const BASELINE_PRICE_BRL: Record<string, number> = {
  "13": 6.25,
  "23": 12.5,
  "25": 18.67,
  "26": 50.0,
  "27": 150.0,
  "28": 250.0,
  "29": 375.0,
  "30": 625.0,
  "33": 41.25,
  "16642": 8.0,
  "22590": 4.0,
  "22591": 11.99,
  "22592": 19.75,
  "22593": 40.5,
  "26555": 4.0,
  "26556": 19.75,
};

/** Ignore rounding noise; report anything a person would call a price change. */
const PRICE_MOVE_THRESHOLD = 0.01;

if (!BASE || !UID || !EMAIL || !KEY) {
  console.error("Missing SmileOne env. Run with: npm run catalogue:drift");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Which packs we actually depend on                                   */
/* ------------------------------------------------------------------ */

/** supplierProductId -> the customer-facing SKUs whose delivery needs it. */
const dependants = new Map<string, string[]>();

for (const [sku, plan] of Object.entries(FULFILMENT_PLANS)) {
  for (const part of plan ?? []) {
    const list = dependants.get(part.supplierProductId) ?? [];
    list.push(sku);
    dependants.set(part.supplierProductId, list);
  }
}

/* ------------------------------------------------------------------ */
/* The one request                                                     */
/* ------------------------------------------------------------------ */

type RawProduct = { id?: unknown; spu?: unknown; price?: unknown };

async function fetchLiveProducts(): Promise<RawProduct[]> {
  const endpoint = "/smilecoin/api/productlist";

  // Same gate the app uses. A non-read-only endpoint never reaches the network.
  assertEndpointPermitted(endpoint);

  const body = withSignature({ uid: UID, email: EMAIL, product: PRODUCT }, KEY);

  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: toFormBody(body),
  });

  const text = await res.text();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`productlist returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  const envelope = json as { data?: { product?: RawProduct[] }; product?: RawProduct[] };
  const list = envelope?.data?.product ?? envelope?.product;

  if (!Array.isArray(list)) {
    throw new Error(`productlist had no product array: ${JSON.stringify(json).slice(0, 300)}`);
  }

  return list;
}

/* ------------------------------------------------------------------ */
/* Compare                                                             */
/* ------------------------------------------------------------------ */

const live = await fetchLiveProducts();
const liveById = new Map<string, { spu: string; price: string }>();

for (const p of live) {
  if (p.id === undefined || p.id === null) continue;
  liveById.set(String(p.id), { spu: String(p.spu ?? ""), price: String(p.price ?? "") });
}

console.log(`\nSupplier drift — productlist vs the ${CAPTURED_ON} capture\n`);
console.log(`  product           : ${PRODUCT}`);
console.log(`  packs live now    : ${liveById.size}`);
console.log(`  packs we recorded : ${Object.keys(SUPPLIER_PACKS).length}`);
console.log(`  packs relied on   : ${dependants.size} (referenced by a fulfilment plan)\n`);

const critical: string[] = [];
const warnings: string[] = [];
const priceMoves: string[] = [];

for (const [id, pack] of Object.entries(SUPPLIER_PACKS)) {
  const now = liveById.get(id);
  const needed = dependants.get(id) ?? [];
  const label = `${id.padEnd(6)} ${pack.label}`;

  if (!now) {
    const line =
      `[GONE]     ${label}\n` +
      `           recorded spu: ${pack.spu}\n` +
      `           the supplier no longer lists this id`;

    if (needed.length) {
      critical.push(`${line}\n           ⛔ delivery would FAIL for: ${needed.join(", ")}`);
    } else {
      warnings.push(`${line}\n           (no fulfilment plan uses it)`);
    }
    continue;
  }

  if (now.spu !== pack.spu) {
    const line = `[CHANGED]  ${label}\n           was: ${pack.spu}\n           now: ${now.spu}`;

    if (needed.length) {
      critical.push(
        `${line}\n           ⛔ CONTENTS MAY DIFFER from what we sell as: ${needed.join(", ")}\n` +
          `           Re-read the spu as paid&bonus before trusting any plan using it.`,
      );
    } else {
      warnings.push(`${line}\n           (no fulfilment plan uses it)`);
    }
    continue;
  }

  const was = BASELINE_PRICE_BRL[id];
  const nowPrice = Number(now.price);
  const moved =
    was !== undefined && Number.isFinite(nowPrice) && Math.abs(nowPrice - was) > PRICE_MOVE_THRESHOLD;

  console.log(`  [ok]       ${label.padEnd(34)} ${now.price}${moved ? "  <- price moved" : ""}`);

  if (moved) {
    const pct = ((nowPrice - was) / was) * 100;
    priceMoves.push(
      `${id.padEnd(6)} ${pack.label.padEnd(22)} ${was.toFixed(2)} -> ${nowPrice.toFixed(2)} BRL ` +
        `(${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` +
        (needed.length ? `\n           sold as: ${needed.join(", ")}` : ""),
    );
  }
}

const added = [...liveById.keys()].filter((id) => !(id in SUPPLIER_PACKS));

if (added.length) {
  console.log(`\n  New packs the supplier lists that we never recorded (${added.length}):`);
  for (const id of added) {
    const p = liveById.get(id);
    console.log(`  [new]      ${id.padEnd(6)} ${p?.spu}  ${p?.price}`);
  }
  console.log(
    "\n  Informational only. A new pack may allow a cheaper composition, but\n" +
      "  changing a plan is a money decision and belongs in a reviewed diff —\n" +
      "  see the header of lib/fulfilment-plan.ts on why this is data, not a solver.",
  );
}

if (priceMoves.length) {
  console.log(`\n  Supplier price movement since 2026-09-06 (${priceMoves.length}):\n`);
  for (const m of priceMoves) console.log(`  ${m}\n`);
  console.log(
    "  Not a failure — the supplier reprices and nothing breaks when they do.\n" +
      "  It is margin, and it is the only signal we get: our PKR prices are fixed\n" +
      "  in lib/catalogue-source.ts and do not move on their own. Worth a look if\n" +
      "  anything above rose sharply.\n",
  );
}

if (warnings.length) {
  console.log(`\n  Drift in packs nothing depends on (${warnings.length}):\n`);
  for (const w of warnings) console.log(`  ${w}\n`);
}

if (critical.length) {
  console.error(`\n  DRIFT IN PACKS WE DELIVER WITH (${critical.length}):\n`);
  for (const c of critical) console.error(`  ${c}\n`);
  console.error(
    "  Do not sell the affected products until the mapping is re-checked against\n" +
      "  the live spu strings. Update SUPPLIER_PACKS and FULFILMENT_PLANS together,\n" +
      "  then run npm run catalogue:verify.\n",
  );
  process.exit(1);
}

console.log("\n  No drift in anything a fulfilment plan depends on.\n");

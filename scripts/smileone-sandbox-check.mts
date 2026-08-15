/**
 * SmileOne sandbox probe.
 *
 * Verifies the double-MD5 signing and the two read-only endpoints against the
 * real sandbox before any of it is wired into the app. Everything downstream
 * (pricing, checkout, fulfilment) depends on the signature being correct, so
 * this is the cheapest place to find out that it isn't.
 *
 * Run:
 *   node --env-file=.env.local scripts/smileone-sandbox-check.mts
 *
 * Read-only: it calls productlist and getrole. It deliberately does NOT call
 * createorder, which spends real sandbox balance and creates an order.
 */

import {
  generateSmileOneSign,
  toFormBody,
  withSignature,
} from "../lib/services/smileone/sign.ts";

const BASE = process.env.SMILEONE_API_BASE_URL ?? "";
const UID = process.env.SMILEONE_UID ?? "";
const EMAIL = process.env.SMILEONE_EMAIL ?? "";
const KEY = process.env.SMILEONE_KEY ?? "";
const TEST_USERID = process.env.SMILEONE_TEST_USERID ?? "";
const TEST_ZONEID = process.env.SMILEONE_TEST_ZONEID ?? "";
const PRODUCT = process.argv[2] ?? "mobilelegends";

function assertEnv() {
  const missing = Object.entries({
    SMILEONE_API_BASE_URL: BASE,
    SMILEONE_UID: UID,
    SMILEONE_EMAIL: EMAIL,
    SMILEONE_KEY: KEY,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}`);
    console.error("Run with: node --env-file=.env.local scripts/smileone-sandbox-check.mts");
    process.exit(1);
  }
}

/** Signature determinism + ordering sanity check, with a known fixed key. */
function signSelfCheck() {
  console.log("\n=== 1. Signature self-check ===");

  const params = { b: "2", a: "1", c: "3" };
  const fixedKey = "testkey";

  const once = generateSmileOneSign(params, fixedKey);
  const twice = generateSmileOneSign({ c: "3", a: "1", b: "2" }, fixedKey);

  console.log(`  sorted-key independence : ${once === twice ? "PASS" : "FAIL"}`);
  console.log(`  signed string form      : a=1&b=2&c=3&${fixedKey}`);
  console.log(`  digest                  : ${once}`);
  console.log(`  is 32-char hex          : ${/^[0-9a-f]{32}$/.test(once) ? "PASS" : "FAIL"}`);

  let rejected = false;
  try {
    generateSmileOneSign({ a: "1", sign: "x" }, fixedKey);
  } catch {
    rejected = true;
  }
  console.log(`  rejects pre-set 'sign'  : ${rejected ? "PASS" : "FAIL"}`);
}

async function post(endpoint: string, params: Record<string, string | number>) {
  const body = withSignature(params, KEY);
  const url = `${BASE}${endpoint}`;

  // Log the request without ever printing the merchant key.
  const shown = { ...body, sign: `${String(body.sign).slice(0, 8)}…` };
  console.log(`  POST ${url}`);
  console.log(`  params ${JSON.stringify(shown)}`);

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: toFormBody(body),
  });
  const elapsed = Date.now() - started;

  const text = await res.text();
  console.log(`  -> HTTP ${res.status} in ${elapsed}ms`);

  try {
    return { ok: res.ok, json: JSON.parse(text) as unknown, raw: text };
  } catch {
    return { ok: res.ok, json: null, raw: text };
  }
}

async function checkProductList() {
  console.log("\n=== 2. productlist ===");
  const { json, raw } = await post("/smilecoin/api/productlist", {
    uid: UID,
    email: EMAIL,
    product: PRODUCT,
  });

  if (!json) {
    console.log(`  Non-JSON response (first 400 chars):\n  ${raw.slice(0, 400)}`);
    return null;
  }

  console.log(`  ${JSON.stringify(json).slice(0, 700)}`);

  const list = (json as { data?: { product?: unknown[] }; product?: unknown[] })
    ?.data?.product ?? (json as { product?: unknown[] })?.product;

  if (Array.isArray(list)) {
    console.log(`\n  Parsed ${list.length} products. First 3:`);
    for (const p of list.slice(0, 3)) console.log(`    ${JSON.stringify(p)}`);
  }
  return json;
}

async function checkGetRole() {
  console.log("\n=== 3. getrole ===");
  if (!TEST_USERID || !TEST_ZONEID) {
    console.log("  Skipped: SMILEONE_TEST_USERID / SMILEONE_TEST_ZONEID not set.");
    return null;
  }

  const { json, raw } = await post("/smilecoin/api/getrole", {
    uid: UID,
    email: EMAIL,
    product: PRODUCT,
    productid: process.env.SMILEONE_TEST_PRODUCTID ?? "212",
    userid: TEST_USERID,
    zoneid: TEST_ZONEID,
  });

  if (!json) {
    console.log(`  Non-JSON response (first 400 chars):\n  ${raw.slice(0, 400)}`);
    return null;
  }

  console.log(`  ${JSON.stringify(json)}`);
  console.log(
    "\n  NOTE: inspect `change_price` (final-charge source of truth when present)",
  );
  console.log("        and the undocumented `use` field in the payload above.");
  return json;
}

async function main() {
  assertEnv();
  console.log(`SmileOne sandbox probe — base=${BASE} product=${PRODUCT}`);
  signSelfCheck();
  await checkProductList();
  await checkGetRole();
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("\nProbe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

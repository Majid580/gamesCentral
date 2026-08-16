/**
 * SmileOne live-account probe — READ-ONLY.
 *
 * ⛔ This talks to the owner's REAL SmileOne account holding REAL purchased
 *    diamonds. Read LIVE_ACCOUNT_SAFETY.md before changing anything here.
 *
 * It calls exactly two endpoints, both of which only read:
 *   - productlist : lists the catalogue
 *   - getrole     : looks up a player's in-game name  <- the thing being tested
 *
 * It does NOT call `createorder`, and it CANNOT be edited into calling it by
 * accident: every request goes through `assertEndpointPermitted()`, the same
 * allowlist gate the app uses. Do not weaken that gate.
 *
 * Run:
 *   npm run smileone:probe
 *   npm run smileone:probe -- mobilelegends <playerId> <zoneId>
 *
 * Player ID and Zone ID may also come from SMILEONE_TEST_USERID /
 * SMILEONE_TEST_ZONEID in .env.local.
 */

import { assertEndpointPermitted } from "../lib/services/smileone/safety.ts";
import {
  generateSmileOneSign,
  toFormBody,
  withSignature,
} from "../lib/services/smileone/sign.ts";

const BASE = (process.env.SMILEONE_API_BASE_URL ?? "").replace(/\/+$/, "");
const UID = process.env.SMILEONE_UID ?? "";
const EMAIL = process.env.SMILEONE_EMAIL ?? "";
const KEY = process.env.SMILEONE_KEY ?? "";

const PRODUCT = process.argv[2] ?? "mobilelegends";
const TEST_USERID = process.argv[3] ?? process.env.SMILEONE_TEST_USERID ?? "";
const TEST_ZONEID = process.argv[4] ?? process.env.SMILEONE_TEST_ZONEID ?? "";

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
    console.error("Run with: npm run smileone:probe");
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

/** Proves the delivery gate is live before any real request is sent. */
function safetyGateSelfCheck() {
  console.log("\n=== 2. Live-account safety gate ===");

  let blocked = false;
  try {
    assertEndpointPermitted("/smilecoin/api/createorder");
  } catch {
    blocked = true;
  }
  console.log(`  createorder blocked     : ${blocked ? "PASS" : "*** FAIL ***"}`);
  console.log(`  getrole permitted       : ${permitted("/smilecoin/api/getrole") ? "PASS" : "FAIL"}`);
  console.log(`  productlist permitted   : ${permitted("/smilecoin/api/productlist") ? "PASS" : "FAIL"}`);

  if (!blocked) {
    console.error(
      "\n  ABORTING. The delivery gate is not blocking createorder, which means " +
        "this account\n  can spend real money. Restore it before running anything " +
        "else — see LIVE_ACCOUNT_SAFETY.md.",
    );
    process.exit(1);
  }
}

function permitted(endpoint: string): boolean {
  try {
    assertEndpointPermitted(endpoint);
    return true;
  } catch {
    return false;
  }
}

async function post(endpoint: string, params: Record<string, string | number>) {
  // Same gate the app uses. A non-read-only endpoint never reaches the network.
  assertEndpointPermitted(endpoint);

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

type RawProduct = { id?: unknown; spu?: unknown; price?: unknown };

async function checkProductList(): Promise<RawProduct[] | null> {
  console.log("\n=== 3. productlist (read-only) ===");
  const { json, raw } = await post("/smilecoin/api/productlist", {
    uid: UID,
    email: EMAIL,
    product: PRODUCT,
  });

  if (!json) {
    console.log(`  Non-JSON response (first 400 chars):\n  ${raw.slice(0, 400)}`);
    return null;
  }

  const envelope = json as {
    status?: unknown;
    message?: unknown;
    data?: { product?: RawProduct[] };
    product?: RawProduct[];
  };
  const list = envelope?.data?.product ?? envelope?.product;

  // Recorded so the zod schemas in client.ts can be tightened from the real
  // shape instead of the defensive union written before the API was reachable.
  console.log(`  envelope keys: ${JSON.stringify(Object.keys(envelope ?? {}))}`);
  console.log(`  status: ${String(envelope?.status)}  message: ${String(envelope?.message)}`);

  if (!Array.isArray(list)) {
    console.log(`  Unexpected shape: ${JSON.stringify(json).slice(0, 700)}`);
    return null;
  }

  console.log(`  Parsed ${list.length} products:`);
  for (const p of list) console.log(`    ${JSON.stringify(p)}`);
  return list;
}

async function checkGetRole(productId: string) {
  console.log("\n=== 4. getrole — PLAYER NAME LOOKUP (read-only) ===");

  if (!TEST_USERID || !TEST_ZONEID) {
    console.log("  SKIPPED — no Player ID / Zone ID supplied.");
    console.log("  Provide a real Mobile Legends account to test the name lookup:");
    console.log("    npm run smileone:probe -- mobilelegends <playerId> <zoneId>");
    console.log("  (or set SMILEONE_TEST_USERID / SMILEONE_TEST_ZONEID in .env.local)");
    return null;
  }

  console.log(`  Looking up Player ID ${TEST_USERID}, Zone ID ${TEST_ZONEID}`);

  const { json, raw } = await post("/smilecoin/api/getrole", {
    uid: UID,
    email: EMAIL,
    product: PRODUCT,
    productid: process.env.SMILEONE_TEST_PRODUCTID ?? productId,
    userid: TEST_USERID,
    zoneid: TEST_ZONEID,
  });

  if (!json) {
    console.log(`  Non-JSON response (first 400 chars):\n  ${raw.slice(0, 400)}`);
    return null;
  }

  console.log(`  ${JSON.stringify(json)}`);

  const data = (json as { data?: Record<string, unknown> }).data ??
    (json as Record<string, unknown>);
  const username = data?.username;

  console.log("\n  ---------------------------------------------");
  console.log(`  IN-GAME NAME : ${username ?? "(none returned)"}`);
  console.log(`  ZONE         : ${data?.zone ?? "(none)"}`);
  console.log(`  change_price : ${data?.change_price ?? "(none)"}`);
  console.log(`  use          : ${JSON.stringify(data?.use) ?? "(none)"}`);
  console.log("  ---------------------------------------------");
  console.log(
    username
      ? "  ^ Confirm with the owner that this is the correct player."
      : "  ^ No username returned — check the Player ID / Zone ID and the product id.",
  );

  return json;
}

async function main() {
  assertEnv();
  console.log("SmileOne LIVE-ACCOUNT probe — read-only (productlist + getrole).");
  console.log("createorder is blocked; no diamonds can be spent by this script.");
  console.log(`base=${BASE} product=${PRODUCT} uid=${UID}`);

  signSelfCheck();
  safetyGateSelfCheck();

  const products = await checkProductList();

  // Prefer a real product id from the live catalogue over a hardcoded guess.
  const firstId = products?.[0]?.id;
  await checkGetRole(firstId != null ? String(firstId) : "212");

  console.log("\nDone. No delivery endpoint was called.\n");
}

main().catch((err) => {
  console.error("\nProbe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

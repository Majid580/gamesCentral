/**
 * SmileOne REGION probe — READ-ONLY.
 *
 * ⛔ This talks to the owner's REAL SmileOne account holding REAL purchased
 *    diamonds. Read LIVE_ACCOUNT_SAFETY.md before changing anything here.
 *
 * It calls exactly ONE endpoint — `getrole` — which only reads. It does NOT
 * call `createorder`, and it cannot be edited into calling it by accident:
 * every request goes through `assertEndpointPermitted()`, the same allowlist
 * gate the app uses. Do not weaken that gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * We need to know whether a Player ID + Zone ID can be resolved to a COUNTRY,
 * so accounts from regions that cost more than our listed price can be turned
 * away before payment. MLBB Zone IDs do not encode country — but `getrole`
 * returns three undocumented fields that might:
 *
 *   zone                 NOT an echo of the zoneid we send (16932 -> 1). A
 *                        small integer that ignores our input is the shape a
 *                        region/server-group index would take.
 *   id_change_price_info per-product [{product_id, change_price}]. Observed as
 *                        all 1 except one product at 1.0043 — they read as
 *                        cost MULTIPLIERS, which is how a supplier expresses a
 *                        regional price adjustment.
 *   use                  observed as the string "c". Undocumented.
 *
 * `lib/services/smileone/client.ts` narrows getrole to the fields the app
 * needs and throws the rest away — correct for production, useless here. This
 * script prints the payload verbatim so the question can be settled from data
 * instead of from a forum spreadsheet.
 *
 * READING THE RESULT
 * ------------------
 * One account proves nothing. The signal only appears in the DIFFERENCES
 * between accounts whose country you already know. Probe several, labelled,
 * and compare across the columns.
 *
 * Run:
 *   npm run smileone:region -- 1638539586:16932:PK-owner 1234567:2001:ID-known
 *
 * Each argument is playerId:zoneId[:label]. Requests are sequential with a
 * pause between them — a burst against the merchant account risks SmileOne
 * throttling us, which is the one failure this probe must not cause.
 */

import { assertEndpointPermitted } from "../lib/services/smileone/safety.ts";
import { toFormBody, withSignature } from "../lib/services/smileone/sign.ts";

const BASE = (process.env.SMILEONE_API_BASE_URL ?? "").replace(/\/+$/, "");
const UID = process.env.SMILEONE_UID ?? "";
const EMAIL = process.env.SMILEONE_EMAIL ?? "";
const KEY = process.env.SMILEONE_KEY ?? "";

const PRODUCT = process.env.SMILEONE_PROBE_PRODUCT ?? "mobilelegends";

/** Confirmed present in the live productlist (78&8 Diamond). */
const PRODUCT_ID = process.env.SMILEONE_PROBE_PRODUCTID ?? "13";

/** Courtesy gap between lookups. The merchant account is shared with the shop. */
const PAUSE_MS = 1_500;

type Target = { playerId: string; zoneId: string; label: string };

type Row = {
  label: string;
  playerId: string;
  zoneId: string;
  httpStatus: number | string;
  upstreamStatus: string;
  username: string;
  zone: string;
  changePrice: string;
  use: string;
  /** product_id=change_price, only the entries that are not exactly 1. */
  multipliers: string;
  productCount: number | string;
};

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
    console.error("Run with: npm run smileone:region -- <playerId>:<zoneId>[:label] …");
    process.exit(1);
  }
}

/** Proves the delivery gate is live before any real request is sent. */
function safetyGateSelfCheck() {
  let blocked = false;
  try {
    assertEndpointPermitted("/smilecoin/api/createorder");
  } catch {
    blocked = true;
  }

  if (!blocked) {
    console.error(
      "ABORTING. The delivery gate is not blocking createorder, which means this\n" +
        "account can spend real money. Restore it before running anything else —\n" +
        "see LIVE_ACCOUNT_SAFETY.md.",
    );
    process.exit(1);
  }
  console.log("  safety gate: createorder blocked, getrole permitted — OK");
}

function parseTargets(argv: string[]): Target[] {
  const targets: Target[] = [];

  for (const arg of argv) {
    const [playerId, zoneId, ...rest] = arg.split(":");
    if (!playerId || !zoneId) {
      console.error(`Unparseable target "${arg}" — expected playerId:zoneId[:label]`);
      process.exit(1);
    }
    targets.push({
      playerId,
      zoneId,
      label: rest.join(":") || `${playerId}/${zoneId}`,
    });
  }

  return targets;
}

async function getRoleRaw(target: Target) {
  const endpoint = "/smilecoin/api/getrole";

  // Same gate the app uses. A non-read-only endpoint never reaches the network.
  assertEndpointPermitted(endpoint);

  const body = withSignature(
    {
      uid: UID,
      email: EMAIL,
      product: PRODUCT,
      productid: PRODUCT_ID,
      userid: target.playerId,
      zoneid: target.zoneId,
    },
    KEY,
  );

  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: toFormBody(body),
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* left null; the raw text is printed instead */
  }

  return { httpStatus: res.status, json, raw: text };
}

function summarise(target: Target, result: Awaited<ReturnType<typeof getRoleRaw>>): Row {
  const envelope = (result.json ?? {}) as Record<string, unknown>;
  const data = (envelope.data ?? envelope) as Record<string, unknown>;

  const info = data.id_change_price_info;
  let multipliers = "—";
  let productCount: number | string = "—";

  if (Array.isArray(info)) {
    productCount = info.length;
    const notOne = info
      .map((e) => e as { product_id?: unknown; change_price?: unknown })
      .filter((e) => String(e.change_price) !== "1")
      .map((e) => `${String(e.product_id)}=${String(e.change_price)}`);
    multipliers = notOne.length ? notOne.join(" ") : "all 1";
  }

  return {
    label: target.label,
    playerId: target.playerId,
    zoneId: target.zoneId,
    httpStatus: result.httpStatus,
    upstreamStatus: String(envelope.status ?? "—"),
    username: String(data.username ?? "—"),
    zone: String(data.zone ?? "—"),
    changePrice: String(data.change_price ?? "—"),
    use: String(data.use ?? "—"),
    multipliers,
    productCount,
  };
}

function printTable(rows: Row[]) {
  console.log("\n=== Comparison ===\n");
  console.log(
    "Look ACROSS the columns, not down them. A field that differs between two\n" +
      "accounts of known-different countries is a region signal. A field that is\n" +
      "identical everywhere is not, however promising it looked.\n",
  );

  const cols: Array<[string, (r: Row) => string]> = [
    ["label", (r) => r.label],
    ["zoneId", (r) => r.zoneId],
    ["http", (r) => String(r.httpStatus)],
    ["status", (r) => r.upstreamStatus],
    ["username", (r) => r.username],
    ["zone", (r) => r.zone],
    ["change_price", (r) => r.changePrice],
    ["use", (r) => r.use],
    ["#prods", (r) => String(r.productCount)],
    ["multipliers != 1", (r) => r.multipliers],
  ];

  const widths = cols.map(([head, get]) =>
    Math.max(head.length, ...rows.map((r) => get(r).length)),
  );

  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();

  console.log(line(cols.map(([h]) => h)));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(cols.map(([, get]) => get(r))));
}

async function main() {
  console.log("SmileOne REGION probe — getrole only, nothing is purchased.\n");
  assertEnv();
  safetyGateSelfCheck();

  const targets = parseTargets(process.argv.slice(2));
  if (!targets.length) {
    console.error("\nNo targets. Usage:");
    console.error("  npm run smileone:region -- <playerId>:<zoneId>[:label] …");
    console.error("\nExample:");
    console.error("  npm run smileone:region -- 1638539586:16932:PK-owner 123456:2001:ID-test");
    process.exit(1);
  }

  console.log(`  product=${PRODUCT} productid=${PRODUCT_ID}`);
  console.log(`  ${targets.length} account(s) to look up\n`);

  const rows: Row[] = [];

  for (const [i, target] of targets.entries()) {
    console.log(`=== ${i + 1}/${targets.length}  ${target.label} ===`);
    console.log(`  userid=${target.playerId} zoneid=${target.zoneId}`);

    const result = await getRoleRaw(target);
    console.log(`  -> HTTP ${result.httpStatus}`);
    console.log("  raw response:");
    console.log(
      result.json
        ? JSON.stringify(result.json, null, 2)
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n")
        : `    (non-JSON) ${result.raw.slice(0, 400)}`,
    );

    rows.push(summarise(target, result));

    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }

  printTable(rows);

  if (rows.length === 1) {
    console.log(
      "\nOnly one account probed — this is a BASELINE, not an answer. The region\n" +
        "signal is only visible as a difference against an account from another\n" +
        "country. Re-run with several labelled accounts to settle it.",
    );
  }
}

await main();

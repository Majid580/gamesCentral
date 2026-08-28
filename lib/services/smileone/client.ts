import "server-only";

import { z } from "zod";

import { requireEnv } from "@/lib/env";
import { assertEndpointPermitted } from "@/lib/services/smileone/safety";
import { toFormBody, withSignature } from "@/lib/services/smileone/sign";

/**
 * SmileOne API client.
 *
 * ⛔ THIS TALKS TO THE OWNER'S LIVE ACCOUNT, HOLDING REAL DIAMONDS.
 * Read `LIVE_ACCOUNT_SAFETY.md` before adding an endpoint here. Only the two
 * read-only lookups below are permitted; `createorder` and anything else that
 * delivers is blocked by `./safety.ts` and stays blocked until PayFast is
 * wired and the owner lifts the gate in person.
 *
 * REQUEST side is verified: the double-MD5 signing in `./sign.ts` has been
 * checked for sorted-key independence, digest shape, and misuse rejection.
 *
 * RESPONSE side is confirmed for the endpoints exercised by
 * `npm run smileone:probe` against the live account, and left defensive
 * elsewhere: the schemas accept the documented fields, tolerate the two
 * plausible envelope shapes, and log the actual payload shape on a mismatch
 * instead of throwing an opaque error.
 *
 * Nothing here returns a raw upstream response to a caller (Section 12.14) —
 * every function narrows to the fields the app actually needs.
 */

const REQUEST_TIMEOUT_MS = 12_000;

function config() {
  return {
    baseUrl: requireEnv("SMILEONE_API_BASE_URL").replace(/\/+$/, ""),
    uid: requireEnv("SMILEONE_UID"),
    email: requireEnv("SMILEONE_EMAIL"),
    key: requireEnv("SMILEONE_KEY"),
  };
}

export class SmileOneError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly status?: number,
    /**
     * The application-level `status` from the response envelope, as opposed to
     * the HTTP status. Present only when the upstream answered with HTTP 200
     * but reported a failure in the body.
     */
    readonly upstreamStatus?: string,
  ) {
    super(message);
    this.name = "SmileOneError";
  }
}

/**
 * Unwraps the response envelope, confirmed live as
 * `{ status: 200, message: "success", data: … }`.
 *
 * A non-200 `status` is an application-level failure that still arrives as
 * HTTP 200, so it has to be detected here or it surfaces downstream as an
 * uninformative "shape mismatch". The upstream message is kept for the server
 * log only — the controller never forwards it to the browser (rule 7).
 */
function unwrapEnvelope(payload: unknown, endpoint: string): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const envelope = payload as { status?: unknown; message?: unknown; data?: unknown };

  if (envelope.status !== undefined && String(envelope.status) !== "200") {
    throw new SmileOneError(
      `${endpoint} reported status ${String(envelope.status)}: ${String(envelope.message ?? "no message")}`,
      endpoint,
      undefined,
      String(envelope.status),
    );
  }

  return "data" in envelope ? envelope.data : payload;
}

/**
 * Signs and dispatches a request. The merchant key never leaves this module,
 * and is never included in a thrown error or a log line.
 */
async function smileOneRequest(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<unknown> {
  // Live-account gate, before anything is dispatched. See ./safety.ts.
  assertEndpointPermitted(endpoint);

  const { baseUrl, key } = config();
  const url = `${baseUrl}${endpoint}`;

  // Signature is generated immediately before dispatch — it expires in ~5 min.
  const body = withSignature(params, key);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: toFormBody(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "unknown";
    throw new SmileOneError(`Network failure calling ${endpoint}: ${reason}`, endpoint);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new SmileOneError(
      `Upstream returned HTTP ${response.status} for ${endpoint}`,
      endpoint,
      response.status,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SmileOneError(
      `Non-JSON response from ${endpoint} (first 200 chars: ${text.slice(0, 200)})`,
      endpoint,
      response.status,
    );
  }
}

/* ------------------------------------------------------------------ */
/* productlist                                                         */
/* ------------------------------------------------------------------ */

/**
 * A single catalogue entry. `id`, `spu` and `price` are documented; the live
 * API also returns `cost_price` and `discount`, which zod ignores by default
 * and which nothing here needs — our prices are owner-set, not derived.
 */
const rawProductSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  /**
   * Inconsistent, abbreviated supplier string such as
   * "mobilelegends BR 78&8 Diamond". Never displayed to a customer — the
   * admin-curated display name is used instead (Section 8).
   */
  spu: z.string(),
  price: z.union([z.string(), z.number()]),
});

/** Post-unwrap shape, confirmed live: `data` is `{ product: [...] }`. */
const productListSchema = z.union([
  z.object({ product: z.array(rawProductSchema) }),
  z.array(rawProductSchema),
]);

export type SmileOneProduct = {
  smileOneProductId: string;
  spu: string;
  /** Supplier price as a string, parsed to a precise value by the pricing service. */
  rawPrice: string;
};

export async function fetchProductList(
  product: string,
): Promise<SmileOneProduct[]> {
  const { uid, email } = config();
  const payload = await smileOneRequest("/smilecoin/api/productlist", {
    uid,
    email,
    product,
  });

  const data = unwrapEnvelope(payload, "/smilecoin/api/productlist");

  const parsed = productListSchema.safeParse(data);
  if (!parsed.success) {
    // Log the shape, never the contents, so the schema can be corrected.
    console.error("[smileone] productlist shape mismatch", {
      topLevelKeys:
        data && typeof data === "object" && !Array.isArray(data)
          ? Object.keys(data)
          : typeof data,
    });
    throw new SmileOneError(
      "productlist response did not match any expected shape",
      "/smilecoin/api/productlist",
    );
  }

  const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.product;

  return list.map((p) => ({
    smileOneProductId: p.id,
    spu: p.spu,
    rawPrice: String(p.price),
  }));
}

/* ------------------------------------------------------------------ */
/* getrole                                                             */
/* ------------------------------------------------------------------ */

/**
 * Application-level status for "no such account", confirmed live: the upstream
 * answers HTTP 200 with `{"status":20003,"message":"USER ID ou Zone ID não
 * existe"}`. A wrong Player ID and a wrong Zone ID produce the identical
 * response, so it is not possible to tell the customer which of the two is at
 * fault — only that the pair does not match an account.
 */
const ACCOUNT_NOT_FOUND_STATUS = "20003";

const getRoleSchema = z.object({
  username: z.string().optional(),
  /**
   * NOT an echo of the zoneid we sent — a real lookup on zone 16932 came back
   * `zone: 1`. Whatever it means, it is not the customer's Zone ID and must
   * never be displayed as one.
   */
  zone: z.union([z.string(), z.number()]).optional(),
  /**
   * A MULTIPLIER on the catalogue price for this specific account — not a
   * price. Confirmed live 2026-08-28: the owner's own account returns `1`, and
   * no diamond pack costs 1 BRL. Anything that computes a final charge must
   * MULTIPLY by this, never substitute it.
   *
   * A value above 1 is the supplier charging us more to serve this particular
   * account, which is how a costlier region shows up in our data. That is what
   * `lib/services/region-policy.ts` gates on.
   */
  change_price: z.union([z.string(), z.number()]).optional(),
  /** Undocumented in the supplied PDF. Observed live as the string "c". */
  use: z.unknown().optional(),
  /**
   * Undocumented per-product multipliers, same meaning as `change_price` but
   * specific to one SKU. Observed live as 11 entries, all `1` except product
   * 25 at `1.0043`.
   *
   * Entries are tolerated rather than required: the array has listed
   * product_ids (20340, 16642) that are absent from `productlist`, so it is
   * not a mirror of the catalogue and must not be treated as one.
   */
  id_change_price_info: z
    .array(
      z.object({
        product_id: z.union([z.string(), z.number()]).optional(),
        change_price: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional(),
});


export type RoleLookup = {
  /** The in-game username shown to the customer for confirmation. */
  username: string | null;
  zone: string | null;
  /** Multiplier on the catalogue price, not a price. See the schema above. */
  changePrice: string | null;
  /** Logged during sandbox testing to determine what this field means. */
  rawUseField: unknown;
  /**
   * Per-product multipliers, server-side only. Never widened to the browser —
   * it is supplier cost data (rule 7).
   */
  priceMultipliers: Array<{ productId: string; multiplier: number }>;
};

/**
 * Verifies that a Player ID + Zone ID maps to a real account and returns its
 * in-game username. This is the main defence against a mistyped ID sending
 * diamonds to a stranger, and must never be skipped in the checkout flow.
 */
export async function getRole(args: {
  product: string;
  productId: string;
  userId: string;
  zoneId: string;
}): Promise<RoleLookup> {
  const { uid, email } = config();

  const payload = await smileOneRequest("/smilecoin/api/getrole", {
    uid,
    email,
    product: args.product,
    productid: args.productId,
    userid: args.userId,
    zoneid: args.zoneId,
  });

  let unwrapped: unknown;
  try {
    unwrapped = unwrapEnvelope(payload, "/smilecoin/api/getrole");
  } catch (error) {
    /*
     * A no-such-account answer is an ordinary outcome of a customer typo, not
     * an upstream failure, and the two demand opposite instructions: "check
     * your Player ID" versus "we're having trouble, try again shortly".
     * Separating them here is what lets checkout say the right one.
     */
    if (
      error instanceof SmileOneError &&
      error.upstreamStatus === ACCOUNT_NOT_FOUND_STATUS
    ) {
      return {
        username: null,
        zone: null,
        changePrice: null,
        rawUseField: undefined,
        priceMultipliers: [],
      };
    }
    throw error;
  }

  const parsed = getRoleSchema.safeParse(unwrapped);
  if (!parsed.success) {
    console.error("[smileone] getrole shape mismatch", {
      topLevelKeys:
        unwrapped && typeof unwrapped === "object"
          ? Object.keys(unwrapped as object)
          : typeof unwrapped,
    });
    throw new SmileOneError(
      "getrole response did not match any expected shape",
      "/smilecoin/api/getrole",
    );
  }

  const data = parsed.data;

  return {
    username: data.username ?? null,
    zone: data.zone != null ? String(data.zone) : null,
    changePrice: data.change_price != null ? String(data.change_price) : null,
    rawUseField: data.use,
    /*
     * Unparseable entries are dropped rather than defaulted to 1. A silent 1
     * reads as "this account costs list price", which is exactly the claim we
     * are not entitled to make about a value we could not read.
     */
    priceMultipliers: (data.id_change_price_info ?? []).flatMap((entry) => {
      if (entry.product_id == null || entry.change_price == null) return [];
      const multiplier = Number(entry.change_price);
      if (!Number.isFinite(multiplier)) return [];
      return [{ productId: String(entry.product_id), multiplier }];
    }),
  };
}

/* ------------------------------------------------------------------ */
/* createorder — ⛔ DELIVERS DIAMONDS. SPENDS THE OWNER'S MONEY.        */
/* ------------------------------------------------------------------ */

/**
 * ⛔ THIS IS THE FUNCTION THAT SPENDS MONEY. READ `LIVE_ACCOUNT_SAFETY.md`.
 *
 * Buys one supplier pack and delivers it into a player's account. The delivery
 * is instant, irreversible, and paid for out of the owner's real SmileOne
 * balance. There is no sandbox and no test balance — the only host that works
 * is production.
 *
 * IT CANNOT RUN TODAY, BY DESIGN. `smileOneRequest` calls
 * `assertEndpointPermitted` before dispatching anything, and
 * `/smilecoin/api/createorder` is not on the read-only allowlist, so this
 * throws `SmileOneSafetyError` before a socket is opened. That is the intended
 * behaviour until PayFast is verified end-to-end and the owner lifts the gate
 * in person. Do not set `SMILEONE_ALLOW_FULFILMENT` to "check the response
 * shape" — that check costs a pack of diamonds and cannot be undone.
 *
 * It is written now so the fulfilment path is complete and reviewable rather
 * than being invented under time pressure on the day payments go live.
 *
 * NOT IDEMPOTENT UPSTREAM. The parameter list the brief documents
 * (`email, uid, userid, zoneid, product, productid, time, sign`) has nowhere
 * to put our own order id, so calling twice buys twice. Every idempotency
 * guarantee this app makes is therefore ours to keep, in
 * `lib/services/fulfilment.ts` — never assume the supplier will de-duplicate.
 */
export async function createSupplierOrder(args: {
  product: string;
  productId: string;
  userId: string;
  zoneId: string;
}): Promise<{ supplierOrderId: string }> {
  const { uid, email } = config();

  const payload = await smileOneRequest("/smilecoin/api/createorder", {
    uid,
    email,
    product: args.product,
    productid: args.productId,
    userid: args.userId,
    zoneid: args.zoneId,
  });

  const data = unwrapEnvelope(payload, "/smilecoin/api/createorder");

  /*
   * `order_id` is the documented field, and the envelope shape is confirmed
   * live for the two read-only endpoints, so it should arrive under `data`.
   * It is read from either level anyway: this response is the only proof a
   * delivery happened, and failing to find the id in a response that did
   * deliver would leave a paid, delivered order recorded as undelivered.
   */
  const parsed = createOrderSchema.safeParse(data);
  const fromEnvelope =
    !parsed.success && payload && typeof payload === "object"
      ? createOrderSchema.safeParse(payload)
      : parsed;

  if (!fromEnvelope.success) {
    console.error("[smileone] createorder shape mismatch", {
      topLevelKeys:
        data && typeof data === "object" ? Object.keys(data as object) : typeof data,
    });
    throw new SmileOneError(
      "createorder succeeded but the response had no readable order id",
      "/smilecoin/api/createorder",
    );
  }

  return { supplierOrderId: String(fromEnvelope.data.order_id) };
}

const createOrderSchema = z.object({
  order_id: z.union([z.string(), z.number()]),
});

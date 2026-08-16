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
   * When present, this is the source of truth for the final charge over the
   * cached catalogue price (Section 8). A mismatch is logged by the pricing
   * service rather than silently resolved.
   */
  change_price: z.union([z.string(), z.number()]).optional(),
  /** Undocumented in the supplied PDF. Observed live as the string "c". */
  use: z.unknown().optional(),
  /*
   * The live response also carries an undocumented `id_change_price_info`:
   * a per-product `[{ product_id, change_price }]` array. Not read here —
   * Phase 6 needs it when the final charge is computed, and it is recorded in
   * project_state.yaml so it is not rediscovered from scratch.
   */
});


export type RoleLookup = {
  /** The in-game username shown to the customer for confirmation. */
  username: string | null;
  zone: string | null;
  changePrice: string | null;
  /** Logged during sandbox testing to determine what this field means. */
  rawUseField: unknown;
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
      return { username: null, zone: null, changePrice: null, rawUseField: undefined };
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
  };
}

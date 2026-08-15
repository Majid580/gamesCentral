import "server-only";

import { z } from "zod";

import { requireEnv } from "@/lib/env";
import { toFormBody, withSignature } from "@/lib/services/smileone/sign";

/**
 * SmileOne API client.
 *
 * REQUEST side is verified: the double-MD5 signing in `./sign.ts` has been
 * checked for sorted-key independence, digest shape, and misuse rejection.
 *
 * RESPONSE side is NOT yet verified against a live endpoint. The documented
 * sandbox host (`frontsmie.smile.one`) does not resolve in DNS — see
 * `project_state.yaml` blockers. The schemas below are therefore written
 * defensively: they accept the documented fields, tolerate the two plausible
 * envelope shapes, and log the actual payload shape on a mismatch instead of
 * throwing an opaque error. Confirm and tighten them the moment a working
 * sandbox base URL is available.
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
  ) {
    super(message);
    this.name = "SmileOneError";
  }
}

/**
 * Signs and dispatches a request. The merchant key never leaves this module,
 * and is never included in a thrown error or a log line.
 */
async function smileOneRequest(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<unknown> {
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

/** A single catalogue entry, as documented: `{ id, spu, price }`. */
const rawProductSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  /**
   * Inconsistent, abbreviated supplier string such as
   * "mobilelegends BR 78 &8 Diamond". Never displayed to a customer — the
   * admin-curated display name is used instead (Section 8).
   */
  spu: z.string(),
  price: z.union([z.string(), z.number()]),
});

/** The envelope shape is unconfirmed; accept the two plausible forms. */
const productListSchema = z.union([
  z.object({ data: z.object({ product: z.array(rawProductSchema) }) }),
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

  const parsed = productListSchema.safeParse(payload);
  if (!parsed.success) {
    // Log the shape, never the contents, so the schema can be corrected.
    console.error("[smileone] productlist shape mismatch", {
      topLevelKeys:
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? Object.keys(payload)
          : typeof payload,
    });
    throw new SmileOneError(
      "productlist response did not match any expected shape",
      "/smilecoin/api/productlist",
    );
  }

  const list = Array.isArray(parsed.data)
    ? parsed.data
    : "data" in parsed.data
      ? parsed.data.data.product
      : parsed.data.product;

  return list.map((p) => ({
    smileOneProductId: p.id,
    spu: p.spu,
    rawPrice: String(p.price),
  }));
}

/* ------------------------------------------------------------------ */
/* getrole                                                             */
/* ------------------------------------------------------------------ */

const getRoleSchema = z.object({
  username: z.string().optional(),
  zone: z.union([z.string(), z.number()]).optional(),
  /**
   * When present, this is the source of truth for the final charge over the
   * cached catalogue price (Section 8). A mismatch is logged by the pricing
   * service rather than silently resolved.
   */
  change_price: z.union([z.string(), z.number()]).optional(),
  /** Undocumented in the supplied PDF. Captured verbatim for inspection. */
  use: z.unknown().optional(),
});

const getRoleEnvelopeSchema = z.union([
  z.object({ data: getRoleSchema }),
  getRoleSchema,
]);

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

  const parsed = getRoleEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("[smileone] getrole shape mismatch", {
      topLevelKeys:
        payload && typeof payload === "object"
          ? Object.keys(payload as object)
          : typeof payload,
    });
    throw new SmileOneError(
      "getrole response did not match any expected shape",
      "/smilecoin/api/getrole",
    );
  }

  const data = "data" in parsed.data ? parsed.data.data : parsed.data;

  return {
    username: data.username ?? null,
    zone: data.zone != null ? String(data.zone) : null,
    changePrice: data.change_price != null ? String(data.change_price) : null,
    rawUseField: data.use,
  };
}

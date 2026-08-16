import "server-only";

import { requireEnv } from "@/lib/env";

/**
 * PayFast Pakistan API client.
 *
 * ⚠️ NOT the same company as PayFast South Africa (payfast.co.za). This is
 * PayFast Pakistan / gopayfast.com, regulated by the State Bank of Pakistan.
 * Their APIs are unrelated, and the South African documentation — which is what
 * every search and documentation index returns first — will produce code that
 * looks right and fails against this gateway. Do not use it.
 *
 * WHAT IS CONFIRMED (Section 9 of INITIAL_BRIEF.md, and reusable regardless of
 * which checkout mode we end up in):
 *   - POST /token with merchant_id + secured_key + grant_type=client_credentials
 *     returns a bearer token.
 *   - GET /transaction/basket_id/<basket_id> returns a transaction's status.
 *   - Currency is PKR only.
 *
 * WHAT IS NOT: the exact response field names. Everything here therefore reads
 * defensively and, where it matters, **fails closed** — see
 * `./verify-payment.ts`. An unreadable response is treated as "not paid",
 * never as "probably fine".
 */

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Sandbox and production hosts.
 *
 * ⚠️ UNCONFIRMED — these are the hosts PayFast Pakistan integrations are
 * commonly documented against, not values verified against this merchant
 * account. They have never been dialled. **Confirm both against the PayFast
 * dashboard or account manager before the first real payment**, and override
 * with `PAYFAST_API_BASE_URL` if they differ. The DNS lesson from SmileOne
 * applies: a documented host that does not exist looks exactly like a broken
 * integration.
 *
 * Kept as a lookup rather than two separate env vars so the sandbox/production
 * decision is one reviewable value (`PAYFAST_MODE`) and cannot be half set —
 * a production merchant id pointed at a sandbox host fails in ways that look
 * like broken code rather than misconfiguration.
 */
const BASE_URLS = {
  sandbox: "https://ipguat.apps.net.pk/Ecommerce/api",
  production: "https://ipg1.apps.net.pk/Ecommerce/api",
} as const;

export type PayFastMode = keyof typeof BASE_URLS;

export class PayFastError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PayFastError";
  }
}

/** Thrown when PayFast is not configured at all, as opposed to failing. */
export class PayFastNotConfiguredError extends Error {
  constructor(missing: string) {
    super(
      `PayFast is not configured: ${missing} is missing. The merchant account ` +
        "is supplied by PayFast at go-live; until then payment cannot be taken. " +
        "See .env.example.",
    );
    this.name = "PayFastNotConfiguredError";
  }
}

export function payFastMode(): PayFastMode {
  const mode = process.env.PAYFAST_MODE ?? "sandbox";
  if (mode !== "sandbox" && mode !== "production") {
    throw new Error(
      `PAYFAST_MODE must be "sandbox" or "production", received "${mode}".`,
    );
  }
  return mode;
}

export function payFastBaseUrl(): string {
  // Explicit override wins, so a corrected host is a one-line env change
  // rather than a code deploy.
  const override = process.env.PAYFAST_API_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  return BASE_URLS[payFastMode()];
}

/**
 * True when credentials exist. Checked before starting a payment so the
 * customer is told plainly that card payment is not live yet, instead of being
 * bounced to a gateway that rejects the request.
 */
export function isPayFastConfigured(): boolean {
  return Boolean(process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_SECURED_KEY);
}

function credentials(): { merchantId: string; securedKey: string } {
  if (!process.env.PAYFAST_MERCHANT_ID) {
    throw new PayFastNotConfiguredError("PAYFAST_MERCHANT_ID");
  }
  if (!process.env.PAYFAST_SECURED_KEY) {
    throw new PayFastNotConfiguredError("PAYFAST_SECURED_KEY");
  }
  return {
    merchantId: requireEnv("PAYFAST_MERCHANT_ID"),
    securedKey: requireEnv("PAYFAST_SECURED_KEY"),
  };
}

/* ------------------------------------------------------------------ */
/* Access token                                                        */
/* ------------------------------------------------------------------ */

/**
 * Exchanges the merchant credentials for a bearer token.
 *
 * Deliberately NOT cached. A token cache would have to reason about expiry,
 * clock skew and concurrent refresh, and the only caller is payment
 * verification — a handful of requests per order, not a hot path. The
 * `secured_key` is the merchant's long-lived secret; a stale cached token that
 * silently fails verification is a far worse outcome than one extra round trip.
 */
export async function getAccessToken(): Promise<string> {
  const { merchantId, securedKey } = credentials();
  const endpoint = "/token";

  const body = new URLSearchParams({
    MERCHANT_ID: merchantId,
    SECURED_KEY: securedKey,
    grant_type: "client_credentials",
  });

  const payload = await request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  /*
   * Field name unconfirmed, so accept the plausible spellings rather than
   * failing on a capitalisation difference. Anything that is not a non-empty
   * string is treated as no token at all.
   */
  const token =
    pick(payload, "ACCESS_TOKEN") ??
    pick(payload, "access_token") ??
    pick(payload, "token");

  if (!token) {
    console.error("[payfast] token response missing a token", {
      topLevelKeys: keysOf(payload),
    });
    throw new PayFastError("No access token in the /token response", endpoint);
  }

  return token;
}

/* ------------------------------------------------------------------ */
/* Transaction status                                                  */
/* ------------------------------------------------------------------ */

/**
 * The raw transaction record, narrowed to the two fields that decide whether
 * an order is paid. Nothing else is returned to a caller — a raw gateway
 * payload must never reach the browser (rule 7).
 */
export type PayFastTransaction = {
  /** Gateway status text, e.g. "Completed"/"Paid". Never shown to a customer. */
  statusText: string | null;
  /** Amount as the gateway reported it, still a string. */
  amountText: string | null;
  /** The gateway's own transaction reference, recorded on the order. */
  transactionId: string | null;
  /** Present so a shape mismatch can be diagnosed without logging values. */
  observedKeys: string[];
};

/**
 * Looks a transaction up by OUR basket id.
 *
 * By basket id rather than the gateway's transaction id on purpose: the basket
 * id is our own order id, which we always know. The transaction id only ever
 * arrives from the gateway, so requiring it would mean trusting a redirect or
 * a webhook payload to tell us what to verify — the exact thing rule 2
 * forbids.
 */
export async function fetchTransactionByBasketId(
  basketId: string,
): Promise<PayFastTransaction> {
  const token = await getAccessToken();
  const endpoint = `/transaction/basket_id/${encodeURIComponent(basketId)}`;

  const payload = await request(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  /* Some gateways wrap the record; unwrap one level if they do. */
  const record =
    payload && typeof payload === "object" && "data" in (payload as object)
      ? (payload as { data: unknown }).data
      : payload;

  return {
    statusText:
      pick(record, "status") ??
      pick(record, "transaction_status") ??
      pick(record, "TRANSACTION_STATUS") ??
      pick(record, "err_code_desc"),
    amountText:
      pick(record, "transaction_amount") ??
      pick(record, "amount") ??
      pick(record, "TRANSACTION_AMOUNT"),
    transactionId:
      pick(record, "transaction_id") ??
      pick(record, "TRANSACTION_ID") ??
      pick(record, "retrieval_ref_no"),
    observedKeys: keysOf(record),
  };
}

/* ------------------------------------------------------------------ */
/* Plumbing                                                            */
/* ------------------------------------------------------------------ */

async function request(endpoint: string, init: RequestInit): Promise<unknown> {
  const url = `${payFastBaseUrl()}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "unknown";
    throw new PayFastError(`Network failure calling ${endpoint}: ${reason}`, endpoint);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new PayFastError(
      `PayFast returned HTTP ${response.status} for ${endpoint}`,
      endpoint,
      response.status,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PayFastError(
      `Non-JSON response from ${endpoint} (first 200 chars: ${text.slice(0, 200)})`,
      endpoint,
      response.status,
    );
  }
}

/** Reads a string-ish field, returning null for anything else. */
function pick(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object") return null;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/** Key names only — never values, which carry payment details. */
function keysOf(source: unknown): string[] {
  return source && typeof source === "object" ? Object.keys(source) : [];
}

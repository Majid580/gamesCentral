import "server-only";

import { z } from "zod";

import { connectToDatabase, assertScalar } from "@/lib/models/db";
import {
  accountLookupRules,
  checkRateLimit,
  orderCreateRules,
} from "@/lib/services/rate-limit";
import { GameModel } from "@/lib/models/game";
import { ProductModel } from "@/lib/models/product";
import {
  createPendingOrder,
  ProductNotFulfillableError,
  ProductUnavailableError,
  type CreatedOrder,
} from "@/lib/services/orders";
import {
  verifyGameAccount,
  AccountNotFoundError,
  RegionNotServedError,
  type AccountVerification,
} from "@/lib/services/smileone/verify-account";
import { SmileOneError } from "@/lib/services/smileone/client";

/**
 * Checkout orchestration.
 *
 * Route handlers stay thin and delegate here. Every field arriving from the
 * browser is parsed by zod first: `z.string()` rejects the object-valued input
 * (`{ $ne: null }`) that NoSQL operator injection depends on, which is the
 * first half of rule 6 — `assertScalar` at the query boundary is the second.
 */

/* Mobile Legends IDs are numeric. Bounded length stops a multi-megabyte body
   reaching the supplier or the database. */
const playerIdSchema = z
  .string()
  .trim()
  .regex(/^\d{4,15}$/, "Player ID should be 4–15 digits.");

const zoneIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}$/, "Zone ID should be 1–10 digits.");

export const verifyAccountSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  playerId: playerIdSchema,
  zoneId: zoneIdSchema,
});

export const createOrderSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  playerId: playerIdSchema,
  zoneId: zoneIdSchema,
  confirmedUsername: z.string().trim().min(1).max(80),
  supplierChangePrice: z.string().trim().max(32).nullable().default(null),
  contactEmail: z.email("Enter an email we can send the receipt to.").max(160),
  /* Pakistani mobile numbers, tolerant of +92 / 0 / spaces. */
  contactPhone: z
    .string()
    .trim()
    .regex(/^(?:\+92|0)?[\s-]?3\d{2}[\s-]?\d{7}$/, "Enter a valid Pakistani mobile number."),
  /**
   * Not trusted. Echoed back by the client so the server can detect that the
   * price moved between the page render and submission, and tell the customer
   * rather than silently charging a different amount. It never sets the price.
   */
  quotedPricePkr: z.number().int().nonnegative().optional(),
});

export type CheckoutResult<T> =
  | { ok: true; data: T }
  /**
   * `fields` is a list rather than a single name because the supplier cannot
   * always narrow the fault to one input: a wrong Player ID and a wrong Zone
   * ID return byte-identical responses, so both have to be flagged.
   */
  | {
      ok: false;
      status: number;
      error: string;
      fields?: string[];
      /** Set on a 429, so the route can send a truthful `Retry-After`. */
      retryAfterSeconds?: number;
    };

/* ------------------------------------------------------------------ */
/* Verify account                                                      */
/* ------------------------------------------------------------------ */

export async function verifyAccount(
  body: unknown,
  context: { ip: string },
): Promise<CheckoutResult<AccountVerification>> {
  const parsed = verifyAccountSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, status: 400, error: issue.message, fields: [String(issue.path[0])] };
  }

  const { sku, playerId, zoneId } = parsed.data;

  /*
   * Rate limit after parsing but before anything expensive.
   *
   * This endpoint is public and unauthenticated, and every call that gets past
   * here reaches the owner's real SmileOne account. Malformed bodies are
   * rejected above without consuming anyone's budget — they never reach the
   * supplier, so they are not the traffic worth limiting.
   */
  const limit = await checkRateLimit(accountLookupRules(context.ip));
  if (!limit.allowed) {
    console.warn("[checkout] account lookup rate limited", {
      rule: limit.rule,
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    return {
      ok: false,
      status: 429,
      error: "Too many lookups. Please wait a moment and try again.",
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  await connectToDatabase();
  const product = await ProductModel.findOne({
    sku: assertScalar(sku, "sku"),
    isActive: true,
  })
    .select("game smileOneProductId")
    .lean();

  if (!product) {
    return { ok: false, status: 404, error: "That package is no longer available." };
  }

  const game = await GameModel.findById(product.game).select("smileOneProduct").lean();
  if (!game) {
    return { ok: false, status: 404, error: "That package is no longer available." };
  }

  try {
    const verification = await verifyGameAccount({
      smileOneProduct: game.smileOneProduct,
      smileOneProductId: product.smileOneProductId ?? null,
      playerId,
      zoneId,
    });
    return { ok: true, data: verification };
  } catch (error) {
    if (error instanceof AccountNotFoundError) {
      /*
       * Both fields are flagged because the supplier genuinely cannot say
       * which one is wrong — claiming it was the Player ID would send a
       * customer with a mistyped Zone ID hunting in the wrong place.
       */
      return {
        ok: false,
        status: 404,
        error:
          "No player found for that Player ID and Zone ID. Check both and try again.",
        fields: ["playerId", "zoneId"],
      };
    }
    if (error instanceof RegionNotServedError) {
      /*
       * Deliberately vague, and deliberately not field-flagged. The customer
       * has not made a mistake, so there is nothing for them to correct — and
       * naming the rule would only tell someone which detail to change to get
       * around it. The reason is in the server log, where the owner can see it.
       */
      return {
        ok: false,
        status: 403,
        error:
          "Sorry — we don't serve this account's region yet, so we can't top it " +
          "up. Nothing has been charged.",
      };
    }
    if (error instanceof SmileOneError) {
      // Never surface a raw upstream message or endpoint to the browser (rule 7).
      console.error("[checkout] account verification upstream failure", {
        endpoint: error.endpoint,
        status: error.status,
      });
      return {
        ok: false,
        status: 503,
        error:
          "We can't reach the game servers right now. Nothing has been charged — please try again shortly.",
      };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Create order                                                        */
/* ------------------------------------------------------------------ */

export async function createOrder(
  body: unknown,
  context: { ip: string },
): Promise<CheckoutResult<CreatedOrder & { priceChanged: boolean }>> {
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, status: 400, error: issue.message, fields: [String(issue.path[0])] };
  }

  const { quotedPricePkr, ...input } = parsed.data;

  /*
   * Limited after parsing, so the rule can be keyed on the validated recipient
   * address, and before anything is written or sent. This endpoint is public
   * and now causes an email, which makes it a way to mail a stranger on our
   * behalf if it is left open.
   */
  const limit = await checkRateLimit(orderCreateRules(context.ip, input.contactEmail));
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: "Too many orders from here just now. Please wait a moment and try again.",
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  try {
    const order = await createPendingOrder(input);

    /*
     * The order is created at the server's price regardless. Reporting the
     * discrepancy lets the UI say "the price changed" instead of quietly
     * charging something other than what was on screen — which is the honest
     * behaviour when a catalogue edit lands mid-checkout.
     */
    const priceChanged =
      quotedPricePkr !== undefined && quotedPricePkr !== order.pricePkr;

    if (priceChanged) {
      console.warn("[checkout] price moved during checkout", {
        orderId: order.orderId,
        quoted: quotedPricePkr,
        charged: order.pricePkr,
      });
    }

    return { ok: true, data: { ...order, priceChanged } };
  } catch (error) {
    if (error instanceof ProductUnavailableError) {
      return { ok: false, status: 409, error: error.message };
    }
    /*
     * Distinct from unavailable: the package exists and is priced, we just
     * cannot deliver it yet. Refusing here means the customer is turned away
     * before paying, which is the only acceptable outcome — the alternative is
     * money taken against a delivery that cannot happen.
     */
    if (error instanceof ProductNotFulfillableError) {
      return { ok: false, status: 409, error: error.message };
    }
    throw error;
  }
}

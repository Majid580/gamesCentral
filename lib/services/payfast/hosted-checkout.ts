import "server-only";

import { requireEnv, siteUrl } from "@/lib/env";
import { payFastBaseUrl, payFastMode } from "@/lib/services/payfast/client";
import { paisaToAmountString } from "@/lib/utils/money";

/**
 * ⚠️ DRAFT — THE ONLY UNCONFIRMED PART OF THE PAYFAST INTEGRATION.
 *
 * Everything else (token exchange, transaction lookup, verification) is built
 * on endpoints confirmed in Section 9 of INITIAL_BRIEF.md. The hosted-checkout
 * form is not: the brief records explicitly that field-level docs for hosted
 * mode were unavailable, and no public documentation for PayFast **Pakistan**
 * exists to check against. Every field name below is a best guess from the
 * common PayFast Pakistan / Bank Alfalah IPG integration shape.
 *
 * It is quarantined here, in one function, so correcting it when the real
 * documentation arrives is a single edit against a single list — not a hunt
 * through the codebase.
 *
 * ## Why a wrong guess here is survivable
 *
 * Because nothing downstream believes this form. Rule 2 means the money is
 * confirmed by re-fetching the transaction from PayFast by our own basket id
 * and matching the amount (`./verify-payment.ts`). If a field name here is
 * wrong, the gateway rejects the request and the customer never reaches a
 * payment page — a visible, immediate, harmless failure. There is no path
 * where a wrong field name here causes an unpaid order to be treated as paid.
 *
 * ## The gate
 *
 * `assertCheckoutFieldsReviewed()` refuses to run in production until someone
 * sets `PAYFAST_FIELDS_CONFIRMED=1`, which is the human act of having compared
 * this list against PayFast's real documentation. Sandbox is unrestricted, so
 * the flow stays testable the moment credentials arrive.
 */

export class PayFastFieldsUnreviewedError extends Error {
  constructor() {
    super(
      "PayFast hosted-checkout fields have not been confirmed against real " +
        "documentation, and PAYFAST_MODE is production. These field names are " +
        "a draft (see lib/services/payfast/hosted-checkout.ts). Check them " +
        "against the PayFast merchant dashboard, then set " +
        "PAYFAST_FIELDS_CONFIRMED=1.",
    );
    this.name = "PayFastFieldsUnreviewedError";
  }
}

/**
 * Refuses to build a real-money redirect from unreviewed guesses.
 *
 * Deliberately checked at call time rather than at module load: `next build`
 * imports every route with NODE_ENV=production to collect page data, and a
 * module-level throw would fail the build rather than the request.
 */
export function assertCheckoutFieldsReviewed(): void {
  if (payFastMode() !== "production") return;
  if (process.env.PAYFAST_FIELDS_CONFIRMED === "1") return;
  throw new PayFastFieldsUnreviewedError();
}

export type HostedCheckoutForm = {
  /** Where the browser POSTs to reach the hosted payment page. */
  action: string;
  /** Hidden form fields, submitted as application/x-www-form-urlencoded. */
  fields: Record<string, string>;
};

export type HostedCheckoutInput = {
  /** Our order id, used as the basket id so verification can look it up. */
  orderId: string;
  /** Integer paisa. Converted to a plain rupee string exactly once, here. */
  pricePkr: number;
  /** What the customer is buying, for the gateway's own record. */
  description: string;
  contactEmail: string;
  contactPhone: string;
  /** Token from `getAccessToken()`. */
  accessToken: string;
};

/**
 * Builds the redirect form that hands the customer to PayFast.
 *
 * BASKET_ID is our own order id on purpose. It is the only identifier we know
 * before the gateway has seen the payment, and verification looks the
 * transaction up by it — which is what lets us confirm a payment without ever
 * trusting a redirect or webhook to tell us which transaction to check.
 */
export function buildHostedCheckoutForm(input: HostedCheckoutInput): HostedCheckoutForm {
  assertCheckoutFieldsReviewed();

  const merchantId = requireEnv("PAYFAST_MERCHANT_ID");
  const origin = siteUrl();

  /*
   * Every key below is unconfirmed. Ordered roughly by how confident the guess
   * is, so a reviewer starts where it is most likely wrong:
   *   - BASKET_ID / TXNAMT / CURRENCY_CODE follow the documented API vocabulary
   *   - MERCHANT_ID / TOKEN mirror the confirmed /token request
   *   - PROCCODE / TRAN_TYPE / STORE_ID are the least certain and may not
   *     apply to hosted mode at all
   */
  const fields: Record<string, string> = {
    MERCHANT_ID: merchantId,
    TOKEN: input.accessToken,

    BASKET_ID: input.orderId,
    TXNAMT: paisaToAmountString(input.pricePkr),
    CURRENCY_CODE: "PKR",
    TXNDESC: input.description,

    CUSTOMER_EMAIL_ADDRESS: input.contactEmail,
    CUSTOMER_MOBILE_NO: input.contactPhone,

    /*
     * Both point back at us. The success URL only *triggers* verification —
     * it is never itself the evidence a payment happened.
     */
    SUCCESS_URL: `${origin}/order/${input.orderId}?from=payfast`,
    FAILURE_URL: `${origin}/order/${input.orderId}?from=payfast`,
    CHECKOUT_URL: `${origin}/api/payments/payfast/webhook`,

    TRAN_DATE: new Date().toISOString(),
    PROCCODE: "00",
    TRAN_TYPE: "ECOMM_PURCHASE",
    VERSION: "MERCHANT-CART-0.1",
  };

  return { action: `${payFastBaseUrl()}/transaction/postrequest`, fields };
}

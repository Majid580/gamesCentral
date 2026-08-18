import "server-only";

// Relative for the same reason as ./templates.ts — see the note there.
import { SUPPLIER_PACKS, type SupplierProductId } from "../../fulfilment-plan.ts";

import {
  operatorAlertEmail,
  orderDeliveredEmail,
  orderNeedsAttentionEmail,
  orderSavedEmail,
  type OrderEmailFacts,
} from "./templates.ts";
import { isEmailConfigured, sendEmail } from "./transport.ts";

/**
 * When each email goes out.
 *
 * Kept apart from both the transport and the templates so the *policy* — who
 * gets told what, and at which moment — is one readable file rather than
 * scattered through the order and fulfilment services.
 *
 * Everything here is fire-and-forget. A mail server being slow or down must
 * never delay an order, and must never fail one: the order record is the
 * truth, and email is a courtesy laid on top of it. Every function returns
 * void and swallows its own errors.
 */

/** Where operator alerts go. Falls back to the SMTP account itself. */
function operatorAddress(): string | null {
  return (
    process.env.ADMIN_EMAIL?.trim() || process.env.SMTP_USER?.trim() || null
  );
}

/**
 * Runs an email send outside the caller's critical path.
 *
 * The rejection handler is the point. An unhandled rejection from a floating
 * promise terminates a Node process by default, which would mean a bounced
 * email taking down the server mid-order — precisely inverting the priority
 * this module is built around.
 */
function fireAndForget(label: string, work: Promise<unknown>): void {
  void work.catch((error: unknown) => {
    console.error("[email] notification threw", {
      label,
      detail: error instanceof Error ? error.message : String(error),
    });
  });
}

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

/**
 * Sent as soon as an order exists — before payment, deliberately.
 *
 * This is the one that fixes the actual gap: a customer who closes the tab has
 * their order ID nowhere else, and the tracking page cannot help someone who
 * does not have it. Waiting for a successful payment would withhold it from
 * exactly the people most likely to need support.
 */
export function notifyOrderSaved(facts: OrderEmailFacts): void {
  fireAndForget("order_saved", sendEmail(orderSavedEmail(facts)));
}

export function notifyOrderDelivered(facts: OrderEmailFacts): void {
  fireAndForget("order_delivered", sendEmail(orderDeliveredEmail(facts)));
}

/* ------------------------------------------------------------------ */
/* Paid but undelivered — both directions at once                      */
/* ------------------------------------------------------------------ */

/**
 * The moment that most needs telling, and until now told nobody.
 *
 * A customer has paid and received nothing. Two people need to know
 * immediately and they need different things said: the customer needs to hear
 * that their money is accounted for and a person is on it, before silence
 * turns into a fraud accusation; the owner needs to hear that an order is
 * waiting, because the alternative is finding out whenever they next happen to
 * open the dashboard.
 *
 * Sent as one call so the two can never drift apart — there is no path that
 * alerts the operator without reassuring the customer, or the reverse.
 */
export function notifyOrderNeedsAttention(args: {
  facts: OrderEmailFacts;
  /** Supplier packs still owed, as ids. Translated to labels here. */
  outstanding: readonly string[];
  /** Operator-facing reason. Never sent to the customer. */
  reason: string;
  /** True when a call went out and never confirmed — see fulfilment.ts. */
  needsDashboardCheck: boolean;
}): void {
  if (!isEmailConfigured()) {
    /*
     * Logged loudly rather than silently skipped. With email unconfigured this
     * is the one notification whose absence has a real cost — an order sits in
     * the queue with nobody told — so it should be visible in the server log
     * even when there is no mailbox to send it to.
     */
    console.warn("[email] order needs attention but email is not configured", {
      orderId: args.facts.orderId,
    });
    return;
  }

  fireAndForget(
    "customer_needs_attention",
    sendEmail(orderNeedsAttentionEmail(args.facts)),
  );

  const operator = operatorAddress();
  if (!operator) {
    console.warn("[email] no ADMIN_EMAIL set — operator alert not sent", {
      orderId: args.facts.orderId,
    });
    return;
  }

  fireAndForget(
    "operator_alert",
    sendEmail(
      operatorAlertEmail({
        to: operator,
        orderId: args.facts.orderId,
        displayName: args.facts.displayName,
        pricePkr: args.facts.pricePkr,
        playerId: args.facts.playerId,
        zoneId: args.facts.zoneId,
        outstanding: args.outstanding.map(
          (id) => SUPPLIER_PACKS[id as SupplierProductId]?.label ?? `pack ${id}`,
        ),
        reason: args.reason,
        needsDashboardCheck: args.needsDashboardCheck,
      }),
    ),
  );
}

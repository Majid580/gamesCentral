import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  SUPPLIER_PACKS,
  deliveredDiamonds,
  describePlan,
  isFullyDelivered,
  remainingCalls,
  type FulfilmentPart,
  type SupplierProductId,
} from "@/lib/fulfilment-plan";
import { connectToDatabase, assertScalar } from "@/lib/models/db";
import {
  OrderModel,
  ORDER_STATUSES,
  OWED_FULFILMENT_STATUSES,
  canTransition,
  type OrderStatus,
} from "@/lib/models/order";
import { ProductModel } from "@/lib/models/product";
import { fulfilOrder } from "@/lib/services/fulfilment";

/**
 * Admin data access.
 *
 * Every export here calls `requireAdmin()` first. That is the real
 * authorisation boundary — `proxy.ts` only does an optimistic cookie check and
 * the Next.js docs are explicit that it must not be relied on for auth. Doing
 * it here means a new admin page cannot forget to check, because it cannot get
 * data without going through a function that already did.
 */

export type AdminSession = { id: string; email: string; role: string };

/** Redirects to the login page when there is no valid session. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await auth();
  const user = session?.user as
    | { id?: string; email?: string | null; role?: string }
    | undefined;

  if (!user?.id || !user.email) redirect("/admin/login");

  return { id: user.id, email: user.email, role: user.role ?? "operator" };
}

/** Throws instead of redirecting — for actions, where a redirect would be wrong. */
export async function requireAdminForAction(): Promise<AdminSession> {
  const session = await auth();
  const user = session?.user as
    | { id?: string; email?: string | null; role?: string }
    | undefined;

  if (!user?.id || !user.email) throw new Error("Not authorised.");

  return { id: user.id, email: user.email, role: user.role ?? "operator" };
}

/* ------------------------------------------------------------------ */
/* Dashboard stats                                                     */
/* ------------------------------------------------------------------ */

export type AdminStats = {
  ordersToday: number;
  revenueTodayPkr: number;
  needsAttention: number;
  failureRate: number;
  totalOrders: number;
};

export async function getAdminStats(): Promise<AdminStats> {
  await requireAdmin();
  await connectToDatabase();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [ordersToday, revenue, needsAttention, totalOrders, failed] =
    await Promise.all([
      OrderModel.countDocuments({ createdAt: { $gte: startOfToday } }),
      /* Revenue counts only orders where money was actually taken. Counting
         `pending` would inflate it with abandoned checkouts. */
      OrderModel.aggregate<{ total: number }>([
        {
          $match: {
            createdAt: { $gte: startOfToday },
            status: { $in: ["paid", "fulfilling", "fulfilled", "paid_pending_fulfillment"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$pricePkr" } } },
      ]),
      OrderModel.countDocuments({ status: "paid_pending_fulfillment" }),
      OrderModel.countDocuments({}),
      OrderModel.countDocuments({ status: "failed" }),
    ]);

  return {
    ordersToday,
    revenueTodayPkr: revenue[0]?.total ?? 0,
    needsAttention,
    totalOrders,
    failureRate: totalOrders === 0 ? 0 : failed / totalOrders,
  };
}

/* ------------------------------------------------------------------ */
/* Order list + detail                                                 */
/* ------------------------------------------------------------------ */

export type AdminOrderRow = {
  orderId: string;
  status: OrderStatus;
  pricePkr: number;
  playerId: string;
  confirmedUsername: string | null;
  contactEmail: string;
  createdAt: string;
  productName: string;
};

export async function listOrders(options: {
  status?: string;
  search?: string;
  limit?: number;
}): Promise<AdminOrderRow[]> {
  await requireAdmin();
  await connectToDatabase();

  const filter: Record<string, unknown> = {};

  if (options.status && ORDER_STATUSES.includes(options.status as OrderStatus)) {
    filter.status = options.status;
  }

  if (options.search) {
    const raw = String(assertScalar(options.search, "search")).trim();
    // Escaped before it reaches a regex: an unescaped user string is a ReDoS
    // and a wildcard-match bug waiting to happen.
    const safe = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { orderId: new RegExp(safe, "i") },
      { contactEmail: new RegExp(safe, "i") },
      { playerId: new RegExp(safe, "i") },
      { contactPhone: new RegExp(safe, "i") },
    ];
  }

  const orders = await OrderModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(options.limit ?? 50, 200))
    .select("orderId status pricePkr playerId confirmedUsername contactEmail createdAt product")
    .lean();

  const productIds = [...new Set(orders.map((o) => String(o.product)))];
  const products = await ProductModel.find({ _id: { $in: productIds } })
    .select("displayName")
    .lean();
  const names = new Map(products.map((p) => [String(p._id), p.displayName]));

  return orders.map((o) => ({
    orderId: o.orderId,
    status: o.status as OrderStatus,
    pricePkr: o.pricePkr,
    playerId: o.playerId,
    confirmedUsername: o.confirmedUsername ?? null,
    contactEmail: o.contactEmail,
    createdAt: o.createdAt.toISOString(),
    productName: names.get(String(o.product)) ?? "Unknown package",
  }));
}

export type AdminOrderDetail = AdminOrderRow & {
  zoneId: string | null;
  contactPhone: string;
  paymentReference: string | null;
  smileOneOrderId: string | null;
  statusHistory: { from: string; to: string; note: string | null; at: string }[];
  allowedTransitions: OrderStatus[];
  owesFulfilment: boolean;
  /**
   * What this order is made of and how much of it has actually landed.
   *
   * A composed order can be half-delivered — two of three packs, then a
   * timeout — and an operator recovering it by hand needs to know exactly
   * which packs are outstanding, not just that "something failed".
   */
  fulfilment: {
    /** e.g. "1× 706 Diamonds + 2× 172 Diamonds". */
    planSummary: string;
    /** Packs still to buy, as operator-readable labels. */
    outstanding: string[];
    deliveredDiamonds: number;
    complete: boolean;
    /**
     * A supplier call that went out and never reported back, if there is one.
     *
     * The single most important thing on this screen when it is set: the
     * operator has to find out from SmileOne whether that pack was delivered,
     * because nothing on our side can know. Retrying is blocked until they do.
     */
    inFlight: { label: string; startedAt: string } | null;
  };
  /** True when "Retry delivery" should be offered. */
  canRetryFulfilment: boolean;
};

export async function getOrder(orderId: string): Promise<AdminOrderDetail | null> {
  await requireAdmin();
  await connectToDatabase();

  const order = await OrderModel.findOne({
    orderId: String(assertScalar(orderId, "orderId")).toUpperCase(),
  }).lean();

  if (!order) return null;

  const product = await ProductModel.findById(order.product).select("displayName").lean();
  const status = order.status as OrderStatus;

  return {
    orderId: order.orderId,
    status,
    pricePkr: order.pricePkr,
    playerId: order.playerId,
    zoneId: order.zoneId ?? null,
    confirmedUsername: order.confirmedUsername ?? null,
    contactEmail: order.contactEmail,
    contactPhone: order.contactPhone,
    paymentReference: order.paymentReference ?? null,
    smileOneOrderId: order.smileOneOrderId ?? null,
    createdAt: order.createdAt.toISOString(),
    productName: product?.displayName ?? "Unknown package",
    statusHistory: (order.statusHistory ?? []).map((h: {
      from: string;
      to: string;
      note?: string | null;
      at: Date;
    }) => ({
      from: h.from,
      to: h.to,
      note: h.note ?? null,
      at: h.at.toISOString(),
    })),
    allowedTransitions: ORDER_STATUSES.filter((to) => canTransition(status, to)),
    owesFulfilment: OWED_FULFILMENT_STATUSES.includes(status),
    fulfilment: summariseFulfilment(
      order.fulfilmentPlan,
      order.fulfilmentDeliveries,
      order.fulfilmentInFlight,
    ),
    /*
     * Offered only from the queue this button exists to empty. A `paid` order
     * is already on its way and an in-flight call has to be resolved by a
     * human first — in both cases the button would either do nothing or do
     * something dangerous, so it is not shown.
     */
    canRetryFulfilment: status === "paid_pending_fulfillment" && !order.fulfilmentInFlight,
  };
}

/**
 * Turns the raw plan and delivery records into something an operator can read.
 *
 * Orders created before fulfilment plans existed have neither field, so an
 * empty plan is reported as such rather than treated as "nothing left to do" —
 * the two look identical to `remainingCalls` and mean opposite things.
 */
function summariseFulfilment(
  rawPlan: { supplierProductId: string; quantity: number }[] | undefined,
  rawDeliveries: { supplierProductId: string }[] | undefined,
  rawInFlight: { supplierProductId: string; startedAt: Date } | null | undefined,
): AdminOrderDetail["fulfilment"] {
  const deliveries = rawDeliveries ?? [];

  const inFlight = rawInFlight
    ? {
        label:
          SUPPLIER_PACKS[rawInFlight.supplierProductId as SupplierProductId]?.label ??
          `Unknown pack ${rawInFlight.supplierProductId}`,
        startedAt: rawInFlight.startedAt.toISOString(),
      }
    : null;

  if (!rawPlan?.length) {
    return {
      planSummary: "No fulfilment plan recorded on this order.",
      outstanding: [],
      deliveredDiamonds: deliveredDiamonds(deliveries),
      complete: false,
      inFlight,
    };
  }

  const plan = rawPlan.map((part) => ({
    supplierProductId: part.supplierProductId as SupplierProductId,
    quantity: part.quantity,
  })) satisfies FulfilmentPart[];

  return {
    planSummary: describePlan(plan),
    outstanding: remainingCalls(plan, deliveries).map(
      (id) => SUPPLIER_PACKS[id]?.label ?? `Unknown pack ${id}`,
    ),
    deliveredDiamonds: deliveredDiamonds(deliveries),
    complete: isFullyDelivered(plan, deliveries),
    inFlight,
  };
}

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

/**
 * Moves an order to a new status, by hand, from the admin UI.
 *
 * The transition is applied with an atomic conditional update on the CURRENT
 * status, so two operators clicking at once cannot both apply it — the second
 * update matches nothing and reports the conflict (rule 3). The status machine
 * is still enforced: an admin cannot walk a paid order to `failed`, because
 * that edge does not exist (rule 8).
 */
export async function transitionOrder(args: {
  orderId: string;
  to: OrderStatus;
  note: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdminForAction();
  await connectToDatabase();

  const orderId = String(assertScalar(args.orderId, "orderId")).toUpperCase();

  const current = await OrderModel.findOne({ orderId }).select("status").lean();
  if (!current) return { ok: false, error: "Order not found." };

  const from = current.status as OrderStatus;

  if (!canTransition(from, args.to)) {
    return {
      ok: false,
      error: `${from} → ${args.to} is not a permitted transition.`,
    };
  }

  const result = await OrderModel.findOneAndUpdate(
    { orderId, status: from },
    {
      $set: { status: args.to },
      $push: {
        statusHistory: {
          from,
          to: args.to,
          note: `${args.note} (by ${admin.email})`.slice(0, 500),
          at: new Date(),
        },
      },
    },
    { returnDocument: "after" },
  );

  if (!result) {
    return {
      ok: false,
      error: "The order changed while you were looking at it. Reload and try again.",
    };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Retry fulfilment                                                    */
/* ------------------------------------------------------------------ */

/**
 * Re-runs delivery for an order sitting in the paid-but-undelivered queue.
 *
 * This is the deliberate manual step that `paid_pending_fulfillment` exists
 * for. The sweeper never retries these on its own: an order lands there
 * because something went wrong, and the reason is usually still true, so an
 * automatic loop would send the same doomed call every few minutes. A person
 * looks at the note, fixes or accepts the cause, and presses the button.
 *
 * Everything that makes a retry safe lives in `fulfilOrder` and is not
 * re-implemented here — the atomic claim, subtracting what already landed, and
 * the refusal to touch an order whose last call never reported back. An
 * operator cannot click their way past any of it.
 */
export async function retryFulfilment(orderId: string): Promise<
  { ok: true; message: string } | { ok: false; error: string }
> {
  const admin = await requireAdminForAction();

  const outcome = await fulfilOrder(orderId, {
    allowRetry: true,
    triggeredBy: `admin retry by ${admin.email}`,
  });

  if (outcome.ok) {
    return {
      ok: true,
      message:
        outcome.state === "already"
          ? "That order was already fulfilled."
          : `Delivered ${outcome.deliveredThisRun} outstanding pack(s).`,
    };
  }

  /*
   * The operator gets the real reason, unlike a customer (rule 7 is about the
   * browser of a stranger, not the person recovering the order). The unknown
   * case gets the instruction as well as the fact, because "check the SmileOne
   * dashboard" is the entire content of the decision they now have to make.
   */
  const message =
    outcome.state === "outcome_unknown"
      ? `A previous attempt never reported back, so this order was not retried. Check the ` +
        `SmileOne dashboard to see whether the pack was delivered, then either mark the ` +
        `order fulfilled or record the delivery. (${outcome.detail})`
      : outcome.detail;

  return { ok: false, error: message };
}

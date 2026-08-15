import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { connectToDatabase, assertScalar } from "@/lib/models/db";
import {
  OrderModel,
  ORDER_STATUSES,
  OWED_FULFILMENT_STATUSES,
  canTransition,
  type OrderStatus,
} from "@/lib/models/order";
import { ProductModel } from "@/lib/models/product";

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

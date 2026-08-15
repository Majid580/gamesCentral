import Link from "next/link";

import { StatusPill } from "@/components/admin/status-pill";
import { ORDER_STATUSES } from "@/lib/models/order";
import { listOrders } from "@/lib/services/admin";
import { formatPkr } from "@/lib/utils/money";

export const dynamic = "force-dynamic";

export const metadata = { title: "Orders" };

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const orders = await listOrders({ status, search: q, limit: 100 });

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="font-display text-2xl font-bold">Orders</h1>

      {/* GET form: a filtered list should be a URL an operator can bookmark
          and paste to a colleague. */}
      <form className="mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="q" className="block text-sm font-medium">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Order ID, email, phone, or Player ID"
            className="mt-2 h-12 w-full rounded-xl border border-border bg-input px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="status" className="block text-sm font-medium">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="mt-2 h-12 rounded-xl border border-border bg-input px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn h-12 bg-primary px-5 text-primary-foreground">
          Apply
        </button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        {orders.length === 0
          ? "No orders match."
          : `${orders.length} order${orders.length === 1 ? "" : "s"}`}
      </p>

      <ul className="mt-3 space-y-2">
        {orders.map((order) => (
          <li key={order.orderId}>
            <Link
              href={`/admin/orders/${order.orderId}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 hover:border-primary/45"
            >
              <span className="font-display text-sm font-semibold">{order.orderId}</span>
              <StatusPill status={order.status} />
              <span className="text-sm text-muted-foreground">{order.productName}</span>
              <span className="text-sm text-muted-foreground">
                {order.confirmedUsername ?? order.playerId}
              </span>
              <span className="ml-auto text-sm font-semibold">
                {formatPkr(order.pricePkr)}
              </span>
              <time
                dateTime={order.createdAt}
                className="w-full text-xs text-muted-foreground sm:w-auto"
              >
                {new Date(order.createdAt).toLocaleString("en-PK")}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

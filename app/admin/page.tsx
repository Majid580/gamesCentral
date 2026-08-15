import Link from "next/link";

import { getAdminStats, listOrders } from "@/lib/services/admin";
import { formatPkr } from "@/lib/utils/money";
import { StatusPill } from "@/components/admin/status-pill";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  // Authorisation happens inside these — see lib/services/admin.ts.
  const [stats, recent] = await Promise.all([
    getAdminStats(),
    listOrders({ limit: 8 }),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="font-display text-2xl font-bold">Dashboard</h1>

      {/*
        The paid-but-undelivered count leads, and is styled as an alert when it
        is non-zero. Everything else on this page is information; this is the
        only number that means a customer has paid and is waiting.
      */}
      {stats.needsAttention > 0 && (
        <Link
          href="/admin/orders?status=paid_pending_fulfillment"
          className="mt-6 flex items-center gap-3 rounded-2xl border border-destructive/50 bg-destructive/10 p-5 hover:border-destructive"
        >
          <span className="font-display text-3xl font-bold text-destructive">
            {stats.needsAttention}
          </span>
          <span className="text-sm">
            <strong className="block font-semibold">
              paid, not delivered
            </strong>
            These customers have been charged and are waiting. Open them →
          </span>
        </Link>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders today" value={String(stats.ordersToday)} />
        <Stat label="Revenue today" value={formatPkr(stats.revenueTodayPkr)} />
        <Stat
          label="Needs attention"
          value={String(stats.needsAttention)}
          tone={stats.needsAttention > 0 ? "alert" : undefined}
        />
        <Stat
          label="Failure rate"
          value={`${(stats.failureRate * 100).toFixed(1)}%`}
          hint={`${stats.totalOrders} orders all time`}
        />
      </div>

      <h2 className="mt-10 font-display text-lg font-semibold">Recent orders</h2>

      {recent.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No orders yet. They&apos;ll appear here as soon as customers start
          checking out.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {recent.map((order) => (
            <li key={order.orderId}>
              <Link
                href={`/admin/orders/${order.orderId}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card p-4 hover:border-primary/45"
              >
                <span className="font-display text-sm font-semibold">
                  {order.orderId}
                </span>
                <StatusPill status={order.status} />
                <span className="text-sm text-muted-foreground">
                  {order.productName}
                </span>
                <span className="ml-auto text-sm font-semibold">
                  {formatPkr(order.pricePkr)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "alert";
}) {
  return (
    <div
      className={`rounded-2xl border bg-card p-5 ${
        tone === "alert" ? "border-destructive/50" : "border-border"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

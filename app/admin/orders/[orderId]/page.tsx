import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { StatusPill } from "@/components/admin/status-pill";
import type { OrderStatus } from "@/lib/models/order";
import { getOrder, retryFulfilment, transitionOrder } from "@/lib/services/admin";
import { formatPkr } from "@/lib/utils/money";

export const dynamic = "force-dynamic";

export default async function AdminOrderDetail({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const order = await getOrder(orderId);

  if (!order) notFound();

  async function applyTransition(formData: FormData) {
    "use server";

    const to = String(formData.get("to") ?? "") as OrderStatus;
    const note = String(formData.get("note") ?? "").trim() || "Manual admin action";

    // transitionOrder re-checks authorisation and the status machine itself —
    // this action is reachable by anyone who can POST to the page.
    const result = await transitionOrder({ orderId, to, note });

    if (result.ok) revalidatePath(`/admin/orders/${orderId}`);
  }

  async function runRetry() {
    "use server";

    /*
     * No arguments on purpose. Which order to deliver comes from the URL this
     * page was rendered for, never from the form — a hidden field naming an
     * order id is a field an attacker can change, and this action spends the
     * owner's money.
     *
     * retryFulfilment re-checks authorisation and every fulfilment guard
     * itself; this is only the button.
     */
    await retryFulfilment(orderId);
    revalidatePath(`/admin/orders/${orderId}`);
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link
        href="/admin/orders"
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
      >
        ← All orders
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold">{order.orderId}</h1>
        <StatusPill status={order.status} />
      </div>

      {order.owesFulfilment && (
        <p className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <strong className="font-semibold">This customer has paid.</strong>{" "}
          {order.status === "paid_pending_fulfillment"
            ? "Delivery failed and needs to be completed by hand."
            : "Delivery is in progress or pending."}
        </p>
      )}

      <dl className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
        <Row label="Package" value={order.productName} />
        <Row label="Charged" value={formatPkr(order.pricePkr)} />
        <Row label="Player ID" value={order.playerId} />
        <Row label="Zone ID" value={order.zoneId ?? "—"} />
        <Row label="In-game name" value={order.confirmedUsername ?? "not confirmed"} />
        <Row label="Placed" value={new Date(order.createdAt).toLocaleString("en-PK")} />
        <Row label="Email" value={order.contactEmail} />
        <Row label="Phone" value={order.contactPhone} />
        <Row label="Payment reference" value={order.paymentReference ?? "—"} />
        <Row label="SmileOne order" value={order.smileOneOrderId ?? "—"} />
      </dl>

      {/*
        What this order is actually made of. Most packages are several supplier
        packs, so an operator finishing a failed delivery by hand needs the
        outstanding list — "deliver the rest" is not actionable on its own.
      */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Delivery</h2>
        <p className="mt-2 text-sm text-muted-foreground">{order.fulfilment.planSummary}</p>

        {order.fulfilment.outstanding.length > 0 ? (
          <div className="mt-4">
            <p className="text-sm font-medium">
              Still to deliver ({order.fulfilment.outstanding.length}{" "}
              {order.fulfilment.outstanding.length === 1 ? "pack" : "packs"})
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {order.fulfilment.outstanding.map((label, index) => (
                <li key={`${label}-${index}`}>· {label}</li>
              ))}
            </ul>
            {order.fulfilment.deliveredDiamonds > 0 && (
              <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                Partially delivered — {order.fulfilment.deliveredDiamonds} diamonds
                have already reached this account. Do not re-send those packs.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {order.fulfilment.complete
              ? "Every pack in this order has been delivered."
              : "Nothing outstanding."}
          </p>
        )}

        {/*
          The one state on this screen that no amount of clicking can resolve.
          A call went out and never reported back, so whether those diamonds
          landed is knowable only from SmileOne's own dashboard. Retrying is
          withheld rather than merely discouraged — the wrong guess here buys
          the pack twice at the owner's expense.
        */}
        {order.fulfilment.inFlight && (
          <div className="mt-4 rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
            <p>
              <strong className="font-semibold">
                Delivery outcome unknown — check SmileOne before doing anything.
              </strong>
            </p>
            <p className="mt-2">
              A <strong>{order.fulfilment.inFlight.label}</strong> purchase was
              sent at{" "}
              {new Date(order.fulfilment.inFlight.startedAt).toLocaleString("en-GB")}{" "}
              and never confirmed. It may or may not have reached this player.
            </p>
            <p className="mt-2 text-muted-foreground">
              Look the player up in the SmileOne dashboard. If it was delivered,
              mark this order fulfilled below. If it was not, deliver it by hand
              and then mark it fulfilled. Automatic retry is disabled for this
              order because it would buy the pack a second time.
            </p>
          </div>
        )}

        {order.canRetryFulfilment && (
          <form action={runRetry} className="mt-5">
            <p className="text-sm text-muted-foreground">
              Delivers only the packs listed above. Anything that already
              reached this player is skipped.
            </p>
            <button
              type="submit"
              className="btn mt-3 h-12 bg-primary px-5 text-primary-foreground"
            >
              Retry delivery
            </button>
          </form>
        )}
      </section>

      {/* ---- recovery ---- */}
      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">Change status</h2>

        {order.allowedTransitions.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <strong className="font-semibold text-foreground">
              {order.status} is a final state.
            </strong>{" "}
            There is no legal transition out of it.
          </p>
        ) : (
          <form action={applyTransition} className="mt-3 space-y-4">
            <div>
              <label htmlFor="to" className="block text-sm font-medium">
                New status
              </label>
              {/*
                Only legal transitions are offered, and transitionOrder
                re-checks them server-side. Notably `failed` never appears once
                an order is paid — that edge does not exist in the machine, so
                a paid order can never be quietly written off (rule 8).
              */}
              <select
                id="to"
                name="to"
                required
                className="mt-2 h-12 rounded-xl border border-border bg-input px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {order.allowedTransitions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="note" className="block text-sm font-medium">
                Reason
              </label>
              <p id="note-hint" className="mt-1 text-xs text-muted-foreground">
                Recorded in the order history with your email. Say what you did
                and why.
              </p>
              <input
                id="note"
                name="note"
                aria-describedby="note-hint"
                maxLength={400}
                className="mt-2 h-12 w-full rounded-xl border border-border bg-input px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <button type="submit" className="btn h-12 bg-primary px-5 text-primary-foreground">
              Apply change
            </button>
          </form>
        )}
      </section>

      {/* ---- history ---- */}
      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">History</h2>
        {order.statusHistory.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No transitions recorded yet.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {order.statusHistory.map((entry, i) => (
              <li
                key={`${entry.at}-${i}`}
                className="rounded-xl border border-border bg-card p-4 text-sm"
              >
                <p className="font-medium">
                  {entry.from} → {entry.to}
                </p>
                {entry.note && (
                  <p className="mt-1 text-muted-foreground">{entry.note}</p>
                )}
                <time dateTime={entry.at} className="mt-1 block text-xs text-muted-foreground">
                  {new Date(entry.at).toLocaleString("en-PK")}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

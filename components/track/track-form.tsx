"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CustomerStatus, TrackedOrder } from "@/lib/controllers/track";
import { formatPkr } from "@/lib/utils/money";

/**
 * Guest order lookup.
 *
 * Two fields, because one would be an IDOR: an order ID travels — it is on a
 * confirmation page, forwarded over WhatsApp, sitting in browser history — so
 * it cannot on its own unlock somebody's delivery target and contact details.
 * The form says why it asks for the second one rather than leaving the
 * customer to wonder.
 */

/**
 * Colour is a secondary cue: every state also says what it is in words, so the
 * meaning survives a colour-blind reader and a monochrome print.
 */
const TONE: Record<CustomerStatus, string> = {
  not_paid: "border-border bg-muted",
  paid: "border-primary/40 bg-primary-soft",
  delivering: "border-primary/40 bg-primary-soft",
  delivered: "border-accent/40 bg-accent-soft",
  attention: "border-warning/50 bg-warning/10",
  cancelled: "border-border bg-muted",
};

export function TrackForm() {
  const ids = useId();

  const [orderId, setOrderId] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<TrackedOrder | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/orders/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, contact }),
      });

      const data = (await response.json().catch(() => ({}))) as
        | TrackedOrder
        | { error?: string };

      if (!response.ok) {
        setOrder(null);
        setError(
          ("error" in data && data.error) ||
            "Something went wrong. Please try again in a moment.",
        );
        return;
      }

      setOrder(data as TrackedOrder);
    } catch {
      setOrder(null);
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10">
      <form
        onSubmit={handleSubmit}
        data-reveal
        className="facet-edge rounded-2xl border border-border bg-card p-6 [--facet-tone:var(--spectrum-2)] sm:p-8"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${ids}-order`} className="block text-sm font-medium">
              Order ID
            </label>
            <p id={`${ids}-order-hint`} className="mt-1 text-xs text-muted-foreground">
              From your confirmation, e.g. GC-7K2PM-QX9RT.
            </p>
            <input
              id={`${ids}-order`}
              name="orderId"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              aria-describedby={`${ids}-order-hint`}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              maxLength={32}
              placeholder="GC-XXXXX-XXXXX"
              className="mt-2 h-12 w-full rounded-xl border border-border bg-input px-4 text-base tracking-wider uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div>
            <label htmlFor={`${ids}-contact`} className="block text-sm font-medium">
              Email or phone number
            </label>
            <p id={`${ids}-contact-hint`} className="mt-1 text-xs text-muted-foreground">
              The one you gave at checkout. We ask so nobody else can read your
              order.
            </p>
            <input
              id={`${ids}-contact`}
              name="contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              aria-describedby={`${ids}-contact-hint`}
              autoComplete="email"
              required
              maxLength={160}
              placeholder="you@example.com or 0322 4810876"
              className="mt-2 h-12 w-full rounded-xl border border-border bg-input px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
          >
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="md" disabled={busy} className="mt-6">
          {busy ? "Looking…" : "Find my order"}
        </Button>
      </form>

      {/*
        Announced politely rather than assertively: the result replaces nothing
        and interrupts nothing, it simply appears below the form a moment after
        the customer asked for it.
      */}
      <div aria-live="polite">{order && <OrderResult order={order} />}</div>
    </div>
  );
}

function OrderResult({ order }: { order: TrackedOrder }) {
  return (
    <section className={`mt-8 rounded-2xl border p-6 sm:p-8 ${TONE[order.status]}`}>
      <p className="font-display text-sm font-semibold tracking-wider uppercase opacity-70">
        {order.orderId}
      </p>

      <h2 className="mt-2 font-display text-2xl font-bold">{order.headline}</h2>
      <p className="mt-3 leading-relaxed">{order.detail}</p>

      {/*
        Said before the customer works it out from the diamond count in their
        own game. Being told plainly that part of an order landed and the rest
        is coming is the difference between a shop with a problem and a shop
        that took the money and ran.
      */}
      {order.partiallyDelivered && (
        <p className="mt-4 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
          <strong className="font-semibold">Part of this order has arrived.</strong>{" "}
          {order.diamondsDelivered > 0
            ? `${order.diamondsDelivered.toLocaleString("en-PK")} diamonds have reached your account so far.`
            : "Some items have reached your account so far."}{" "}
          The rest is being completed — you will not be charged again for it.
        </p>
      )}

      <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-current/15 pt-6 sm:grid-cols-2">
        <Fact label="Package" value={order.displayName} />
        <Fact label="Paid" value={formatPkr(order.pricePkr)} />
        <Fact
          label="Delivered to"
          value={
            order.confirmedUsername
              ? `${order.confirmedUsername} (${order.playerId}${order.zoneId ? ` · ${order.zoneId}` : ""})`
              : order.playerId
          }
        />
        <Fact
          label="Placed"
          value={new Date(order.placedAt).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        />
      </dl>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide uppercase opacity-70">{label}</dt>
      <dd className="mt-1 font-medium break-words">{value}</dd>
    </div>
  );
}

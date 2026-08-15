import type { OrderStatus } from "@/lib/models/order";

/**
 * Order status as a labelled chip.
 *
 * Colour is a secondary cue only — the text always spells the status out, so
 * the meaning survives a colour-blind operator and a monochrome print.
 */
const TONE: Record<OrderStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  awaiting_payment: "bg-muted text-muted-foreground",
  paid: "bg-primary-soft text-primary",
  fulfilling: "bg-primary-soft text-primary",
  fulfilled: "bg-accent-soft text-accent",
  // The one that means a customer paid and got nothing.
  paid_pending_fulfillment: "bg-destructive/15 text-destructive",
  failed: "bg-muted text-muted-foreground",
};

const LABEL: Record<OrderStatus, string> = {
  pending: "Pending",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  fulfilling: "Delivering",
  fulfilled: "Delivered",
  paid_pending_fulfillment: "Paid, not delivered",
  failed: "Failed",
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}

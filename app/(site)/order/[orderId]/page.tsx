import type { Metadata } from "next";

import { PaymentReturn } from "@/components/checkout/payment-return";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Post-checkout landing page.
 *
 * Deliberately does NOT look the order up yet. Reading an order by ID alone
 * would be an IDOR: order IDs are shown on screen, forwarded in messages, and
 * sit in browser history, so the ID alone must never be enough to read
 * someone's contact details or delivery target. `findOrderForGuest` requires
 * a matching email or phone, and wiring that in is Phase 7's order-lookup
 * flow.
 *
 * Until then this confirms the order exists and hands over the ID, which is
 * everything the customer needs at this moment.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { orderId } = await params;
  const { from } = await searchParams;
  const safeId = orderId.toUpperCase().slice(0, 20);

  /*
   * PayFast sends the customer back here. The marker only decides whether to
   * *ask* our server to verify — it is never itself evidence of payment, and
   * anyone can add it to the URL. The answer comes from PayFast.
   */
  const returningFromPayFast = from === "payfast";

  return (
    <div className="mx-auto max-w-2xl px-5 py-16 sm:py-24">
      <div
        data-reveal
        className="facet-edge rounded-2xl border border-border bg-card p-6 [--facet-tone:var(--accent)] sm:p-8"
      >
        <h1 className="font-display text-2xl font-bold sm:text-3xl">
          Your order is saved
        </h1>

        <p className="mt-4 leading-relaxed text-muted-foreground">
          Keep this order ID — you&apos;ll need it, along with the email or
          phone number you just gave us, to look the order up.
        </p>

        <p className="mt-5 select-all rounded-xl border border-border bg-muted px-4 py-3 text-center font-display text-xl font-bold tracking-wider">
          {safeId}
        </p>

        {/*
          Honest about where the build actually is. A page that looks like a
          receipt is the worst possible place to be vague about whether money
          moved, so the two cases are kept strictly apart: a customer returning
          from the gateway gets a verified answer, and everyone else is told
          plainly that nothing was charged.
        */}
        {returningFromPayFast ? (
          <PaymentReturn orderId={safeId} />
        ) : (
          <div className="mt-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <p>
              <strong className="font-semibold">No payment was taken.</strong>{" "}
              Card and wallet payments are still being connected, so this order
              is recorded but not paid and no diamonds have been sent.
            </p>
          </div>
        )}

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/track" variant="primary" size="md">
            Track this order
          </ButtonLink>
          <ButtonLink href="/#packages" variant="outline" size="md">
            Back to packages
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

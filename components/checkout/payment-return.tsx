"use client";

import { useEffect, useState } from "react";

/**
 * Confirms a payment after the customer comes back from PayFast.
 *
 * The redirect itself proves nothing — a customer can reach this URL by typing
 * it, and so can anyone else. All this does is ask our server to go and check
 * with PayFast, which is the only thing that decides whether the order is paid
 * (rule 2).
 *
 * A client component rather than settling during the page render, so the
 * verification is an explicit request rather than a side effect of someone
 * loading a URL — including a prefetch or a refresh.
 */
type State = "checking" | "paid" | "unconfirmed" | "error";

export function PaymentReturn({ orderId }: { orderId: string }) {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/payments/payfast/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });

        if (cancelled) return;

        if (!response.ok) {
          setState("error");
          return;
        }

        const data = (await response.json()) as { paid?: boolean };
        if (!cancelled) setState(data.paid ? "paid" : "unconfirmed");
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (state === "checking") {
    return (
      <p
        role="status"
        className="mt-6 rounded-xl border border-border bg-muted px-4 py-3 text-sm"
      >
        Confirming your payment with PayFast…
      </p>
    );
  }

  if (state === "paid") {
    return (
      <div className="mt-6 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm">
        <p>
          <strong className="font-semibold">Payment confirmed.</strong> We&apos;re
          preparing your delivery now — your diamonds will arrive shortly. Keep
          your order ID if you need to check on it.
        </p>
      </div>
    );
  }

  /*
   * Both remaining cases say the same thing on purpose. "We couldn't verify
   * it" and "the gateway is unreachable" are the same situation for a
   * customer: their money may have left, and the answer is to contact us
   * rather than to pay again. Inviting a retry here is how someone pays twice.
   */
  return (
    <div className="mt-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <p>
        <strong className="font-semibold">
          We couldn&apos;t confirm your payment yet.
        </strong>{" "}
        If money left your account, don&apos;t pay again — send us your order ID
        and we&apos;ll sort it out.
      </p>
    </div>
  );
}

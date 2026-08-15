import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Track your order",
  description:
    "Look up a Games Central order using your order ID and the email or phone number you used at checkout.",
};

/**
 * Placeholder for the Phase 7 order-lookup flow.
 *
 * Deliberately NOT a non-functional form: a lookup box that silently does
 * nothing is worse than an honest "not ready yet" state. The real
 * implementation requires the Order model (Phase 4) and must be built with an
 * IDOR guard — order ID alone must never be enough to read an order, which is
 * why the lookup will require the matching contact email or phone too.
 */
export default function TrackOrderPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
      <h1 className="font-display text-3xl font-bold sm:text-4xl">
        Track your order
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
        Look up an order with your order ID and the email or phone number you
        used at checkout.
      </p>

      <div className="mt-10 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <h2 className="font-display text-lg font-semibold">
          Order tracking isn&apos;t live yet
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          This store is still being built and is not accepting orders. Once
          checkout goes live, every order will get an ID you can look up here.
        </p>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          If you have an existing order placed through WhatsApp, contact us
          directly at{" "}
          <span className="text-foreground">{siteConfig.contact.phone}</span>{" "}
          and we will check it for you.
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/contact" variant="primary" size="md">
            Contact support
          </ButtonLink>
          <ButtonLink href="/#packages" variant="outline" size="md">
            View packages
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

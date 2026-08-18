import type { Metadata } from "next";

import { TrackForm } from "@/components/track/track-form";
import { ButtonLink } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Track your order",
  description:
    "Look up a Games Central order using your order ID and the email or phone number you used at checkout.",
  // An order-lookup page has nothing to index and every reason not to appear
  // in a search result alongside somebody's order ID.
  robots: { index: false, follow: true },
};

/**
 * Guest order lookup (Section 6, step 7).
 *
 * There are no customer accounts in v1, so this is how someone checks an order
 * after closing the tab. The lookup requires the order ID *and* the contact
 * detail from checkout — the ID alone would be an IDOR, and it is exactly the
 * sort of string that gets forwarded in a message.
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

      <TrackForm />

      <div
        data-reveal
        className="mt-10 rounded-2xl border border-border bg-card p-6 sm:p-8"
      >
        <h2 className="font-display text-lg font-semibold">
          Can&apos;t find your order?
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Use the same email or phone number you entered at checkout — a
          different one won&apos;t match, even for the right order ID. If you
          placed an order through WhatsApp, or you no longer have your order ID,
          message us at{" "}
          <span className="text-foreground">{siteConfig.contact.phone}</span> and
          we will find it for you.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/contact" variant="outline" size="md">
            Contact support
          </ButtonLink>
          <ButtonLink href="/#packages" variant="ghost" size="md">
            View packages
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

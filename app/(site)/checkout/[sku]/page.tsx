import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CheckoutForm } from "@/components/checkout/checkout-form";
import { getCheckoutProduct } from "@/lib/services/catalogue";
import { formatPkr } from "@/lib/utils/money";

/**
 * Checkout for one package.
 *
 * Always rendered fresh: the price shown here must be the current catalogue
 * price, not a cached one, and the page is only ever reached deliberately so
 * there is nothing to gain from caching it.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ sku: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sku } = await params;
  const product = await getCheckoutProduct(sku);
  return {
    title: product ? `Buy ${product.displayName}` : "Checkout",
    // A checkout page has nothing to offer a search engine and shouldn't
    // compete with the storefront for the same terms.
    robots: { index: false, follow: true },
  };
}

export default async function CheckoutPage({ params }: Props) {
  const { sku } = await params;
  const product = await getCheckoutProduct(sku);

  if (!product) notFound();

  const total = product.diamondAmount
    ? product.diamondAmount + (product.bonusDiamonds ?? 0)
    : null;

  return (
    <div className="mx-auto max-w-2xl px-5 py-10 sm:py-16">
      <Link
        href="/#packages"
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to packages
      </Link>

      <h1 className="mt-4 font-display text-2xl font-bold sm:text-3xl">Checkout</h1>

      {/* Order summary first: on a phone the customer should not have to
          scroll back up to remember what they are buying. */}
      <section
        aria-label="Order summary"
        className="facet-edge mt-6 rounded-2xl border border-border bg-card p-5 [--facet-tone:var(--spectrum-2)]"
      >
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {product.gameName}
        </p>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-display text-lg font-bold">{product.displayName}</p>
            {product.bonusDiamonds && product.diamondAmount ? (
              <p className="mt-1 text-sm text-accent">
                {product.diamondAmount.toLocaleString("en-PK")} paid +{" "}
                {product.bonusDiamonds.toLocaleString("en-PK")} free ={" "}
                {total?.toLocaleString("en-PK")} diamonds
              </p>
            ) : (
              product.tagline && (
                <p className="mt-1 text-sm text-muted-foreground">{product.tagline}</p>
              )
            )}
          </div>
          <p className="shrink-0 font-display text-xl font-bold">
            {formatPkr(product.pricePkr)}
          </p>
        </div>
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          All-in price in PKR. Nothing is added at payment.
        </p>
      </section>

      <div className="mt-8">
        <CheckoutForm product={product} />
      </div>
    </div>
  );
}

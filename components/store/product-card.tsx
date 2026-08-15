import type { CSSProperties } from "react";

import { ComboGlyph, DiamondGlyph, PassGlyph } from "@/components/store/diamond-glyph";
import type { StorefrontProduct } from "@/lib/services/catalogue";
import { cn } from "@/lib/utils/cn";
import { formatPkr } from "@/lib/utils/money";

/** Four spectral stops, repeating. See the dispersion note in globals.css. */
const TONE_STOPS = 4;

type ProductCardProps = {
  product: StorefrontProduct;
  selected: boolean;
  onSelect: (product: StorefrontProduct) => void;
  /**
   * Position in the grid. Only picks which stop of the dispersion ramp this
   * card takes — it carries no commercial meaning.
   */
  tone: number;
};

/**
 * The core commerce unit.
 *
 * Presentational: it receives an already server-computed PKR price and never
 * derives one (rule 1). Each card draws one colour from the dispersion ramp so
 * a grid reads as light splitting through a stone rather than as identical
 * boxes — decoration only. Price, bonus, and the "most popular" mark are all
 * carried by text, never by hue alone.
 *
 * It is a real <button aria-pressed>, not a clickable <div>: choosing a
 * package is a toggle, so it must be reachable by keyboard, announce its
 * state, and expose a name that makes sense read on its own.
 */
export function ProductCard({ product, selected, onSelect, tone }: ProductCardProps) {
  const stop = (Math.abs(tone) % TONE_STOPS) + 1;
  const price = formatPkr(product.pricePkr);

  return (
    <button
      type="button"
      data-tilt
      aria-pressed={selected}
      onClick={() => onSelect(product)}
      style={
        {
          "--card-tone": `var(--spectrum-${stop})`,
          "--facet-tone": "var(--card-tone)",
        } as CSSProperties
      }
      className={cn(
        "stone facet-edge group flex h-full w-full flex-col items-start gap-3 overflow-hidden",
        "rounded-2xl border bg-card p-4 text-left sm:p-5",
        // touch-action: manipulation removes the 300ms tap delay on mobile.
        "touch-manipulation",
        selected ? "border-transparent" : "border-border",
      )}
    >
      {/*
        One self-contained sentence for screen readers, because the visual
        card splits its meaning across a number, a badge, and a footer that
        make no sense read in sequence.
      */}
      <span className="sr-only">
        {describe(product)}, {price}
        {product.featured ? ", most popular" : ""}
        {selected ? ", selected" : ""}
      </span>

      <div aria-hidden="true" className="flex w-full flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <KindGlyph kind={product.kind} />
          {product.featured && (
            <span className="rounded-full bg-highlight px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-highlight-foreground">
              Popular
            </span>
          )}
        </div>

        <Figure product={product} />
      </div>

      {/* Price sits on its own rule at the foot of every card, in the same
          place regardless of kind, so a column of cards is scannable by price. */}
      <div
        aria-hidden="true"
        className="mt-auto flex w-full items-center justify-between gap-2 border-t border-border pt-3"
      >
        <span className="font-display text-lg font-semibold sm:text-xl">{price}</span>
        {/*
          Deliberately NOT transitioned. A CSS transition on `color` captures
          the computed colour, and when the theme flips the underlying custom
          property changes without the transition re-running — the label stays
          painted in the previous theme's value. Measured: this label held the
          dark #a5a1bd on a white card after switching to light, giving 2.49:1
          against a 4.5:1 requirement. The colour change here accompanies a
          text change, so animating it was never carrying meaning anyway.
        */}
        <span
          className={cn(
            "text-xs font-medium",
            selected ? "text-accent" : "text-muted-foreground",
          )}
        >
          {selected ? "Selected" : "Select"}
        </span>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Per-kind figure                                                     */
/* ------------------------------------------------------------------ */

/**
 * The four kinds are genuinely different products, so each leads with what
 * actually distinguishes it: a diamond pack leads with its count, a double
 * offer leads with the free half, and a pass or combo leads with its name
 * because it has no meaningful number at all.
 */
function Figure({ product }: { product: StorefrontProduct }) {
  const { kind, diamondAmount, bonusDiamonds, displayName, tagline } = product;

  if (kind === "double_diamonds" && diamondAmount && bonusDiamonds) {
    const total = diamondAmount + bonusDiamonds;
    return (
      <div className="min-w-0">
        {/* Wraps rather than clips: at 375px a two-column card is ~160px wide,
            and a four-digit count plus its unit does not fit on one line. */}
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-display text-3xl font-bold leading-none sm:text-4xl">
            {total.toLocaleString("en-PK")}
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            total
          </span>
        </div>
        {/* The bonus is the entire offer, so it is stated in words and not
            left for the customer to infer from "50 + 50". */}
        <p className="mt-2 inline-flex items-center rounded-md bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">
          Pay for {diamondAmount.toLocaleString("en-PK")}, get{" "}
          {bonusDiamonds.toLocaleString("en-PK")} free
        </p>
      </div>
    );
  }

  if (kind === "diamonds" && diamondAmount) {
    return (
      <div className="min-w-0">
        {/* Wraps rather than clips: at 375px a two-column card is ~160px wide,
            and a four-digit count plus its unit does not fit on one line. */}
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-display text-3xl font-bold leading-none sm:text-4xl">
            {diamondAmount.toLocaleString("en-PK")}
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            diamonds
          </span>
        </div>
      </div>
    );
  }

  // Passes and combos: the name carries the meaning.
  return (
    <div className="min-w-0">
      <p className="font-display text-base font-bold leading-tight sm:text-lg">
        {displayName}
      </p>
      {tagline && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{tagline}</p>
      )}
      {diamondAmount && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
          includes {diamondAmount.toLocaleString("en-PK")} diamonds
        </p>
      )}
    </div>
  );
}

function KindGlyph({ kind }: { kind: StorefrontProduct["kind"] }) {
  const className =
    "h-6 w-6 shrink-0 text-[color:var(--card-tone)] transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-rotate-6";

  if (kind === "pass") return <PassGlyph className={className} />;
  if (kind === "combo") return <ComboGlyph className={className} />;
  return <DiamondGlyph className={className} />;
}

/** The spoken form of a card, used for its accessible name. */
function describe(product: StorefrontProduct): string {
  const { kind, displayName, diamondAmount, bonusDiamonds } = product;

  if (kind === "double_diamonds" && diamondAmount && bonusDiamonds) {
    return `${displayName}: pay for ${diamondAmount} diamonds and receive ${
      diamondAmount + bonusDiamonds
    } in total`;
  }
  if (kind === "diamonds" && diamondAmount) {
    return `${diamondAmount} diamonds`;
  }
  if (diamondAmount) {
    return `${displayName}, includes ${diamondAmount} diamonds`;
  }
  return displayName;
}

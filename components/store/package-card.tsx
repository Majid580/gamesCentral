import type { CSSProperties } from "react";

import { cn } from "@/lib/utils/cn";
import { formatPkr } from "@/lib/utils/money";

export type PackageCardProps = {
  /** Internal product id — used to start checkout. */
  id: string;
  displayName: string;
  diamondAmount: number;
  /** Integer paisa. Never a float, never client-computed. */
  pricePkr: number;
  /** Marks a single card as the recommended tier. */
  featured?: boolean;
  /**
   * Position in the grid. Only drives which stop of the dispersion ramp this
   * card takes — it carries no commercial meaning, so a catalogue of any
   * length can pass its index straight through.
   */
  tone?: number;
  className?: string;
};

/** Four spectral stops, repeating. See the dispersion note in globals.css. */
const TONE_STOPS = 4;

/**
 * The core commerce unit. Presentational only — it receives an already
 * server-computed PKR price and never derives one itself (Principle 1).
 *
 * Each card draws one colour from the dispersion ramp, so a row of packages
 * reads as light splitting through a stone rather than as eight identical
 * boxes. The colour is decoration and nothing else: price, tier, and the
 * "most popular" mark are all carried by text, never by hue alone.
 */
export function PackageCard({
  id,
  displayName,
  diamondAmount,
  pricePkr,
  featured = false,
  tone = 0,
  className,
}: PackageCardProps) {
  const headingId = `pkg-${id}-title`;
  const stop = (Math.abs(tone) % TONE_STOPS) + 1;

  return (
    <article
      aria-labelledby={headingId}
      style={
        {
          "--card-tone": `var(--spectrum-${stop})`,
          "--facet-tone": "var(--card-tone)",
          "--glow-tone": "var(--card-tone)",
        } as CSSProperties
      }
      className={cn(
        "group facet-edge glow-hover relative flex flex-col overflow-hidden rounded-2xl border bg-card p-5",
        "hover:-translate-y-1",
        featured
          ? "border-primary/55 shadow-[var(--shadow-card)]"
          : "border-border",
        className,
      )}
    >
      {/* The tone bleeding in from the top-right corner. Decorative. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--card-tone) 55%, transparent), transparent 70%)",
        }}
      />

      {featured && (
        <span className="absolute right-4 top-4 rounded-full bg-highlight px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-highlight-foreground">
          Most popular
        </span>
      )}

      {/* Reserve room for the badge so it can never sit on top of the count. */}
      <div className={cn("flex items-start gap-3", featured && "pr-24")}>
        <DiamondGlyph className="mt-0.5 h-7 w-7 shrink-0 text-[color:var(--card-tone)] transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-rotate-6" />
        <div className="min-w-0">
          {/*
            The diamond count is the card's real title, so it carries the
            heading. The visually-hidden suffix gives screen readers a
            self-contained name ("86 diamonds — Starter top-up") instead of a
            bare number read out of context.
          */}
          <h3
            id={headingId}
            className="font-display text-2xl font-bold leading-none"
          >
            {diamondAmount.toLocaleString("en-PK")}
            <span className="sr-only"> diamonds — {displayName}</span>
          </h3>
          <p
            aria-hidden="true"
            className="mt-1 text-xs uppercase tracking-wide text-muted-foreground"
          >
            Diamonds
          </p>
        </div>
      </div>

      {/* The curated display name — never SmileOne's raw `spu` string. */}
      <p className="mt-4 line-clamp-2 text-sm text-muted-foreground">
        {displayName}
      </p>

      <div className="mt-5 flex items-end justify-between gap-3 border-t border-border pt-4">
        <p className="font-display text-xl font-semibold">
          {formatPkr(pricePkr)}
        </p>
        <span
          className="inline-flex items-center gap-1 text-sm font-medium text-accent"
          aria-hidden="true"
        >
          Select
          <span className="transition-transform duration-200 ease-out group-hover:translate-x-1">
            →
          </span>
        </span>
      </div>
    </article>
  );
}

export function DiamondGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 2 L20 8.5 L12 22 L4 8.5 Z" fill="currentColor" opacity="0.2" />
      <path
        d="M12 2 L20 8.5 L12 22 L4 8.5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M4 8.5 H20" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

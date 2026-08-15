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
  className?: string;
};

/**
 * The core commerce unit. Presentational only — it receives an already
 * server-computed PKR price and never derives one itself (Principle 1).
 */
export function PackageCard({
  id,
  displayName,
  diamondAmount,
  pricePkr,
  featured = false,
  className,
}: PackageCardProps) {
  const headingId = `pkg-${id}-title`;

  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        "group relative flex flex-col rounded-2xl border bg-card p-5 transition-[transform,box-shadow,border-color] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]",
        featured
          ? "border-primary/60 shadow-[var(--shadow-card)]"
          : "border-border",
        className,
      )}
    >
      {featured && (
        <span className="absolute -top-2.5 left-5 rounded-full bg-highlight px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-highlight-foreground">
          Most popular
        </span>
      )}

      <div className="flex items-start gap-3">
        <DiamondGlyph className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
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
          className="text-sm font-medium text-accent transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden="true"
        >
          Select →
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

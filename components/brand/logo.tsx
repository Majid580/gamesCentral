import { cn } from "@/lib/utils/cn";

/**
 * PLACEHOLDER BRAND MARK.
 *
 * TODO(owner-assets): the owner has dark-mode and light-mode logos as JPG.
 * JPG has no transparency, so it cannot sit on the header cleanly — replace
 * this with PNG or SVG exports that have transparent backgrounds, then swap
 * this component for `next/image`.
 *
 * Until then this is a real SVG mark rather than a broken <img>: a faceted
 * diamond (the product) using currentColor, so it inverts correctly in both
 * themes without shipping two assets.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        className="h-8 w-8 shrink-0 text-primary"
      >
        {/* Faceted diamond: top table, crown facets, pavilion. */}
        <path d="M16 2 L27 11 L16 30 L5 11 Z" fill="currentColor" opacity="0.18" />
        <path d="M16 2 L27 11 L16 30 L5 11 Z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
        <path d="M5 11 H27" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 11 L16 2 L21 11 L16 30 Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" opacity="0.75" />
      </svg>
      {showWordmark && (
        <span className="font-display text-lg font-bold leading-none tracking-tight">
          Games<span className="text-primary">Central</span>
        </span>
      )}
    </span>
  );
}

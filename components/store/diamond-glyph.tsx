/**
 * The house diamond mark — a brilliant cut seen from above: table facet,
 * crown, girdle. Shared by the product cards and the trust callout so the
 * motif stays one drawing rather than several near-copies.
 */
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

/**
 * A pass is a period of time, not a quantity — so it gets its own mark rather
 * than borrowing the diamond. A ticket stub with a perforated edge.
 */
export function PassGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path
        d="M3 8.5V6.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 6.5v2a2.5 2.5 0 0 0 0 7v2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-2a2.5 2.5 0 0 0 0-7Z"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path d="M14 5v3M14 11v2M14 16v3" strokeDasharray="0.5 3" />
    </svg>
  );
}

/**
 * A combo is several items bought as one — two overlapping stones.
 */
export function ComboGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M8 4 L13.5 8.5 L8 17 L2.5 8.5 Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M16 7 L21.5 11.5 L16 20 L10.5 11.5 Z"
        fill="currentColor"
        fillOpacity="0.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

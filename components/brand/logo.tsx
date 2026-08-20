import Image from "next/image";

import { cn } from "@/lib/utils/cn";

/**
 * The brand lockup.
 *
 * TWO FILES, NOT ONE. The mark is not a single-colour glyph that can be
 * recoloured with `currentColor` — "GAMES" is navy on light and white on
 * dark, and the infinity ribbon changes colour with it — so light and dark
 * ship as separate artwork:
 *
 *   public/brand/logo-light.svg   navy wordmark, for light backgrounds
 *   public/brand/logo-dark.svg    white wordmark, for dark backgrounds
 *
 * WHY CSS AND NOT REACT. Which one is showing is decided entirely in CSS (see
 * the .brand-mark rules in globals.css), keyed off exactly the same three
 * states the palette itself uses: an explicit [data-theme], the OS preference,
 * and pinned-light. That matters because the theme is applied by an inline
 * script before hydration — reading it in React would mean rendering the
 * wrong logo on the server, shipping it in the HTML, and swapping it after
 * hydration. On a payments site a logo that visibly flickers on load is a
 * trust problem, not a cosmetic one.
 *
 * Both files are stacked in one grid cell so the swap cannot shift layout,
 * and both are `unoptimized`: /_next/image refuses SVG unless the whole app
 * opts into `dangerouslyAllowSVG`, which would let any future remote SVG
 * execute script. These are a couple of KB each and need no optimising.
 *
 * The intrinsic size below is the artwork's 640x400 box. Rendered height is
 * fixed and width is auto, so a replacement export at a different resolution
 * still lands correctly — but keep the 8:5 ratio, or the header will change
 * width when the theme is toggled. `npm run brand:check` verifies this.
 */
export function Logo({
  className,
  priority = false,
}: {
  className?: string;
  /** Set on the header instance: the logo is above the fold on every page. */
  priority?: boolean;
}) {
  return (
    /*
     * The accessible name lives on the wrapper, and BOTH images are marked
     * decorative. It cannot live on one of the images: whichever mark is
     * inactive is `visibility: hidden`, which takes it out of the
     * accessibility tree entirely — so an alt text on the light file would
     * simply vanish for every visitor in dark mode.
     *
     * inline-grid, not grid: in the footer the wrapper is a block-level child
     * and a plain `grid` stretched it to a 536px-wide invisible box sitting
     * over the column beside it.
     */
    <span
      role="img"
      aria-label="Games Central"
      className={cn("brand-mark group/logo inline-grid h-9 items-center", className)}
    >
      <Image
        src="/brand/logo-light.svg"
        alt=""
        aria-hidden="true"
        width={640}
        height={400}
        priority={priority}
        unoptimized
        className="brand-mark-light h-9 w-auto"
      />
      <Image
        src="/brand/logo-dark.svg"
        alt=""
        aria-hidden="true"
        width={640}
        height={400}
        priority={priority}
        unoptimized
        className="brand-mark-dark h-9 w-auto"
      />
    </span>
  );
}

/**
 * Icon-only lockup — the infinity ribbon with no wordmark, for spots too
 * narrow for the full mark. Inline rather than an <img> so it inherits
 * `currentColor` and needs no per-theme asset at all.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn("h-8 w-8 shrink-0 text-primary", className)}
    >
      <path
        d="M32 32C23.3 19 6 19 6 32S23.3 45 32 32 58 19 58 32 40.7 45 32 32Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
    </svg>
  );
}

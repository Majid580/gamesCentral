import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "buy" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

/**
 * `buy` is the money variant (green). Reserve it for actions that move the
 * customer toward or through payment, so the commerce path reads as one
 * continuous signal. `primary` (purple) is for everything else.
 *
 * Filled variants carry `sheen` (a band of light on hover) and `glow-hover`
 * tinted to their own colour, so the button lights up in the hue that already
 * means something — green for money, purple for brand.
 */
const variants: Record<Variant, string> = {
  primary:
    "sheen glow-hover [--glow-tone:var(--primary)] bg-primary text-primary-foreground hover:brightness-110 active:brightness-95 shadow-[var(--shadow-card)]",
  buy: "sheen glow-hover [--glow-tone:var(--accent)] bg-accent text-accent-foreground hover:brightness-110 active:brightness-95 shadow-[var(--shadow-card)]",
  outline:
    "glow-hover [--glow-tone:var(--primary)] border border-border bg-card text-card-foreground hover:border-primary/45 hover:bg-muted active:brightness-95",
  ghost: "text-foreground hover:bg-muted active:brightness-95",
};

/* Every size clears the 44px minimum touch target (ux-guidelines, CRITICAL). */
const sizes: Record<Size, string> = {
  sm: "h-11 px-4 text-sm",
  md: "h-12 px-5 text-[0.9375rem]",
  lg: "h-14 px-7 text-base",
};

/*
 * Layout and shape live in the `.btn` component class (globals.css), not in
 * utilities here. `cn()` is a plain join, so a base utility and a caller's
 * utility tie on specificity and the winner depends on Tailwind's emit order —
 * which is how `hidden sm:inline-flex` on the header CTA lost to a base
 * `inline-flex`. Keeping the skeleton in @layer components means a caller's
 * className always wins.
 */
const base = "btn";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return (
    <Link
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}

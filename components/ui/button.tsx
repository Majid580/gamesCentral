import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "buy" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

/**
 * `buy` is the money variant (green). Reserve it for actions that move the
 * customer toward or through payment, so the commerce path reads as one
 * continuous signal. `primary` (purple) is for everything else.
 */
const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:brightness-110 active:brightness-95 shadow-[var(--shadow-card)]",
  buy: "bg-accent text-accent-foreground hover:brightness-110 active:brightness-95 shadow-[var(--shadow-card)]",
  outline:
    "border border-border bg-card text-card-foreground hover:bg-muted active:brightness-95",
  ghost: "text-foreground hover:bg-muted active:brightness-95",
};

/* Every size clears the 44px minimum touch target (ux-guidelines, CRITICAL). */
const sizes: Record<Size, string> = {
  sm: "h-11 px-4 text-sm",
  md: "h-12 px-5 text-[0.9375rem]",
  lg: "h-14 px-7 text-base",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium " +
  "transition-[filter,background-color,transform] duration-200 ease-out " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-55 " +
  "whitespace-nowrap";

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

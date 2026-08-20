import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { MobileNav } from "@/components/site/mobile-nav";
import { NavLinks } from "@/components/site/nav-links";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { ButtonLink } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="facet-edge sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl [--facet-tone:var(--spectrum-2)] before:top-auto before:bottom-[-1px] before:inset-x-[20%]">
      {/* Skip link — first focusable element on the page. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-lg transition-opacity duration-200 hover:opacity-80"
          aria-label="Games Central — home"
        >
          <Logo priority />
        </Link>

        <NavLinks />

        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <ButtonLink href="/#packages" variant="buy" size="sm" className="hidden sm:inline-flex">
            Top up now
          </ButtonLink>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}

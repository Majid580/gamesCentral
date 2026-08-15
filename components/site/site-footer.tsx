import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { RESELLER_DISCLAIMER, siteConfig } from "@/lib/site-config";

export function SiteFooter() {
  return (
    <footer className="facet-edge mt-auto border-t border-border bg-card/40 [--facet-alpha:80%] [--facet-tone:var(--spectrum-3)] before:inset-x-[28%]">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {siteConfig.tagline} Enter your Player ID, pay securely, and your
              diamonds arrive automatically — no waiting for a reply.
            </p>
          </div>

          <div>
            <h2 className="font-display text-sm font-semibold">Store</h2>
            {/* Tight leading would give these ~19px tap targets on mobile;
                min-h-11 brings them to the 44px minimum. */}
            <ul className="mt-2 space-y-0.5">
              {siteConfig.nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-11 items-center text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="font-display text-sm font-semibold">Legal</h2>
            {/* Tight leading would give these ~19px tap targets on mobile;
                min-h-11 brings them to the 44px minimum. */}
            <ul className="mt-2 space-y-0.5">
              {siteConfig.legalNav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-11 items-center text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-8">
          {/* Section 14: the reseller disclaimer must be visible site-wide. */}
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {RESELLER_DISCLAIMER}
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            © {new Date().getFullYear()} {siteConfig.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";
import { siteConfig } from "@/lib/site-config";

/**
 * Desktop nav. Client-only because the active-state indicator needs
 * `usePathname` — the surrounding header stays a Server Component.
 */
export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {siteConfig.nav.map((item) => {
          const base = item.href.split("#")[0];
          const active =
            base === "/" ? pathname === "/" : pathname.startsWith(base);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex h-11 items-center rounded-lg px-3 text-[0.9375rem] transition-colors duration-200",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {/*
                  Always rendered and scaled from 0, so hover draws the rule in
                  from the left rather than snapping it on. The active page
                  keeps it drawn.
                */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-3 bottom-1.5 h-0.5 origin-left rounded-full bg-primary transition-transform duration-300 ease-out",
                    active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

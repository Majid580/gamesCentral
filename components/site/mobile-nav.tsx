"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils/cn";
import { siteConfig } from "@/lib/site-config";

/**
 * The only interactive piece of the header, so it is the only part that ships
 * as a Client Component — the rest of the chrome stays server-rendered.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  /*
   * Close on navigation, otherwise the panel survives a route change.
   *
   * This is React's "adjusting state when a prop changes" pattern — setting
   * state during render rather than in an effect. An effect here would cause
   * a cascading re-render, and handling it in each link's onClick would miss
   * browser back/forward navigation.
   */
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  // Lock scroll behind the open panel.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-foreground transition-colors duration-200 hover:bg-muted"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? (
            <>
              <path d="M5 5l14 14" />
              <path d="M19 5L5 19" />
            </>
          ) : (
            <>
              <path d="M3.5 7h17" />
              <path d="M3.5 12h17" />
              <path d="M3.5 17h17" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div
          id="mobile-nav-panel"
          className="fixed inset-x-0 top-16 z-40 border-b border-border bg-card px-5 pb-6 pt-2 shadow-[var(--shadow-raised)]"
        >
          <nav aria-label="Mobile">
            <ul className="flex flex-col">
              {siteConfig.nav.map((item) => {
                const base = item.href.split("#")[0];
                const active =
                  base === "/" ? pathname === "/" : pathname.startsWith(base);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex min-h-12 items-center border-b border-border/60 text-[0.9375rem] transition-colors duration-200",
                        active
                          ? "font-medium text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      )}
    </div>
  );
}

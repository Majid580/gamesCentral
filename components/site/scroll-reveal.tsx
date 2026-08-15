"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Reveals every `[data-reveal]` element as it scrolls into view.
 *
 * Mounted once in the site layout rather than wrapping each section, so pages
 * and sections stay Server Components and only need to carry an attribute. The
 * hidden state lives in CSS behind `@media (scripting: enabled)` (see
 * globals.css) — this component only adds the class that plays the transition.
 *
 * Deliberately not GSAP/ScrollTrigger or framer-motion: this is ~30 lines of
 * IntersectionObserver against ~40KB of dependency, on a storefront where
 * bundle size is a conversion cost (Section 12.15).
 */
export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>(
      "[data-reveal]:not(.is-revealed)",
    );
    if (targets.length === 0) return;

    const revealAll = () =>
      targets.forEach((el) => el.classList.add("is-revealed"));

    /*
     * Two cases where motion is wrong or impossible: an unsupported browser,
     * and a visitor who asked for reduced motion. Both get the content
     * immediately rather than nothing.
     */
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      revealAll();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-revealed");
          // Reveal once. Re-hiding on scroll-up makes a shopper feel like the
          // page is fighting them.
          observer.unobserve(entry.target);
        }
      },
      // Start slightly before the element reaches the fold so the transition
      // finishes about when it lands, instead of playing catch-up.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}

"use client";

import { useEffect } from "react";

/**
 * Makes same-page `#hash` links scroll every time they are clicked.
 *
 * `next/link` navigates the router rather than letting the browser perform a
 * fragment navigation. When the URL already carries the target hash, that
 * navigation is a no-op — and because Link has already called
 * `preventDefault()`, the browser's native scroll-to-fragment never runs
 * either. The result is a CTA that works exactly once: click "Choose a
 * package", scroll back up, click again, nothing happens.
 *
 * Rather than swapping seven call sites to plain anchors and losing prefetch
 * on the cross-page ones, this intercepts in the capture phase, before Link's
 * own handler. Link bails out when `e.defaultPrevented` is set
 * (node_modules/next/dist/client/app-dir/link.js), so calling preventDefault
 * here hands us the click without any fighting.
 *
 * Only same-document links are touched. Anything pointing at another route
 * falls through to the router untouched, keeping prefetch and client-side
 * navigation intact.
 */
export function AnchorScroll() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Anything the browser should handle its own way: middle/right click,
      // or a modifier the user pressed to open a new tab or window.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const url = new URL(anchor.href, window.location.href);

      // Same document only. A different route is the router's job.
      if (
        url.origin !== window.location.origin ||
        url.pathname !== window.location.pathname ||
        url.search !== window.location.search
      ) {
        return;
      }

      const id = url.hash.slice(1);
      if (!id) return;

      // getElementById, not querySelector — a hash is not necessarily a valid
      // CSS selector and querySelector would throw on one that isn't.
      const target = document.getElementById(decodeURIComponent(id));
      if (!target) return;

      event.preventDefault();

      /*
       * No `behavior` passed on purpose: omitting it defers to the CSS
       * `scroll-behavior`, which globals.css already sets to smooth and
       * overrides to auto under prefers-reduced-motion. Motion policy stays in
       * one place instead of being duplicated here.
       *
       * scroll-margin-top (the section's `scroll-mt-20`) is honoured, so the
       * heading clears the sticky header.
       */
      target.scrollIntoView({ block: "start" });

      if (window.location.hash !== url.hash) {
        window.history.pushState(null, "", url.hash);
      }

      /*
       * A native fragment navigation moves focus to the target. Without this a
       * keyboard user's focus stays on the button, so the next Tab returns to
       * the header rather than continuing into the section they just jumped
       * to. The temporary tabindex is removed on blur so it does not linger in
       * the tab order.
       */
      if (!target.hasAttribute("tabindex")) {
        target.setAttribute("tabindex", "-1");
        target.addEventListener(
          "blur",
          () => target.removeAttribute("tabindex"),
          { once: true },
        );
      }
      target.focus({ preventScroll: true });
    }

    // Capture phase: React dispatches onClick while bubbling, so this runs
    // first and Link sees the click as already handled.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}

"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "gc-theme";

/** Matches the two --background values in globals.css. */
const THEME_COLOR: Record<Theme, string> = {
  light: "#faf5ff",
  dark: "#0f0f23",
};

/**
 * Light/dark switch for the header.
 *
 * The icons are swapped by CSS keyed off `data-theme` (see globals.css), not
 * by React state, so the correct one is painted on the very first frame —
 * before hydration — and there is nothing for React to reconcile.
 *
 * The effective theme is read through `useSyncExternalStore` because it lives
 * in two places React does not own: the `data-theme` attribute and the OS
 * preference. Subscribing to both means the button's label stays accurate when
 * the visitor changes their system theme with the page already open.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";
    const root = document.documentElement;

    /*
     * Swap the palette with transitions switched off for this one frame.
     *
     * A CSS transition holds the computed colour it captured and does not
     * re-run when the custom property behind that colour changes, so any
     * element carrying `transition-colors` would keep painting the previous
     * theme's value — see the `.theme-switching` note in globals.css for the
     * measured failure. Reading a computed style between the attribute change
     * and removing the class forces the recalculation to happen while
     * transitions are still suppressed, which is what makes this synchronous
     * and leaves no chance of the class being left behind.
     */
    root.classList.add("theme-switching");
    root.dataset.theme = next;
    void window.getComputedStyle(root).backgroundColor;
    root.classList.remove("theme-switching");

    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing can refuse storage. The theme still applies to this
      // page view; it just will not persist. Not worth interrupting anyone.
    }

    /*
     * The two <meta name="theme-color"> tags Next emits are media-scoped, so
     * they now track the OS rather than the pinned theme. Collapse them onto
     * the chosen colour, otherwise mobile browser chrome stays the wrong shade.
     */
    document.querySelectorAll("meta[name='theme-color']").forEach((tag) => {
      tag.removeAttribute("media");
      tag.setAttribute("content", THEME_COLOR[next]);
    });

    emit();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        theme === null
          ? "Switch theme"
          : theme === "dark"
            ? "Switch to light theme"
            : "Switch to dark theme"
      }
      // The button does nothing without JavaScript, so it should not be
      // offered without JavaScript.
      className="requires-js group inline-grid h-11 w-11 place-items-center rounded-xl border border-transparent text-muted-foreground transition-colors duration-200 hover:border-border hover:bg-muted hover:text-foreground"
    >
      <span className="grid h-5 w-5">
        <MoonIcon className="theme-icon icon-moon h-5 w-5" />
        <SunIcon className="theme-icon icon-sun h-5 w-5" />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* External store: the DOM attribute + the OS preference               */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onStoreChange);

  return () => {
    listeners.delete(onStoreChange);
    query.removeEventListener("change", onStoreChange);
  };
}

/** Returns a primitive, so repeated calls are identity-stable for React. */
function getSnapshot(): Theme {
  const pinned = document.documentElement.dataset.theme;
  if (pinned === "light" || pinned === "dark") return pinned;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Neither theme is knowable on the server: the pinned value is in
 * localStorage and the fallback is the visitor's OS. `null` renders a neutral
 * label for the one frame before hydration, during which the button cannot be
 * used anyway.
 */
function getServerSnapshot(): null {
  return null;
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
    </svg>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { ProductCard } from "@/components/store/product-card";
import { KIND_LABELS } from "@/lib/catalogue-source";
import type { StorefrontProduct, StorefrontSection } from "@/lib/services/catalogue";
import { formatPkr } from "@/lib/utils/money";

/** Maximum tilt at the corners of a card. Past ~8deg it stops reading as a
 *  surface catching light and starts reading as a page bug. */
const MAX_TILT_DEG = 6;

/** Stagger wraps after this many cards so the tail of a long grid is not laggy. */
const STAGGER_WRAP = 4;

export function Catalogue({ sections }: { sections: StorefrontSection[] }) {
  const [selected, setSelected] = useState<StorefrontProduct | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback((product: StorefrontProduct) => {
    // Tapping the chosen card again clears it — otherwise a customer who
    // changes their mind has no way back to "nothing selected".
    setSelected((current) => (current?.id === product.id ? null : product));
  }, []);

  /*
   * Pointer-tracked tilt and specular highlight.
   *
   * One delegated listener for the entire grid, writing CSS custom properties
   * straight onto the hovered card. Deliberately outside React: a pointermove
   * fires on every frame, and routing that through state would re-render 26
   * cards per frame to move a highlight.
   *
   * Skipped entirely without a fine pointer (a tilt would stick after a tap on
   * touch) or under prefers-reduced-motion.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!finePointer.matches || reducedMotion.matches) return;

    let frame = 0;
    let pendingEvent: PointerEvent | null = null;
    let active: HTMLElement | null = null;

    const reset = (card: HTMLElement) => {
      card.style.removeProperty("--tilt-x");
      card.style.removeProperty("--tilt-y");
    };

    const paint = () => {
      frame = 0;
      const event = pendingEvent;
      pendingEvent = null;
      if (!event) return;

      const card =
        (event.target as Element | null)?.closest<HTMLElement>("[data-tilt]") ?? null;

      if (card !== active && active) reset(active);
      active = card;
      if (!card) return;

      // One rect read per frame rather than one per event.
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;

      card.style.setProperty("--tilt-y", `${(px - 0.5) * 2 * MAX_TILT_DEG}deg`);
      card.style.setProperty("--tilt-x", `${(0.5 - py) * 2 * MAX_TILT_DEG}deg`);
      card.style.setProperty("--px", `${px * 100}%`);
      card.style.setProperty("--py", `${py * 100}%`);
    };

    const onMove = (event: PointerEvent) => {
      pendingEvent = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onLeave = () => {
      if (active) reset(active);
      active = null;
    };

    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);

    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
      if (active) reset(active);
    };
  }, []);

  return (
    <>
      <div ref={rootRef} className="space-y-14">
        {sections.map((section, sectionIndex) => {
          const label = KIND_LABELS[section.kind];
          return (
            <section key={section.kind} aria-labelledby={`sec-${section.kind}`}>
              <div data-reveal className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3
                  id={`sec-${section.kind}`}
                  className="font-display text-xl font-bold sm:text-2xl"
                  style={
                    {
                      "--card-tone": `var(--spectrum-${(sectionIndex % 4) + 1})`,
                    } as CSSProperties
                  }
                >
                  {label.title}
                </h3>
                <p className="text-sm text-muted-foreground">{label.blurb}</p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                {section.products.map((product, i) => (
                  <div
                    key={product.id}
                    data-reveal
                    style={{ "--reveal-i": i % STAGGER_WRAP } as CSSProperties}
                    className="h-full"
                  >
                    <ProductCard
                      product={product}
                      selected={selected?.id === product.id}
                      onSelect={handleSelect}
                      tone={sectionIndex + i}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <SelectionBar selected={selected} onClear={() => setSelected(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Selection bar                                                       */
/* ------------------------------------------------------------------ */

/**
 * Sticky confirmation of what is chosen.
 *
 * Anchored to the bottom of the viewport because this site is used mostly on
 * phones, where the thumb is already there and the chosen card has usually
 * scrolled out of view by the time someone is ready to continue.
 *
 * It is rendered only when something is selected, and it reserves the safe
 * area so it clears the home indicator on a modern phone.
 */
function SelectionBar({
  selected,
  onClear,
}: {
  selected: StorefrontProduct | null;
  onClear: () => void;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {selected && (
        <div className="pointer-events-auto mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-border bg-card/95 p-3 shadow-[var(--shadow-raised)] backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{selected.displayName}</p>
            <p className="text-xs text-muted-foreground">
              {formatPkr(selected.pricePkr)} · Checkout opens in the next update
            </p>
          </div>

          <button
            type="button"
            onClick={onClear}
            className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear
          </button>

          {/*
            Deliberately disabled rather than hidden or linked to a 404: the
            checkout flow is the next build step, and a dead-end link would be
            worse than an honest unavailable state.
          */}
          <button
            type="button"
            disabled
            className="btn min-h-11 shrink-0 bg-accent px-4 text-sm text-accent-foreground"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}

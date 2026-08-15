import type { CSSProperties } from "react";

import { Catalogue } from "@/components/store/catalogue";
import { DiamondGlyph } from "@/components/store/diamond-glyph";
import { ButtonLink } from "@/components/ui/button";
import { getStorefront } from "@/lib/services/catalogue";
import { siteConfig } from "@/lib/site-config";

/**
 * Regenerate at most once a minute.
 *
 * Without this the page prerenders at build time and the catalogue is frozen
 * into the HTML — the owner could change a price and never see it until the
 * next deploy. Rendering per request instead would hit Atlas on every page
 * view, which is wasteful for a catalogue that changes a few times a month and
 * risks the connection cap on a shared tier.
 *
 * A price can therefore be up to 60s stale on screen. That cannot cause a
 * wrong charge: rule 1 means checkout re-reads the price from the database
 * server-side, so a stale display price is caught there rather than honoured.
 */
export const revalidate = 60;

export default async function HomePage() {
  const storefront = await getStorefront("mobile-legends");

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        {/* Ambient brand wash sitting over the page mesh. Decorative. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(46rem 26rem at 18% -12%, color-mix(in oklab, var(--primary) 20%, transparent), transparent 68%), radial-gradient(38rem 22rem at 88% 6%, color-mix(in oklab, var(--spectrum-3) 16%, transparent), transparent 66%)",
          }}
        />

        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:py-28">
          <div className="max-w-2xl">
            <span className="enter inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              Automated delivery · Mobile Legends
            </span>

            <h1
              style={{ "--enter-i": 1 } as CSSProperties}
              className="enter mt-6 font-display text-4xl font-bold leading-[1.08] sm:text-5xl lg:text-6xl"
            >
              Mobile Legends diamonds,{" "}
              <span className="text-gradient-brand">delivered in seconds</span>
            </h1>

            <p
              style={{ "--enter-i": 2 } as CSSProperties}
              className="enter mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground"
            >
              No waiting for a WhatsApp reply. Enter your Player ID, confirm
              it&apos;s your account, and pay — your diamonds land automatically.
            </p>

            <div
              style={{ "--enter-i": 3 } as CSSProperties}
              className="enter mt-9 flex flex-col gap-3 sm:flex-row"
            >
              <ButtonLink href="#packages" variant="buy" size="lg">
                Choose a package
              </ButtonLink>
              <ButtonLink href="/track" variant="outline" size="lg">
                Track an order
              </ButtonLink>
            </div>

            <p
              style={{ "--enter-i": 4 } as CSSProperties}
              className="enter mt-5 text-sm text-muted-foreground"
            >
              Pay with EasyPaisa, JazzCash, or any debit/credit card.
            </p>
          </div>

          {/*
            The stone. It is the product, and it is where the site's whole
            colour system comes from — every decorative hue on the page is one
            of the facets below. Hidden from AT: it says nothing the headline
            doesn't already say.
          */}
          <div
            aria-hidden="true"
            style={{ "--enter-i": 2 } as CSSProperties}
            className="enter relative mx-auto hidden aspect-square w-full max-w-md place-items-center lg:grid"
          >
            <span
              className="halo absolute h-3/5 w-3/5 rounded-full blur-3xl"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in oklab, var(--spectrum-2) 55%, transparent), transparent 70%)",
              }}
            />
            <BrilliantCut className="drift relative w-4/5" />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Trust strip — this site asks strangers for money, so the reasons  */}
      {/* to believe come before the product grid, not after it.            */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-label="Why buy from us"
        className="border-y border-border bg-card/40 backdrop-blur-sm"
      >
        <div className="mx-auto grid max-w-6xl divide-y divide-border px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-0">
          {TRUST_POINTS.map((point, i) => (
            <div
              key={point.title}
              data-reveal
              style={{ "--reveal-i": i } as CSSProperties}
              className="p-6 sm:p-8"
            >
              <span
                className="inline-grid h-10 w-10 place-items-center rounded-xl"
                style={{
                  color: `var(--spectrum-${point.stop})`,
                  background: `color-mix(in oklab, var(--spectrum-${point.stop}) 14%, transparent)`,
                }}
              >
                <point.Icon className="h-5 w-5" />
              </span>
              <h2 className="mt-4 font-display text-base font-semibold">
                {point.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {point.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Packages                                                          */}
      {/* ---------------------------------------------------------------- */}
      <section id="packages" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <div data-reveal>
            <Eyebrow tone={2}>Catalogue</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
              {storefront ? storefront.gameName : "Catalogue"}
            </h2>
            <p className="mt-3 max-w-lg text-muted-foreground">
              Every price is in PKR, all-in — what you see is what you pay. Pick
              a package, then confirm your in-game name before anything is
              charged.
            </p>
          </div>

          <div className="mt-10">
            {storefront ? (
              <Catalogue sections={storefront.sections} />
            ) : (
              /*
               * Shown when the catalogue cannot be read — an empty database or
               * a database that is down. Saying so plainly beats rendering an
               * empty grid that looks like we simply sell nothing.
               */
              <p
                role="status"
                className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
              >
                <strong className="font-semibold">
                  The catalogue is temporarily unavailable.
                </strong>{" "}
                Please try again in a few minutes — no order has been affected.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* How it works                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="border-y border-border bg-card/40 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <div data-reveal>
            <Eyebrow tone={3}>Three steps</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
              How it works
            </h2>
          </div>

          {/*
            Numbered because this genuinely is a sequence — you cannot pay
            before confirming the account. The numbers carry order, not
            decoration.
          */}
          <ol className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-6">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                data-reveal
                style={{ "--reveal-i": i } as CSSProperties}
                className="relative sm:pr-6"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-sm font-bold"
                    style={{
                      color: `var(--spectrum-${i + 1})`,
                      background: `color-mix(in oklab, var(--spectrum-${i + 1}) 14%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in oklab, var(--spectrum-${i + 1}) 30%, transparent)`,
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {/* Connector, drawn only between steps on wide screens. */}
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="hidden h-px flex-1 bg-gradient-to-r from-border to-transparent sm:block"
                    />
                  )}
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>

          <div
            data-reveal
            className="facet-edge glow-hover mt-12 flex items-start gap-3 rounded-2xl border border-border bg-card p-5 [--facet-tone:var(--accent)] [--glow-tone:var(--accent)]"
          >
            <DiamondGlyph className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              <strong className="font-semibold text-foreground">
                We always show your in-game name before you pay.
              </strong>{" "}
              A mistyped Player ID would send diamonds to a stranger, so we look
              your account up first and ask you to confirm it. If the name
              isn&apos;t yours, nothing is charged.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Closing CTA                                                       */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <div
            data-reveal
            className="facet-corner facet-edge relative overflow-hidden rounded-2xl border border-border bg-card p-8 [--facet-tone:var(--spectrum-3)] sm:p-12"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background:
                  "radial-gradient(30rem 16rem at 88% 110%, color-mix(in oklab, var(--spectrum-3) 16%, transparent), transparent 70%), radial-gradient(24rem 14rem at 4% -20%, color-mix(in oklab, var(--spectrum-2) 14%, transparent), transparent 70%)",
              }}
            />
            <h2 className="font-display text-2xl font-bold sm:text-3xl">
              Ready to top up?
            </h2>
            <p className="mt-3 max-w-lg text-muted-foreground">
              {siteConfig.tagline}
            </p>
            <ButtonLink href="#packages" variant="buy" size="lg" className="mt-7">
              Choose a package
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Section label                                                       */
/* ------------------------------------------------------------------ */

/**
 * Small tinted label above a section heading. It names what the section *is*
 * ("Catalogue", "Three steps") rather than repeating the heading, so it earns
 * the space instead of decorating it.
 */
function Eyebrow({ tone, children }: { tone: number; children: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]"
      style={{ color: `var(--spectrum-${tone})` }}
    >
      <span
        aria-hidden="true"
        className="h-px w-6"
        style={{ background: "currentColor" }}
      />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Static page content                                                 */
/* ------------------------------------------------------------------ */

const TRUST_POINTS = [
  {
    title: "Delivered automatically",
    body: "Orders are sent to the game the moment payment clears — typically within a minute, not hours.",
    Icon: BoltIcon,
    stop: 1,
  },
  {
    title: "Your card never touches us",
    body: "Payments are handled on PayFast's own secure checkout page. We never see or store your card details.",
    Icon: ShieldIcon,
    stop: 2,
  },
  {
    title: "No account needed",
    body: "No sign-up, no password. Just your Player ID and Zone ID, and an email to send the receipt to.",
    Icon: UserCheckIcon,
    stop: 3,
  },
] as const;

const STEPS = [
  {
    title: "Pick your package",
    body: "Choose the diamond tier you want. Every price is shown in PKR, all-in, with nothing added at checkout.",
  },
  {
    title: "Confirm it's your account",
    body: "Enter your Player ID and Zone ID. We look up your in-game name and show it to you before anything is charged.",
  },
  {
    title: "Pay and receive",
    body: "Pay securely through PayFast. Your diamonds are delivered automatically and you get an order ID to track it.",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Icons — SVG, never emoji (style rule: no emoji as icons)            */
/* ------------------------------------------------------------------ */

/**
 * A round-brilliant stone in profile: table, crown, girdle, pavilion, culet.
 * Each facet takes one stop of the dispersion ramp, which is where the page's
 * decorative palette is defined — the colour system is literally this object.
 */
function BrilliantCut({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="gc-facet-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--spectrum-1)" stopOpacity="0.85" />
          <stop offset="100%" stopColor="var(--spectrum-2)" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="gc-facet-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--spectrum-2)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--spectrum-3)" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id="gc-facet-c" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--spectrum-3)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="var(--spectrum-4)" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id="gc-facet-d" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="var(--spectrum-2)" stopOpacity="0.65" />
          <stop offset="100%" stopColor="var(--spectrum-1)" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="gc-facet-e" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="var(--spectrum-3)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--spectrum-2)" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="gc-facet-f" x1="1" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="var(--spectrum-4)" stopOpacity="0.7" />
          <stop offset="100%" stopColor="var(--spectrum-3)" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Crown */}
      <path d="M30 85 L70 40 L75 85 Z" fill="url(#gc-facet-a)" />
      <path d="M70 40 L130 40 L125 85 L75 85 Z" fill="url(#gc-facet-b)" />
      <path d="M130 40 L170 85 L125 85 Z" fill="url(#gc-facet-c)" />

      {/* Pavilion */}
      <path d="M30 85 L75 85 L100 175 Z" fill="url(#gc-facet-d)" />
      <path d="M75 85 L125 85 L100 175 Z" fill="url(#gc-facet-e)" />
      <path d="M125 85 L170 85 L100 175 Z" fill="url(#gc-facet-f)" />

      {/* Facet edges */}
      <g
        fill="none"
        stroke="var(--spectrum-2)"
        strokeOpacity="0.55"
        strokeWidth="1.25"
        strokeLinejoin="round"
      >
        <path d="M30 85 L70 40 L130 40 L170 85 L100 175 Z" />
        <path d="M30 85 H170" />
        <path d="M70 40 L75 85 M130 40 L125 85" />
        <path d="M75 85 L100 175 M125 85 L100 175" />
      </g>
    </svg>
  );
}

function BoltIcon({ className }: { className?: string }) {
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
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
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
      <path d="M12 2.5 20 6v6c0 5-3.4 8.4-8 9.5C7.4 20.4 4 17 4 12V6z" />
      <path d="m8.75 12 2.25 2.25 4.25-4.5" />
    </svg>
  );
}

function UserCheckIcon({ className }: { className?: string }) {
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
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6" />
      <path d="m16.5 11.5 2 2 4-4" />
    </svg>
  );
}

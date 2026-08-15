import { PackageCard, DiamondGlyph } from "@/components/store/package-card";
import { ButtonLink } from "@/components/ui/button";
import { PLACEHOLDER_PACKAGES } from "@/lib/placeholder-catalogue";
import { siteConfig } from "@/lib/site-config";

export default function HomePage() {
  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden border-b border-border">
        {/* Ambient brand wash. Purely decorative, hidden from AT. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60rem 30rem at 15% -10%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%), radial-gradient(45rem 25rem at 95% 10%, color-mix(in oklab, var(--highlight) 14%, transparent), transparent 70%)",
          }}
        />

        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              Automated delivery · Mobile Legends
            </span>

            <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] sm:text-5xl lg:text-6xl">
              Mobile Legends diamonds,{" "}
              <span className="text-gradient-brand">delivered in seconds</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              No waiting for a WhatsApp reply. Enter your Player ID, confirm
              it&apos;s your account, and pay — your diamonds land automatically.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="#packages" variant="buy" size="lg">
                Choose a package
              </ButtonLink>
              <ButtonLink href="/track" variant="outline" size="lg">
                Track an order
              </ButtonLink>
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
              Pay with EasyPaisa, JazzCash, or any debit/credit card.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Trust strip — this site asks strangers for money, so the reasons  */}
      {/* to believe come before the product grid, not after it.            */}
      {/* ---------------------------------------------------------------- */}
      <section aria-label="Why buy from us" className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-px bg-border px-5 sm:grid-cols-3 sm:px-0">
          {TRUST_POINTS.map((point) => (
            <div key={point.title} className="bg-background p-6 sm:p-8">
              <point.Icon className="h-5 w-5 text-accent" />
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
      <section id="packages" className="scroll-mt-20 border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-bold sm:text-4xl">
                Diamond packages
              </h2>
              <p className="mt-3 max-w-lg text-muted-foreground">
                Pick a tier, enter your Player ID and Zone ID, and confirm your
                in-game name before you pay.
              </p>
            </div>
          </div>

          {/*
            TODO(phase-3): replace PLACEHOLDER_PACKAGES with the synced,
            admin-curated catalogue from MongoDB. Prices below are illustrative
            layout data only — they are NOT real and must not ship publicly.
          */}
          <p
            role="status"
            className="mt-8 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
          >
            <strong className="font-semibold">Preview build.</strong> These
            packages and prices are placeholder layout data. The live catalogue
            syncs from our supplier in a later build step.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLACEHOLDER_PACKAGES.map((pkg) => (
              <PackageCard key={pkg.id} {...pkg} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* How it works                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">
            How it works
          </h2>

          <ol className="mt-10 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative">
                <span className="font-display text-sm font-bold text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 font-display text-lg font-semibold">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-12 flex items-start gap-3 rounded-2xl border border-border bg-card p-5">
            <DiamondGlyph className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
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
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="facet-corner rounded-2xl border border-border bg-card p-8 sm:p-12">
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
/* Static page content                                                 */
/* ------------------------------------------------------------------ */

const TRUST_POINTS = [
  {
    title: "Delivered automatically",
    body: "Orders are sent to the game the moment payment clears — typically within a minute, not hours.",
    Icon: BoltIcon,
  },
  {
    title: "Your card never touches us",
    body: "Payments are handled on PayFast's own secure checkout page. We never see or store your card details.",
    Icon: ShieldIcon,
  },
  {
    title: "No account needed",
    body: "No sign-up, no password. Just your Player ID and Zone ID, and an email to send the receipt to.",
    Icon: UserCheckIcon,
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

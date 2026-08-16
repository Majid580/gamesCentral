import type { ReactNode } from "react";

/**
 * Shared chrome for the policy pages. These exist partly to satisfy PayFast's
 * merchant review (Section 14), so they get the same design attention as the
 * storefront — a legal page that looks like an afterthought reads as an
 * untrustworthy business.
 */
export function LegalShell({
  title,
  intro,
  lastUpdated,
  children,
}: {
  title: string;
  intro: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-5 py-16 sm:py-20">
      <header className="border-b border-border pb-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          {intro}
        </p>
        <p className="mt-5 text-sm text-muted-foreground">
          Last updated: {lastUpdated}
        </p>
      </header>

      <div
        className={[
          "mt-10 space-y-8",
          "[&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-10 [&_h2]:mb-3",
          "[&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2",
          "[&_p]:leading-relaxed [&_p]:text-muted-foreground",
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_ul]:text-muted-foreground [&_ul]:leading-relaxed",
          "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-2 [&_ol]:text-muted-foreground [&_ol]:leading-relaxed",
          "[&_strong]:text-foreground [&_strong]:font-semibold",
          "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        ].join(" ")}
      >
        {children}
      </div>
    </article>
  );
}

/*
 * `DraftNotice` lived here — a conspicuous banner marking content the owner
 * still had to supply. Removed 2026-08-16 when the last placeholder was
 * filled in and every legal page went live-ready. Recoverable from git if a
 * future policy needs the same treatment; kept out of the tree meanwhile so
 * nothing unused is mistaken for something still in use.
 */

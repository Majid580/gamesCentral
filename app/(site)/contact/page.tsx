import type { Metadata } from "next";

import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact Games Central — registered office address, phone number, email, and support hours.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16 sm:py-20">
      <header className="border-b border-border pb-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">
          Contact us
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          A real person answers. If something has gone wrong with an order,
          message us with your order ID and we will sort it out.
        </p>
      </header>

      {/*
        Section 14 / Section 21: PayFast actively verifies that a real local
        office address and contact number are published here. Placeholders will
        fail merchant review — this notice stays until they are replaced.
      */}
      <p
        role="status"
        className="mt-8 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
      >
        <strong className="font-semibold">
          TODO(owner) — required before go-live.
        </strong>{" "}
        The address and phone number below are placeholders. PayFast verifies
        these during merchant review, so real, reachable details must replace
        them in{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">
          lib/site-config.ts
        </code>
        .
      </p>

      <dl className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
        <ContactItem label="Registered office">
          <address className="not-italic leading-relaxed">
            {siteConfig.contact.addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        </ContactItem>

        <ContactItem label="Phone">
          <a
            href={`tel:${siteConfig.contact.phone.replace(/\s/g, "")}`}
            className="text-primary underline underline-offset-2"
          >
            {siteConfig.contact.phone}
          </a>
        </ContactItem>

        <ContactItem label="Email">
          <a
            href={`mailto:${siteConfig.contact.email}`}
            className="text-primary underline underline-offset-2"
          >
            {siteConfig.contact.email}
          </a>
        </ContactItem>

        <ContactItem label="WhatsApp">
          <span>{siteConfig.contact.whatsapp}</span>
        </ContactItem>

        <ContactItem label="Support hours" className="sm:col-span-2">
          <span>{siteConfig.contact.hours}</span>
        </ContactItem>
      </dl>

      <section className="mt-12">
        <h2 className="font-display text-xl font-semibold">
          Before you message us
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Most questions are answered faster by checking your order status
          directly. Have your <strong className="text-foreground">order ID</strong>{" "}
          and the email or phone number you used at checkout ready — we need
          both to look an order up.
        </p>
        <ul className="mt-6 space-y-3 text-muted-foreground">
          <li>
            <a href="/track" className="text-primary underline underline-offset-2">
              Track an existing order
            </a>{" "}
            — status, delivery time, and supplier reference.
          </li>
          <li>
            <a href="/delivery" className="text-primary underline underline-offset-2">
              Delivery Policy
            </a>{" "}
            — how long delivery takes and what happens if it is delayed.
          </li>
          <li>
            <a href="/refund" className="text-primary underline underline-offset-2">
              Refund Policy
            </a>{" "}
            — when we can and cannot refund an order.
          </li>
        </ul>
      </section>
    </div>
  );
}

function ContactItem({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-card p-6 ${className ?? ""}`}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 text-[0.9375rem]">{children}</dd>
    </div>
  );
}

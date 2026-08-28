"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CheckoutProduct } from "@/lib/services/catalogue";
import { cn } from "@/lib/utils/cn";

/**
 * Checkout: identify the account, confirm it, then pay.
 *
 * The confirmation step is the reason this flow has three stages rather than
 * one form. A mistyped Player ID delivers to a stranger and the money is gone,
 * so the customer must see the in-game username the diamonds are going to and
 * actively accept it before anything is charged. It is never skipped and never
 * auto-advanced.
 */

type Stage = "identify" | "confirm" | "done";

type Verification = { username: string; zone: string | null; stubbed: boolean };

export function CheckoutForm({ product }: { product: CheckoutProduct }) {
  const router = useRouter();
  const ids = useId();

  const [stage, setStage] = useState<Stage>("identify");
  const [playerId, setPlayerId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [verification, setVerification] = useState<Verification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * More than one field can be at fault at once: the supplier returns the same
   * answer for a wrong Player ID and a wrong Zone ID, so both get marked.
   */
  const [errorFields, setErrorFields] = useState<string[]>([]);

  async function post(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      fields?: string[];
      [k: string]: unknown;
    };
    if (!response.ok) {
      const err = new Error(data.error ?? "Something went wrong. Please try again.");
      (err as Error & { fields?: string[] }).fields = data.fields;
      throw err;
    }
    return data;
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setErrorFields([]);

    try {
      const data = (await post("/api/checkout/verify-account", {
        sku: product.sku,
        playerId,
        zoneId: product.requiresZoneId ? zoneId : "1",
      })) as Verification;

      setVerification(data);
      setStage("confirm");
    } catch (e) {
      setError((e as Error).message);
      setErrorFields((e as Error & { fields?: string[] }).fields ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function handlePay(event: React.FormEvent) {
    event.preventDefault();
    if (!verification) return;

    setBusy(true);
    setError(null);
    setErrorFields([]);

    try {
      const data = (await post("/api/checkout/create-order", {
        sku: product.sku,
        playerId,
        zoneId: product.requiresZoneId ? zoneId : "1",
        // Sent so the server can flag a disagreement with its own lookup, not
        // to be stored. The order records the server's answer.
        confirmedUsername: verification.username,
        contactEmail: email,
        contactPhone: phone,
        // Echoed so the server can report a mid-checkout price change. It
        // never sets the price — the server re-reads that from the catalogue.
        quotedPricePkr: product.pricePkr,
      })) as { orderId: string };

      setStage("done");

      /*
       * The order exists and is priced. Now hand off to PayFast.
       *
       * A failure here must not look like a failed order: the order is saved
       * either way, so anything that goes wrong lands the customer on their
       * order page with their ID rather than back on a form that would create
       * a second one. That includes the expected case where PayFast is not
       * connected yet.
       */
      try {
        const payment = (await post("/api/payments/payfast/begin", {
          orderId: data.orderId,
        })) as unknown as { action: string; fields: Record<string, string> };
        submitToGateway(payment);
        return;
      } catch {
        router.push(`/order/${data.orderId}`);
        return;
      }
    } catch (e) {
      setError((e as Error).message);
      setErrorFields((e as Error & { fields?: string[] }).fields ?? []);
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- */

  if (stage === "identify") {
    return (
      <form onSubmit={handleVerify} noValidate className="space-y-5">
        <Field
          id={`${ids}-player`}
          label="Player ID"
          hint="Tap your avatar in-game — the ID is under your name."
          value={playerId}
          onChange={setPlayerId}
          inputMode="numeric"
          autoComplete="off"
          invalid={errorFields.includes("playerId")}
          required
        />

        {product.requiresZoneId && (
          <Field
            id={`${ids}-zone`}
            label="Zone ID"
            hint="The number in brackets next to your Player ID."
            value={zoneId}
            onChange={setZoneId}
            inputMode="numeric"
            autoComplete="off"
            invalid={errorFields.includes("zoneId")}
            required
          />
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <Button type="submit" variant="primary" size="lg" disabled={busy} className="w-full">
          {busy ? "Checking your account…" : "Find my account"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          We look your account up first and show you the name. Nothing is
          charged until you confirm it.
        </p>
      </form>
    );
  }

  if (stage === "confirm" && verification) {
    return (
      <form onSubmit={handlePay} noValidate className="space-y-5">
        {/*
          The whole point of the flow. Stated as a question the customer has to
          answer, not as a banner they can scroll past.
        */}
        <div className="facet-edge rounded-2xl border border-primary/45 bg-primary-soft/60 p-5 [--facet-tone:var(--primary)]">
          <p className="text-sm text-muted-foreground">Confirm this is your account</p>
          <p className="mt-1 break-words font-display text-2xl font-bold">
            {verification.username}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Player ID {playerId}
            {product.requiresZoneId && ` · Zone ${zoneId}`}
          </p>

          {verification.stubbed && (
            <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              <strong className="font-semibold">Development stub.</strong> This
              name is generated, not a real lookup — SMILEONE_STUB is set.
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setStage("identify");
              setVerification(null);
              setError(null);
              setErrorFields([]);
            }}
            className="mt-4 min-h-11 text-sm font-medium text-primary underline underline-offset-4"
          >
            That&apos;s not me — change ID
          </button>
        </div>

        <Field
          id={`${ids}-email`}
          label="Email"
          hint="Your receipt and order ID go here."
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          invalid={errorFields.includes("contactEmail")}
          required
        />

        <Field
          id={`${ids}-phone`}
          label="Mobile number"
          hint="So we can reach you if there's a problem with delivery."
          type="tel"
          value={phone}
          onChange={setPhone}
          autoComplete="tel"
          invalid={errorFields.includes("contactPhone")}
          required
        />

        {error && <ErrorNote>{error}</ErrorNote>}

        <Button type="submit" variant="buy" size="lg" disabled={busy} className="w-full">
          {busy ? "Creating your order…" : "Confirm and continue to payment"}
        </Button>
      </form>
    );
  }

  return (
    <p role="status" className="text-sm text-muted-foreground">
      Taking you to your order…
    </p>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Sends the browser to PayFast's hosted payment page.
 *
 * A real form POST rather than `fetch` + redirect: hosted checkout expects the
 * customer's own browser to arrive with the fields, and a background request
 * would fetch the payment page into JavaScript where nobody can pay on it.
 *
 * Nothing secret travels here. The access token is short-lived and scoped to
 * this transaction, and the merchant id is public in any redirect flow — the
 * `secured_key` never leaves the server. The amount is not trusted either: it
 * is re-read from our database during verification, so a customer editing this
 * form changes what the gateway displays and nothing about what we accept.
 */
function submitToGateway(payment: { action: string; fields: Record<string, string> }) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = payment.action;

  for (const [name, value] of Object.entries(payment.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  invalid,
  ...input
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
} & Omit<React.ComponentProps<"input">, "onChange" | "value" | "id">) {
  const hintId = `${id}-hint`;

  return (
    <div>
      {/* A visible label, never a placeholder standing in for one — the
          placeholder disappears exactly when it is needed most. */}
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <p id={hintId} className="mt-1 text-xs text-muted-foreground">
        {hint}
      </p>
      <input
        {...input}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hintId}
        aria-invalid={invalid || undefined}
        className={cn(
          "mt-2 h-12 w-full rounded-xl border bg-input px-4 text-base",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring",
          invalid ? "border-destructive" : "border-border",
        )}
      />
    </div>
  );
}

/** Errors sit next to the control that caused them, not in a banner up top. */
function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
    >
      {children}
    </p>
  );
}

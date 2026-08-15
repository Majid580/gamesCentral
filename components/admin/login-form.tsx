"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

export type LoginState = { error?: string };

/**
 * Admin sign-in form.
 *
 * A client component for two reasons.
 *
 * FIELD CLEARING. Two things refill these boxes, and neither is our code: the
 * browser's password manager autofills on arrival, and these are uncontrolled
 * inputs whose DOM nodes React reuses across a client-side navigation — a DOM
 * node keeps whatever was typed into it. So a failed attempt, or a sign-out
 * that lands here, could leave the previous operator's credentials on screen.
 * On a shared terminal that is the whole problem. The form is reset on submit,
 * on mount, and on `pageshow` (which is what fires when the browser restores
 * this page from the back/forward cache, where a mount effect does not run).
 *
 * ERROR REPORTING. The failure is returned as action state rather than
 * bounced through a `?error=` redirect. The redirect version failed silently:
 * the navigation did not carry the parameter, so a wrong password cleared the
 * fields and said nothing at all, which is worse than saying too much.
 */
export function AdminLoginForm({
  action,
}: {
  action: (state: LoginState, formData: FormData) => Promise<LoginState>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, {});

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const clear = () => form.reset();
    clear();

    // Chrome fills saved credentials after load rather than during it, so a
    // single synchronous clear on mount can run too early to catch it.
    const settle = window.setTimeout(clear, 120);
    const onPageShow = () => clear();
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return (
    <>
      {state.error && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
        >
          {state.error}
        </p>
      )}

      <form
        ref={formRef}
        action={formAction}
        // Discourages the password manager from refilling. Browsers do not
        // reliably honour this on credential fields, which is why the reset
        // above exists as well rather than instead.
        autoComplete="off"
        onSubmit={() => {
          /*
           * React serialises the FormData synchronously while handling the
           * submit event, so clearing on the next animation frame cannot race
           * the submission — the action already holds the values.
           */
          requestAnimationFrame(() => formRef.current?.reset());
        }}
        className="mt-8 space-y-5"
      >
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="off"
            defaultValue=""
            className="mt-2 h-12 w-full rounded-xl border border-border bg-input px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            // `new-password` is the value Chrome actually respects for "do not
            // fill the saved credential here"; `off` alone is often ignored on
            // password inputs.
            autoComplete="new-password"
            defaultValue=""
            className="mt-2 h-12 w-full rounded-xl border border-border bg-input px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={pending}
          className="w-full"
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </>
  );
}

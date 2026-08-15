import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Admin sign in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin sign-in.
 *
 * A Server Action rather than a client fetch, so the password is never held in
 * client state and there is no JSON endpoint to script against beyond the one
 * Auth.js already exposes.
 *
 * Every failure renders the same message. Distinguishing "no such account"
 * from "wrong password" — or naming the rate limit — turns this form into an
 * account-enumeration oracle.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const { error, from } = await searchParams;

  // Already signed in: nothing to do here.
  const session = await auth();
  if (session?.user) redirect("/admin");

  async function signInAction(formData: FormData) {
    "use server";

    const target =
      typeof from === "string" && from.startsWith("/admin") && !from.startsWith("//")
        ? from
        : "/admin";

    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        redirectTo: target,
      });
    } catch (e) {
      // next-redirect errors must propagate — that is how a successful sign-in
      // navigates. Only a genuine auth failure becomes the generic message.
      if (e && typeof e === "object" && "digest" in e) throw e;
      redirect(`/admin/login?error=1${from ? `&from=${encodeURIComponent(from)}` : ""}`);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-16">
      <h1 className="font-display text-2xl font-bold">Admin sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Staff access only. Customer orders don&apos;t need an account.
      </p>

      <form action={signInAction} className="mt-8 space-y-5">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
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
            autoComplete="current-password"
            className="mt-2 h-12 w-full rounded-xl border border-border bg-input px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
          >
            That email and password combination didn&apos;t work. Repeated
            failures are temporarily blocked.
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" className="w-full">
          Sign in
        </Button>
      </form>
    </main>
  );
}

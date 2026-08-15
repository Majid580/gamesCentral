import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { AdminLoginForm, type LoginState } from "@/components/admin/login-form";

export const metadata: Metadata = {
  title: "Admin sign in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin sign-in.
 *
 * A Server Action, so the password is never held in client state and there is
 * no extra JSON endpoint to script against beyond the one Auth.js exposes.
 *
 * Every failure returns the same message. Distinguishing "no such account"
 * from "wrong password" — or naming the rate limit — turns this form into an
 * account-enumeration oracle.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  // Already signed in: nothing to do here.
  const session = await auth();
  if (session?.user) redirect("/admin");

  async function signInAction(
    _previous: LoginState,
    formData: FormData,
  ): Promise<LoginState> {
    "use server";

    /*
     * Only same-site admin paths are accepted as a post-login destination.
     * `//evil.example` is protocol-relative and would otherwise be treated as
     * an absolute URL, turning the `from` parameter into an open redirect.
     */
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

      // Unreachable: a successful signIn redirects by throwing.
      return {};
    } catch (error) {
      // NEXT_REDIRECT carries a `digest` and MUST propagate — that throw is
      // how a successful sign-in navigates. Anything else is an auth failure.
      if (error && typeof error === "object" && "digest" in error) throw error;

      return {
        error:
          "That email and password combination didn't work. Repeated failures are temporarily blocked.",
      };
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-16">
      <h1 className="font-display text-2xl font-bold">Admin sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Staff access only. Customer orders don&apos;t need an account.
      </p>

      <AdminLoginForm action={signInAction} />
    </main>
  );
}

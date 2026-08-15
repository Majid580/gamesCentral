import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { auth, signOut } from "@/auth";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Games Central admin" },
  robots: { index: false, follow: false },
};

/**
 * Admin chrome.
 *
 * Deliberately does NOT call requireAdmin(): this layout also wraps
 * /admin/login, which must render while signed out. Authorisation lives in the
 * data functions each page calls, so a page cannot render customer data
 * without having passed a check.
 *
 * The header is rendered only when there IS a session. Otherwise the login
 * page shows Dashboard/Orders links and a Sign out button to someone who is
 * signed out — links that just bounce back to login, next to a control for
 * ending a session that does not exist.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/admin/login" });
  }

  if (!session?.user) return <div className="min-h-dvh">{children}</div>;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
          <Link href="/admin" className="font-display text-sm font-bold">
            Games Central
            <span className="ml-2 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
              Admin
            </span>
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/admin"
              className="flex min-h-11 items-center rounded-lg px-3 hover:bg-muted"
            >
              Dashboard
            </Link>
            <Link
              href="/admin/orders"
              className="flex min-h-11 items-center rounded-lg px-3 hover:bg-muted"
            >
              Orders
            </Link>
          </nav>

          <form action={signOutAction} className="ml-auto">
            <button
              type="submit"
              className="min-h-11 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {children}
    </div>
  );
}

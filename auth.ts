import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import {
  verifyAdminCredentials,
  isRateLimited,
  recordFailedAttempt,
  clearAttempts,
  touchLastLogin,
} from "@/lib/services/admin-auth";

/**
 * Admin authentication (Auth.js v5).
 *
 * Admins are the only accounts in the system — customers check out as guests.
 * There is no sign-up path and no provider that could create an account: the
 * only way an AdminUser exists is `npm run admin:create` run by hand on the
 * server.
 *
 * Sessions are JWT rather than database-backed. The admin area is a handful of
 * pages behind one login; a session collection would add a database round trip
 * to every request to solve a revocation problem that `isActive` on the user
 * already covers on the paths that matter.
 */

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

export const { auth, handlers, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    // Short by design. This session can refund, retry, and read customer
    // contact details; an admin laptop left open should not stay authorised
    // all week.
    maxAge: 8 * 60 * 60,
  },

  pages: {
    signIn: "/admin/login",
    error: "/admin/login",
  },

  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        /*
         * Rate limited on the email AND the client IP as separate counters.
         * Email-only lets an attacker lock a real admin out; IP-only lets a
         * botnet spread one password list across many addresses.
         */
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          request.headers.get("x-real-ip") ||
          "unknown";
        const keys = [`email:${email.toLowerCase()}`, `ip:${ip}`];

        if (await isRateLimited(keys)) {
          // Auth.js surfaces a null return as a generic failure, which is what
          // we want — the form must not confirm that this address exists.
          console.warn("[admin] login rate limited", { ip });
          return null;
        }

        const admin = await verifyAdminCredentials(email, password);

        if (!admin) {
          await recordFailedAttempt(keys);
          return null;
        }

        await clearAttempts(keys);
        await touchLastLogin(admin.id);

        return { id: admin.id, email: admin.email, role: admin.role };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) token.role = (user as { role?: string }).role ?? "operator";
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.sub);
        (session.user as { role?: string }).role = String(token.role ?? "operator");
      }
      return session;
    },
  },

  trustHost: true,
});

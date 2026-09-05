import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Baseline Content-Security-Policy.
 *
 * `'unsafe-inline'` on script-src is required because Next.js emits inline
 * bootstrap/hydration scripts and we deliberately keep the marketing pages
 * statically rendered — a nonce would force every page dynamic.
 *
 * Phase 9 (2026-09-06) looked at this and left it, which is the second time
 * the same conclusion has been reached; the sentence that used to sit here
 * promising Phase 9 would adopt a nonce is what invited the re-litigation, so
 * it is gone. The reasoning, recorded in project_state.yaml on 2026-08-18: the
 * only `dangerouslySetInnerHTML` in the codebase is the pre-paint theme script
 * and its content is a compile-time constant, React escapes everything else,
 * so there is no injection sink for a nonce to defend — a real cost against a
 * hypothetical benefit. Re-open only if a genuine HTML sink is introduced.
 *
 * `'unsafe-eval'` is dev-only (React Refresh needs it).
 *
 * `form-action` MUST list PayFast, and this is not a nicety. The handoff is a
 * real cross-origin form POST built in `submitToGateway()`, so `'self'` alone
 * makes the browser refuse to submit it — the customer clicks Pay and simply
 * nothing happens, with the reason only in the console. See PAYFAST_ORIGINS.
 */

/**
 * Origins the checkout form is allowed to POST to.
 *
 * Mirrors `BASE_URLS` in lib/services/payfast/client.ts. Both hosts are listed
 * rather than switching on PAYFAST_MODE, because this header is baked at build
 * time while the mode is read at runtime — deriving it from the mode would let
 * a sandbox build silently block a production payment. Listing both costs
 * nothing: they are the same company's gateway, and neither is somewhere an
 * attacker would want a form sent.
 *
 * ⚠️ `PAYFAST_API_BASE_URL` is read here too, but it is read AT BUILD TIME.
 * Overriding the host on a running server without rebuilding leaves this
 * header stale and payments will be blocked. Rebuild after changing it.
 */
const PAYFAST_ORIGINS = (() => {
  const known = ["https://ipguat.apps.net.pk", "https://ipg1.apps.net.pk"];

  const override = process.env.PAYFAST_API_BASE_URL?.trim();
  if (override) {
    try {
      known.push(new URL(override).origin);
    } catch {
      // A malformed override is a configuration error, not a reason to emit a
      // broken header. The known hosts still apply and the client will fail
      // loudly on its own.
      console.warn("[csp] PAYFAST_API_BASE_URL is not a valid URL; ignoring it");
    }
  }

  return [...new Set(known)];
})();

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action 'self' ${PAYFAST_ORIGINS.join(" ")}`,
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  /**
   * Production target is Hostinger (self-hosted Node), while previews run on
   * Vercel. `standalone` is opt-in via BUILD_STANDALONE=1 so the Hostinger
   * build produces a self-contained .next/standalone bundle without changing
   * the default Vercel/dev build.
   */
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,

  /*
   * Left for Node to require at runtime rather than bundled. Both use dynamic
   * requires that a bundler cannot follow — nodemailer resolves its transports
   * and DNS helpers that way — and bundling them produces failures that only
   * appear in a production build.
   */
  serverExternalPackages: ["mongoose", "nodemailer"],

  images: {
    formats: ["image/avif", "image/webp"],
  },

  // Security headers are set here (not vercel.json) so they survive the
  // Hostinger cutover unchanged.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

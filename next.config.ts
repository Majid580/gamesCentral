import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Baseline Content-Security-Policy.
 *
 * `'unsafe-inline'` on script-src is required because Next.js emits inline
 * bootstrap/hydration scripts and we deliberately keep the marketing pages
 * statically rendered — a nonce would force every page dynamic. Phase 9
 * (security hardening) revisits this to apply nonce + 'strict-dynamic' on the
 * dynamic routes only. `'unsafe-eval'` is dev-only (React Refresh needs it).
 *
 * `form-action` is intentionally broad enough for the PayFast redirect handoff;
 * the exact PayFast origin gets pinned in Phase 5 once the hosted-checkout
 * endpoint is confirmed.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
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

  // Mongoose relies on Node.js internals and must not be bundled.
  serverExternalPackages: ["mongoose"],

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

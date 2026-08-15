import "server-only";

import { z } from "zod";

/**
 * Server-side environment access.
 *
 * Validation is lazy (on first access) rather than at module load so that
 * `next build` succeeds in environments that legitimately lack runtime
 * secrets — but any request path that actually needs a secret fails loudly
 * and immediately instead of sending `undefined` to Mongo, SmileOne, or
 * PayFast.
 *
 * `import "server-only"` makes it a build error to pull this into a Client
 * Component, which is the guardrail behind Section 12.2: no secret ever
 * reaches the browser bundle. Nothing here is NEXT_PUBLIC_-prefixed by design.
 */

const serverEnvSchema = z.object({
  // Database
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (v) => v.startsWith("mongodb://") || v.startsWith("mongodb+srv://"),
      "DATABASE_URL must be a MongoDB connection string",
    ),

  // SmileOne
  SMILEONE_API_BASE_URL: z.url(),
  SMILEONE_UID: z.string().min(1),
  SMILEONE_EMAIL: z.email(),
  SMILEONE_KEY: z.string().min(1),

  // PayFast
  PAYFAST_MERCHANT_ID: z.string().min(1),
  PAYFAST_SECURED_KEY: z.string().min(1),
  PAYFAST_MODE: z.enum(["sandbox", "production"]).default("sandbox"),

  // App
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be >= 32 chars"),
  ADMIN_EMAIL: z.email(),
  CRON_SECRET: z.string().min(32, "CRON_SECRET must be >= 32 chars"),

  // Pricing — kept as strings in env, coerced to numbers here.
  DEFAULT_MARKUP_PERCENTAGE: z.coerce.number().min(0).max(500),
  USD_TO_PKR_RATE: z.coerce.number().positive(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Returns the fully validated server environment, throwing on the first call
 * if anything is missing or malformed. Never call this from a Client Component.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Report which variables are wrong, never their values.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing environment variables:\n${issues}\n\n` +
        "See .env.example for the full list.",
    );
  }

  cached = parsed.data;
  return cached;
}

/**
 * Reads a single required variable without validating the whole environment.
 * Useful for narrow paths (e.g. the DB helper) that should not fail because
 * an unrelated integration is not configured yet.
 */
export function requireEnv(name: keyof ServerEnv): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

/**
 * The canonical public site origin. Safe to expose — it is the site's own URL.
 * Falls back to localhost in development so PayFast return URLs resolve.
 */
export function siteUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : undefined);
  if (!url) throw new Error("Missing required NEXT_PUBLIC_SITE_URL.");
  return url.replace(/\/+$/, "");
}

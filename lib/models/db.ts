import "server-only";

import mongoose from "mongoose";

import { requireEnv } from "@/lib/env";
import { resolveMongoUri } from "@/lib/utils/dns-resolver";

/**
 * Pooled Mongoose connection, cached on the global object.
 *
 * Why the global: in a serverless environment (Vercel previews) each
 * invocation may reuse a warm module scope but NOT re-run module top-level
 * reliably across instances — and in dev, Next.js hot-reload re-evaluates
 * modules on every edit. Caching on `globalThis` means we open one pool per
 * process instead of one per request, which is the classic
 * MongoDB-on-serverless connection-limit bug called out in Section 19.
 *
 * On the Hostinger production target this is a long-lived Node process, where
 * the same cache simply means "connect once at first use".
 */

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalWithMongoose = globalThis as typeof globalThis & {
  __gamesCentralMongoose?: MongooseCache;
};

const cache: MongooseCache = (globalWithMongoose.__gamesCentralMongoose ??= {
  conn: null,
  promise: null,
});

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    const uri = requireEnv("DATABASE_URL");

    // `mongodb+srv://` needs an SRV lookup that bypasses the OS resolver.
    // Returns the URI untouched wherever that works — see the module comment.
    cache.promise = resolveMongoUri(uri).then((dialable) =>
      mongoose.connect(dialable, {
        // Fail fast instead of silently queueing operations when the pool is
        // down — a hung checkout is worse than a clear error.
        bufferCommands: false,
        // Atlas free/shared tiers cap connections; 10 per process is ample for
        // this workload and leaves headroom for concurrent serverless instances.
        maxPoolSize: 10,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 5_000,
        // Indexes are created explicitly via `syncIndexes` in tooling, not
        // implicitly on every cold start.
        autoIndex: false,
      }),
    );
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    // Clear the rejected promise so the next request retries rather than
    // replaying the same failure forever.
    cache.promise = null;
    throw error;
  }

  return cache.conn;
}

/**
 * Guards against NoSQL operator injection: Mongo treats an object value such
 * as `{ $ne: null }` as an operator, so any field that is contractually a
 * scalar must be rejected when it arrives as an object or array.
 *
 * Every externally supplied value that reaches a query filter goes through
 * this (Section 12.7).
 */
export function assertScalar(value: unknown, field: string): string | number {
  if (typeof value === "string" || typeof value === "number") return value;
  throw new Error(`Invalid value for ${field}: expected a scalar.`);
}

import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { defineModel } from "./define-model.ts";

/**
 * A general request counter for rate limiting anything that is not a login.
 *
 * Separate from `LoginAttempt` because the two count opposite things. A login
 * limiter counts only *failures* — succeeding clears the counter, since a user
 * who knows their password is not the threat. This counts **every** call,
 * successful or not, because the cost being limited is the call itself: each
 * account lookup spends a request against the owner's SmileOne account whether
 * or not it finds anything.
 *
 * MongoDB-backed rather than an edge KV store: production is a self-hosted
 * Hostinger Node process and nothing here may depend on a Vercel-only
 * primitive.
 *
 * Rows expire via a TTL index. A rate limiter with its own cleanup job is a
 * rate limiter that silently stops working the day the job dies.
 */
const rateLimitHitSchema = new Schema({
  /**
   * Namespaced bucket, e.g. `lookup:ip:1.2.3.4` or `lookup:global`. The
   * namespace matters: two limiters sharing a key would drain each other's
   * budget.
   */
  key: { type: String, required: true },
  at: { type: Date, required: true, default: Date.now },
});

/*
 * One hour, deliberately longer than any window that uses this collection.
 * The TTL is garbage collection, not the limit — each limiter narrows to its
 * own window with an `at: { $gte: … }` filter, so one collection can serve
 * several limiters with different windows.
 */
rateLimitHitSchema.index({ at: 1 }, { expireAfterSeconds: 3600 });
rateLimitHitSchema.index({ key: 1, at: -1 });

export type RateLimitHit = InferSchemaType<typeof rateLimitHitSchema>;

export const RateLimitHitModel = defineModel("RateLimitHit", rateLimitHitSchema);

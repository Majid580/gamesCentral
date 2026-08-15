import "server-only";

import { Schema, type InferSchemaType } from "mongoose";

import { defineModel } from "./define-model.ts";

/**
 * Failed admin login attempts, used to rate-limit the login form.
 *
 * MongoDB-backed rather than an edge KV store, because production is a
 * self-hosted Hostinger Node process and nothing in this codebase may depend
 * on a Vercel-only primitive.
 *
 * Rows expire on their own via a TTL index — a rate limiter that needs its own
 * cleanup job is a rate limiter that silently stops working when the job dies.
 */
const loginAttemptSchema = new Schema({
  /**
   * What is being limited. Both the email and the client IP are counted
   * separately: limiting on email alone lets one attacker lock every account
   * out, and limiting on IP alone lets a botnet walk one password list across
   * many addresses.
   */
  key: { type: String, required: true },
  at: { type: Date, required: true, default: Date.now },
});

// Sweeps automatically 15 minutes after each attempt.
loginAttemptSchema.index({ at: 1 }, { expireAfterSeconds: 900 });
loginAttemptSchema.index({ key: 1, at: -1 });

export type LoginAttempt = InferSchemaType<typeof loginAttemptSchema>;

export const LoginAttemptModel = defineModel("LoginAttempt", loginAttemptSchema);

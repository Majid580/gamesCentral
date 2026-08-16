import "server-only";

import mongoose, { type Model, type Schema } from "mongoose";

/**
 * Registers a Mongoose model exactly once per process.
 *
 * Calling `mongoose.model(name, schema)` twice with the same name throws
 * `OverwriteModelError`. That happens constantly in development, where
 * Next.js re-evaluates modules on every edit while the `mongoose` singleton
 * survives on `globalThis` (see `./db.ts`). Reusing the already-registered
 * model keeps hot reload working without weakening anything in production,
 * where this branch is taken exactly once.
 *
 * THE TRAP THIS CREATES. The cached model keeps its ORIGINAL schema, so once
 * you add a field, a running dev server keeps writing with the old one — and
 * Mongoose silently strips fields it does not know about. The write succeeds,
 * the document comes back missing the new field, and nothing reports an error.
 * Observed for real when `fulfilmentPlan` was added: orders saved without it
 * until the server was restarted.
 *
 * **Restart `npm run dev` after changing a schema.** Hot reload is not enough.
 */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  const existing = mongoose.models[name] as Model<T> | undefined;
  return existing ?? mongoose.model<T>(name, schema);
}

/**
 * A money field held as an integer in the smallest currency unit.
 *
 * Non-negotiable rule 5: money is never a float. Binary floating point cannot
 * represent 0.1 exactly, and the error compounds across the USD->PKR
 * conversion and the markup multiplication. The validator makes a float a
 * write-time failure rather than a slow drift nobody notices until
 * reconciliation.
 */
export function integerMoneyField(description: string) {
  return {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: (props: { path: string; value: unknown }) =>
        `${props.path} must be an integer (${description}); received ${String(props.value)}.`,
    },
  } as const;
}

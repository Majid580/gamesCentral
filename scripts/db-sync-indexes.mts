/**
 * Explicit index synchronisation.
 *
 * Run with:  npm run db:sync-indexes
 *
 * The Mongoose connection sets `autoIndex: false` (see lib/models/db.ts), so
 * indexes are never built implicitly on a cold start — index builds under
 * production load are a classic self-inflicted outage. They are created here
 * instead, deliberately, as a deploy step.
 *
 * `syncIndexes()` also DROPS indexes that exist in MongoDB but are no longer
 * declared in the schema, which is what keeps the declared model and the real
 * collection from drifting. That makes it destructive on indexes (never on
 * documents).
 *
 * WHY THE DROPS ARE GATED AND THE CREATES ARE NOT
 *
 * There is one database. `DATABASE_URL` points at the live `gamescentral`
 * cluster holding real orders, because no other one exists — so this one-word
 * npm script was, until 2026-09-06, an unguarded way to drop indexes off
 * production. Dropping the wrong index does not lose a document; it turns the
 * queries behind checkout and order lookup into collection scans, and on a TTL
 * index it stops the rate limiter and the login lockout expiring rows at all.
 *
 * Creating an index is safe and idempotent, and gating it would have broken
 * the deploy step this script exists to be. So the plan is computed first with
 * `diffIndexes()`, and only a DROP needs `--yes`. A run with nothing to drop
 * behaves exactly as it always did.
 *
 * Nothing is applied partially: if drops are pending without `--yes`, the run
 * refuses as a whole rather than creating half a plan.
 *
 * `--conditions=react-server` (set in the npm script) makes the `server-only`
 * marker package resolve to its empty stub, letting these models load outside
 * the Next.js runtime. Without it every model import throws.
 */

import mongoose from "mongoose";

import { resolveMongoUri } from "../lib/utils/dns-resolver.ts";
import { AdminUserModel } from "../lib/models/admin-user.ts";
import { AppConfigModel } from "../lib/models/app-config.ts";
import { GameModel } from "../lib/models/game.ts";
import { LoginAttemptModel } from "../lib/models/login-attempt.ts";
import { OrderModel } from "../lib/models/order.ts";
import { ProductModel } from "../lib/models/product.ts";
import { RateLimitHitModel } from "../lib/models/rate-limit-hit.ts";

const uri = process.env.DATABASE_URL;

if (!uri) {
  console.error("DATABASE_URL is not set. Run this via `npm run db:sync-indexes`.");
  process.exit(1);
}

/** Authorises the destructive half only. Creates never need it. */
const APPROVED = process.argv.includes("--yes");

/**
 * The username from a connection string, never the password. Printed so it is
 * obvious which credentials — and after the Atlas rotation, which user — this
 * is about to reshape indexes with.
 */
function usernameOf(connectionString: string): string {
  const match = /\/\/([^:/@]+)(?::[^@]*)?@/.exec(connectionString);
  return match ? decodeURIComponent(match[1]) : "(none in URI)";
}

const models = [
  GameModel,
  ProductModel,
  OrderModel,
  AppConfigModel,
  AdminUserModel,
  LoginAttemptModel,
  RateLimitHitModel,
];

try {
  const dialable = await resolveMongoUri(uri);

  await mongoose.connect(dialable, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
  });

  console.log(`Syncing indexes on ${mongoose.connection.db?.databaseName}`);
  console.log(`  connected as: ${usernameOf(uri)}\n`);

  /* ---- work out the whole plan before changing anything ---- */

  const plan: { model: (typeof models)[number]; toDrop: string[]; toCreate: number }[] = [];

  for (const model of models) {
    const diff = await model.diffIndexes();

    // `toDrop` entries are index names, but stringify defensively rather than
    // assume: a spec object rendered as "[object Object]" in the refusal above
    // would tell an operator nothing about what they were being asked to lose.
    const toDrop = (diff.toDrop ?? []).map((entry: unknown) =>
      typeof entry === "string" ? entry : JSON.stringify(entry),
    );

    plan.push({ model, toDrop, toCreate: (diff.toCreate ?? []).length });
  }

  const creates = plan.reduce((total, entry) => total + entry.toCreate, 0);
  if (creates > 0) console.log(`  ${creates} index(es) to create\n`);

  const drops = plan.filter((entry) => entry.toDrop.length > 0);

  if (drops.length > 0 && !APPROVED) {
    console.error("\nThis would DROP existing indexes:\n");
    for (const { model, toDrop } of drops) {
      console.error(`  ${model.modelName}: ${toDrop.join(", ")}`);
    }
    console.error(
      "\nRefusing, because this is pointed at " +
        `${mongoose.connection.db?.databaseName} and there is only one database.\n` +
        "Nothing has been changed — not even the creates, so you are not left\n" +
        "with half a plan.\n\n" +
        "Losing an index costs no documents, but it turns the queries behind\n" +
        "checkout and order lookup into collection scans, and a dropped TTL index\n" +
        "stops the rate limiter and the admin login lockout expiring rows at all.\n\n" +
        "If the list above is what you meant to remove:\n\n" +
        "  npm run db:sync-indexes -- --yes\n",
    );
    process.exitCode = 1;
  } else {
    if (drops.length > 0) {
      console.log("Applying dropped indexes as approved with --yes.\n");
    }

    for (const { model } of plan) {
      const dropped = await model.syncIndexes();
      const indexes = await model.collection.indexes();

      const names = indexes
        .map((index) => index.name)
        .filter((name): name is string => Boolean(name) && name !== "_id_");

      console.log(`  ${model.modelName}`);
      console.log(`    indexes: ${names.length ? names.join(", ") : "(none beyond _id)"}`);
      if (dropped.length > 0) {
        console.log(`    dropped: ${dropped.join(", ")}`);
      }
    }

    console.log("\nIndexes are in sync with the schemas.");
  }
} catch (error) {
  console.error(
    `\nIndex sync FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

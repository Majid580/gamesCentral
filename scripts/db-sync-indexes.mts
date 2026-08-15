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
 * documents), so it prints what it dropped.
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
import { OrderModel } from "../lib/models/order.ts";
import { ProductModel } from "../lib/models/product.ts";

const uri = process.env.DATABASE_URL;

if (!uri) {
  console.error("DATABASE_URL is not set. Run this via `npm run db:sync-indexes`.");
  process.exit(1);
}

const models = [GameModel, ProductModel, OrderModel, AppConfigModel, AdminUserModel];

try {
  const dialable = await resolveMongoUri(uri);

  await mongoose.connect(dialable, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
  });

  console.log(`Syncing indexes on ${mongoose.connection.db?.databaseName}\n`);

  for (const model of models) {
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
} catch (error) {
  console.error(
    `\nIndex sync FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

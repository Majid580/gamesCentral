/**
 * Seeds the Mobile Legends game and its catalogue from lib/catalogue-source.ts.
 *
 * Run with:  npm run db:seed
 *
 * Idempotent. Products are upserted on `sku`, so re-running after the owner
 * edits a price or a name updates that product in place rather than creating a
 * second one. Anything in the database that is no longer in the source is
 * DEACTIVATED, never deleted — orders reference products, and order history
 * has to stay readable.
 */

import mongoose from "mongoose";

import { resolveMongoUri } from "../lib/utils/dns-resolver.ts";
import { GameModel } from "../lib/models/game.ts";
import { ProductModel } from "../lib/models/product.ts";
import { MOBILE_LEGENDS_CATALOGUE, KIND_ORDER } from "../lib/catalogue-source.ts";
import { pkrToPaisa } from "../lib/utils/money.ts";

const uri = process.env.DATABASE_URL;
if (!uri) {
  console.error("DATABASE_URL is not set. Run this via `npm run db:seed`.");
  process.exit(1);
}

try {
  const dialable = await resolveMongoUri(uri);
  await mongoose.connect(dialable, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
  });

  /* ---- the game ---- */

  const game = await GameModel.findOneAndUpdate(
    { slug: "mobile-legends" },
    {
      $set: {
        name: "Mobile Legends: Bang Bang",
        smileOneProduct: "mobilelegends",
        requiresZoneId: true,
        isActive: true,
        sortOrder: 0,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  console.log(`Game: ${game.name} (${game.slug})`);

  /* ---- products ---- */

  // sortOrder is derived, not authored: section order comes from KIND_ORDER and
  // position within a section from the source array. Hand-numbering 26 items
  // is a renumbering chore the first time one is inserted in the middle.
  let created = 0;
  let updated = 0;

  for (const [index, item] of MOBILE_LEGENDS_CATALOGUE.entries()) {
    const kindRank = KIND_ORDER.indexOf(item.kind);
    const result = await ProductModel.findOneAndUpdate(
      { sku: item.sku },
      {
        $set: {
          game: game._id,
          kind: item.kind,
          displayName: item.displayName,
          tagline: item.tagline ?? null,
          diamondAmount: item.diamondAmount ?? null,
          bonusDiamonds: item.bonusDiamonds ?? null,
          // The single conversion from whole rupees to integer paisa.
          pricePkr: pkrToPaisa(item.pricePkrWholeRupees),
          isActive: true,
          featured: item.featured ?? false,
          sortOrder: kindRank * 1000 + index,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, includeResultMetadata: true },
    );

    if (result.lastErrorObject?.updatedExisting) updated += 1;
    else created += 1;
  }

  /* ---- retire anything no longer offered ---- */

  const liveSkus = MOBILE_LEGENDS_CATALOGUE.map((i) => i.sku);
  const retired = await ProductModel.updateMany(
    { game: game._id, sku: { $nin: liveSkus }, isActive: true },
    { $set: { isActive: false } },
  );

  console.log(`Products: ${created} created, ${updated} updated, ${retired.modifiedCount} retired`);

  /* ---- report what the storefront will show ---- */

  console.log("");
  for (const kind of KIND_ORDER) {
    const rows = await ProductModel.find({ game: game._id, kind, isActive: true })
      .sort({ sortOrder: 1 })
      .lean();
    console.log(`  ${kind} (${rows.length})`);
    for (const r of rows) {
      const dia = r.bonusDiamonds
        ? `${r.diamondAmount}+${r.bonusDiamonds} dia`
        : r.diamondAmount
          ? `${r.diamondAmount} dia`
          : "—";
      console.log(
        `    ${r.sku.padEnd(24)} ${String(dia).padStart(14)}  ${(r.pricePkr / 100).toLocaleString("en-PK")} PKR`,
      );
    }
  }

  console.log("\nCatalogue seeded.");
} catch (error) {
  console.error(`\nSeed FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

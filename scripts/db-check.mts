/**
 * Connectivity probe for the MongoDB Atlas cluster.
 *
 * Run with:  npm run db:check
 *
 * Deliberately standalone — it does NOT import lib/models/db.ts, because that
 * module is `server-only` and cannot be loaded outside the Next.js runtime.
 * It mirrors the same connect options so a green result here means the app's
 * pool will behave the same way.
 *
 * It is also the check that has to stay honest when the Atlas credentials are
 * rotated from root to a least-privilege user (see known_issues). The app
 * needs `readWrite` on `gamescentral` and nothing more; this script must not
 * report a database as broken merely because it asked for something the app
 * never asks for.
 */

import mongoose from "mongoose";

import { resolveMongoUri } from "../lib/utils/dns-resolver.ts";

const uri = process.env.DATABASE_URL;

if (!uri) {
  console.error("DATABASE_URL is not set. Run this via `npm run db:check`.");
  process.exit(1);
}

/** Strips credentials so a connection string is never printed or logged. */
function redact(connectionString: string): string {
  return connectionString.replace(/\/\/[^@]*@/, "//<credentials>@");
}

/**
 * The username from a connection string, never the password.
 *
 * Printed because after a credential rotation the first question is not "did
 * it connect" but "did it connect as the new user" — and a stale DATABASE_URL
 * somewhere else on the machine answers the first question perfectly well.
 */
function usernameOf(connectionString: string): string {
  const match = /\/\/([^:/@]+)(?::[^@]*)?@/.exec(connectionString);
  return match ? decodeURIComponent(match[1]) : "(none in URI)";
}

const started = Date.now();

try {
  console.log(`Connecting to ${redact(uri)} ...`);

  const dialable = await resolveMongoUri(uri);

  await mongoose.connect(dialable, {
    bufferCommands: false,
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
  });

  const db = mongoose.connection.db;
  if (!db) throw new Error("Connected but no database handle was returned.");

  const ping = await db.admin().command({ ping: 1 });
  const collections = await db.listCollections().toArray();

  /*
   * `buildInfo` runs against the `admin` database, and it is the one call here
   * that the application itself never makes: lib/models/db.ts sets
   * `autoIndex: false` and issues no admin command anywhere, so a user scoped
   * `readWrite` on `gamescentral` alone can be refused this while the app runs
   * perfectly.
   *
   * It therefore must not fail the check. The server version is a convenience;
   * declaring the database unreachable because a least-privilege user could
   * not read it would be false, and the natural response to that falsehood is
   * to put the root credentials back.
   */
  const serverVersion = await db
    .admin()
    .command({ buildInfo: 1 })
    .then((info) => String(info.version))
    .catch(() => "(not permitted for this user — the app never asks for it)");

  console.log(`\n  connected in ${Date.now() - started}ms`);
  console.log(`  ping ok:        ${ping.ok === 1}`);
  console.log(`  connected as:   ${usernameOf(uri)}`);
  console.log(`  server version: ${serverVersion}`);
  console.log(`  database:       ${db.databaseName}`);
  console.log(
    `  collections:    ${
      collections.length === 0
        ? "(none yet — empty database)"
        : collections.map((c) => c.name).join(", ")
    }`,
  );

  // Prove the user actually has write access, not just connect access. An
  // Atlas user scoped read-only would pass ping and fail here — better to
  // learn that now than during the first real checkout.
  const probe = db.collection("__connectivity_probe");
  const { insertedId } = await probe.insertOne({ at: new Date() });
  await probe.deleteOne({ _id: insertedId });
  await probe.drop().catch(() => {});
  console.log("  write access:   ok (insert + delete round-tripped)");

  console.log("\nDatabase is reachable and writable.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nConnection FAILED after ${Date.now() - started}ms`);
  console.error(`  ${redact(message)}`);

  if (/ENOTFOUND|querySrv/i.test(message)) {
    console.error(
      "\n  Hint: the cluster hostname did not resolve. Check the host in DATABASE_URL.",
    );
  } else if (/Authentication failed|bad auth/i.test(message)) {
    console.error(
      "\n  Hint: username/password rejected. Check the Atlas database user " +
        "(Database Access), not the Atlas account login. Special characters " +
        "in the password must be percent-encoded.",
    );
  } else if (/not authorized|unauthorized|requires authentication/i.test(message)) {
    console.error(
      "\n  Hint: the credentials were accepted but the user lacks a privilege. " +
        "The app needs `readWrite` on `gamescentral` and nothing else, and " +
        "`npm run db:sync-indexes` needs the same. If the refused action was " +
        "on the `admin` database it was this script asking, not the app.",
    );
  } else if (/server selection|timed out/i.test(message)) {
    console.error(
      "\n  Hint: reached DNS but no server accepted the connection. This is " +
        "almost always the Atlas IP allowlist — add your current IP under " +
        "Network Access in the Atlas console.",
    );
  }

  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

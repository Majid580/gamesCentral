/**
 * Creates or updates an admin user.
 *
 *   npm run admin:create -- admin@example.com
 *
 * The password is generated here and printed once. It is never taken as an
 * argument: shell arguments land in shell history and in the process list,
 * which is the wrong place for a credential that can read customer data.
 *
 * There is deliberately no HTTP route that does this. The only way an
 * AdminUser exists is someone running this on the server.
 */

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { resolveMongoUri } from "../lib/utils/dns-resolver.ts";
import { AdminUserModel } from "../lib/models/admin-user.ts";

const email = process.argv[2]?.trim().toLowerCase();
const role = process.argv[3] === "operator" ? "operator" : "admin";

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: npm run admin:create -- <email> [admin|operator]");
  process.exit(1);
}

const uri = process.env.DATABASE_URL;
if (!uri) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

/** 24 bytes of CSPRNG in base64url — ~144 bits, well past any brute force. */
function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

try {
  await mongoose.connect(await resolveMongoUri(uri), {
    bufferCommands: false,
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
  });

  const password = generatePassword();
  const hashedPassword = await bcrypt.hash(password, 12);

  const existing = await AdminUserModel.findOne({ email }).select("_id").lean();

  await AdminUserModel.findOneAndUpdate(
    { email },
    { $set: { hashedPassword, role, isActive: true } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  console.log(`\n  ${existing ? "Password reset for" : "Created"} ${email} (${role})`);
  console.log("\n  Password (shown once — store it in a password manager now):\n");
  console.log(`      ${password}\n`);
  console.log("  Sign in at /admin/login\n");
} catch (error) {
  console.error(
    `\nFailed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

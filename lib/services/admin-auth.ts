import "server-only";

import bcrypt from "bcryptjs";

import { connectToDatabase, assertScalar } from "@/lib/models/db";
import { AdminUserModel } from "@/lib/models/admin-user";
import { LoginAttemptModel } from "@/lib/models/login-attempt";

/**
 * Admin credential verification and login rate limiting.
 *
 * bcrypt rather than argon2id: argon2 is the stronger choice, but every Node
 * binding for it ships native code, and the production target is Hostinger
 * with the plan type still undecided. A hash that cannot be computed on the
 * production host is worse than a slightly weaker one that can. Revisit if the
 * plan turns out to be a VPS.
 */

/** Cost 12: ~250ms per hash on commodity hardware. */
export const BCRYPT_ROUNDS = 12;

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Counts recent failures for a key and reports whether it is locked out.
 * Email and IP are checked as separate keys — see the model comment.
 */
export async function isRateLimited(keys: string[]): Promise<boolean> {
  await connectToDatabase();
  const since = new Date(Date.now() - WINDOW_MS);

  const count = await LoginAttemptModel.countDocuments({
    key: { $in: keys.map((k) => String(assertScalar(k, "rateLimitKey"))) },
    at: { $gte: since },
  });

  return count >= MAX_ATTEMPTS;
}

export async function recordFailedAttempt(keys: string[]): Promise<void> {
  await connectToDatabase();
  await LoginAttemptModel.insertMany(
    keys.map((key) => ({ key: String(assertScalar(key, "rateLimitKey")), at: new Date() })),
  );
}

export async function clearAttempts(keys: string[]): Promise<void> {
  await connectToDatabase();
  await LoginAttemptModel.deleteMany({ key: { $in: keys } });
}

export type VerifiedAdmin = { id: string; email: string; role: string };

/**
 * Verifies an email/password pair.
 *
 * Returns null for every failure — wrong email, wrong password, disabled
 * account — and never says which. A login form that distinguishes "no such
 * user" from "wrong password" is an account enumeration oracle.
 *
 * A bcrypt comparison runs even when the user does not exist, so the response
 * time does not reveal whether the address is registered.
 */
export async function verifyAdminCredentials(
  email: string,
  password: string,
): Promise<VerifiedAdmin | null> {
  await connectToDatabase();

  const normalised = String(assertScalar(email, "email")).trim().toLowerCase();

  const admin = await AdminUserModel.findOne({ email: normalised })
    .select("+hashedPassword email role isActive")
    .lean();

  /* A real-shaped hash to compare against when there is no user, so the timing
     of a miss matches the timing of a hit. */
  const DUMMY_HASH = "$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012";

  const ok = await bcrypt.compare(password, admin?.hashedPassword ?? DUMMY_HASH);

  if (!admin || !ok || !admin.isActive) return null;

  return { id: String(admin._id), email: admin.email, role: admin.role };
}

/** Records the successful login. Failure here must not block the login. */
export async function touchLastLogin(adminId: string): Promise<void> {
  try {
    await connectToDatabase();
    await AdminUserModel.updateOne({ _id: adminId }, { $set: { lastLoginAt: new Date() } });
  } catch (error) {
    console.error("[admin] could not record lastLoginAt", error);
  }
}

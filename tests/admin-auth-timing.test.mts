/**
 * The admin login's account-enumeration defence.
 *
 * `verifyAdminCredentials` returns null for every failure and never says which
 * — but a uniform *answer* is not a uniform *response* if the two paths take
 * visibly different amounts of time. When the address has no admin there is no
 * hash to check, so the function compares against a fixed stand-in instead, and
 * the whole defence rests on that stand-in costing bcrypt the same work a real
 * hash would.
 *
 * It did not. The constant that stood here until 2026-09-06 was 55 characters
 * after the `$2b$12$` prefix where a real digest has 53, so bcryptjs could not
 * parse it and returned false immediately: 0.2ms for an address with no admin
 * against 278ms for one with — a factor of about 1,400, trivially measurable
 * over a network. The comment above it described the protection accurately and
 * the value silently withheld it.
 *
 * Note that `bcrypt.getRounds()` reports 12 for BOTH the broken and the correct
 * value — it reads the cost prefix without validating the digest — so a
 * structural check of the cost alone would have passed all the way through.
 * These two tests are the ones that actually catch it.
 *
 * ⛔ Nothing here touches the database or the network. The constant is read out
 *    of the source file, so the test is about the value the application ships.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import bcrypt from "bcryptjs";

const SOURCE = readFileSync(new URL("../lib/services/admin-auth.ts", import.meta.url), "utf8");

/** The stand-in hash exactly as it appears in the shipped source. */
function dummyHash(): string {
  const match = /const DUMMY_HASH = "([^"]+)"/.exec(SOURCE);
  assert.ok(
    match,
    "DUMMY_HASH is no longer a string literal in admin-auth.ts. If the " +
      "no-such-user comparison was restructured, re-point this test at " +
      "whatever now stands in for it — do not delete it.",
  );
  return match[1];
}

/** Fastest of `runs` timings, in ms. The minimum is the most stable floor for
 *  "did real work happen", since scheduling noise only ever adds time. */
async function fastestCompare(hash: string, runs = 3): Promise<number> {
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const started = process.hrtime.bigint();
    await bcrypt.compare("a password that is not the right one", hash);
    best = Math.min(best, Number(process.hrtime.bigint() - started) / 1e6);
  }
  return best;
}

test("the no-such-admin stand-in is a well-formed bcrypt hash", () => {
  /*
   * The check that would have caught the original defect, and the cheapest one
   * to keep: a bcrypt hash is exactly 60 characters — a 7-character `$2b$12$`
   * prefix, then 22 of salt and 31 of digest. The broken value was 62.
   */
  const hash = dummyHash();

  assert.equal(hash.length, 60, `a bcrypt hash is 60 characters; this one is ${hash.length}`);
  assert.match(hash, /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, "not a bcrypt hash");
  assert.equal(
    bcrypt.getRounds(hash),
    12,
    "the stand-in must carry the same cost as the hashes it stands in for " +
      "(BCRYPT_ROUNDS), or a miss is cheaper than a hit even when it parses",
  );
});

test("an address with no admin costs the same bcrypt work as one with", async () => {
  /*
   * The property itself, measured rather than assumed. A real cost-12 hash is
   * generated here so the comparison is against this machine's actual speed
   * rather than a number baked in from some other machine.
   *
   * The bar is deliberately loose — half the real time, and an absolute floor —
   * because this needs to survive a loaded CI box without flaking. It is set to
   * catch the failure that actually happens, which is not "slightly faster" but
   * "returned instantly without hashing anything": the defect this replaces was
   * three orders of magnitude out, and anything of that shape trips this by a
   * wide margin.
   */
  const real = await bcrypt.hash("the password of an admin who exists", 12);

  const realMs = await fastestCompare(real);
  const dummyMs = await fastestCompare(dummyHash());

  assert.ok(
    dummyMs > 20,
    `comparing against the stand-in took ${dummyMs.toFixed(1)}ms, which is too ` +
      "fast to have hashed anything — bcryptjs almost certainly rejected it as " +
      "malformed and returned false immediately. That is an admin enumeration " +
      "oracle: a wrong password against a real address takes ~250ms, a wrong " +
      "address returns at once.",
  );

  assert.ok(
    dummyMs > realMs * 0.5,
    `a miss took ${dummyMs.toFixed(1)}ms against a hit's ${realMs.toFixed(1)}ms. ` +
      "The two paths must be indistinguishable from outside.",
  );
});

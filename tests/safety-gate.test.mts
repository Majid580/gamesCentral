/**
 * The live-account delivery gate — see LIVE_ACCOUNT_SAFETY.md.
 *
 * This is the single most important test file here. The account behind
 * `.env.local` holds real purchased diamonds and a delivery cannot be
 * reversed, so `assertEndpointPermitted` is the last thing standing between a
 * refactor and the owner's money. Everything else in this suite protects a
 * number in a database; this protects a balance that no rollback can restore.
 *
 * Nothing in this file opens a socket. `safety.ts` is pure — it reads one
 * environment variable and throws or returns — so the gate can be exercised
 * exhaustively without a single request reaching SmileOne.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertEndpointPermitted,
  READ_ONLY_ENDPOINTS,
  SmileOneSafetyError,
} from "../lib/services/smileone/safety.ts";

const CREATE_ORDER = "/smilecoin/api/createorder";

/**
 * The gate reads `process.env` at call time, so a test that sets the escape
 * hatch must put the environment back however it exits — otherwise it opens
 * the gate for every test that runs after it in the same process.
 */
function withEnv(value: string | undefined, body: () => void): void {
  const previous = process.env.SMILEONE_ALLOW_FULFILMENT;
  if (value === undefined) delete process.env.SMILEONE_ALLOW_FULFILMENT;
  else process.env.SMILEONE_ALLOW_FULFILMENT = value;

  try {
    body();
  } finally {
    if (previous === undefined) delete process.env.SMILEONE_ALLOW_FULFILMENT;
    else process.env.SMILEONE_ALLOW_FULFILMENT = previous;
  }
}

test("createorder is blocked", () => {
  withEnv(undefined, () => {
    assert.throws(() => assertEndpointPermitted(CREATE_ORDER), SmileOneSafetyError);
  });
});

test("the two read-only endpoints are permitted", () => {
  withEnv(undefined, () => {
    for (const endpoint of READ_ONLY_ENDPOINTS) {
      assert.doesNotThrow(() => assertEndpointPermitted(endpoint));
    }
  });
});

test("only productlist and getrole are on the allowlist", () => {
  /*
   * Pinned as an exact set, not a length check. The failure this catches is a
   * future session appending a third endpoint to READ_ONLY_ENDPOINTS because
   * it "only reads" — the review conversation that entry deserves happens here,
   * as a failing test, rather than in a diff nobody looked at twice.
   */
  assert.deepEqual(
    [...READ_ONLY_ENDPOINTS],
    ["/smilecoin/api/productlist", "/smilecoin/api/getrole"],
  );
});

test("every unknown endpoint is refused, not just createorder", () => {
  /*
   * The allowlist is what makes this safe. A blocklist of known-dangerous
   * endpoints would wave through anything SmileOne adds after this was
   * written, and we do not control their API surface.
   */
  const notOnTheList = [
    CREATE_ORDER,
    "/smilecoin/api/createOrder",
    "/smilecoin/api/queryorder",
    "/smilecoin/api/refund",
    "/smilecoin/api/balance",
    "/smilecoin/api/productlist/../createorder",
    "",
    "/",
  ];

  withEnv(undefined, () => {
    for (const endpoint of notOnTheList) {
      assert.throws(
        () => assertEndpointPermitted(endpoint),
        SmileOneSafetyError,
        `${endpoint || "(empty string)"} should be refused`,
      );
    }
  });
});

test("the allowlist is matched exactly, not by prefix or substring", () => {
  /*
   * A `startsWith` or `includes` implementation would pass every test above
   * and still let `/smilecoin/api/getrole/../createorder` through. These are
   * the strings that separate an exact match from a sloppy one.
   */
  const lookalikes = [
    "/smilecoin/api/getrole/createorder",
    "/smilecoin/api/getrolex",
    "smilecoin/api/getrole",
    "/smilecoin/api/getrole ",
    "/SMILECOIN/API/GETROLE",
    "https://www.smile.one/smilecoin/api/getrole",
  ];

  withEnv(undefined, () => {
    for (const endpoint of lookalikes) {
      assert.throws(
        () => assertEndpointPermitted(endpoint),
        SmileOneSafetyError,
        `${endpoint} is not the allowlisted string and must be refused`,
      );
    }
  });
});

test("the escape hatch opens on exactly '1' and nothing else", () => {
  /*
   * Exercised in-process against a pure function — no request is made and no
   * client module is imported here. What is being pinned is the strictness of
   * the comparison: a truthiness check would open the gate on "0", "false" and
   * "no", which are the three things an operator most plausibly types when
   * they mean to keep it shut.
   */
  const mustStayShut = ["", "0", "true", "TRUE", "yes", "on", " 1", "1 ", "11", "01"];

  for (const value of mustStayShut) {
    withEnv(value, () => {
      assert.throws(
        () => assertEndpointPermitted(CREATE_ORDER),
        SmileOneSafetyError,
        `SMILEONE_ALLOW_FULFILMENT=${JSON.stringify(value)} must not open the gate`,
      );
    });
  }

  withEnv("1", () => {
    assert.doesNotThrow(() => assertEndpointPermitted(CREATE_ORDER));
  });
});

test("the gate is shut again once the escape hatch is removed", () => {
  /*
   * The value is read on every call rather than captured at module load, so
   * removing it takes effect immediately. Worth pinning: caching it would mean
   * a process that ever saw the flag keeps delivering after it is unset.
   */
  withEnv("1", () => {
    assert.doesNotThrow(() => assertEndpointPermitted(CREATE_ORDER));
  });

  withEnv(undefined, () => {
    assert.throws(() => assertEndpointPermitted(CREATE_ORDER), SmileOneSafetyError);
  });
});

test("the refusal names the endpoint and points at the document", () => {
  withEnv(undefined, () => {
    /*
     * Caught by hand rather than through `assert.throws`, which reports
     * whether something threw but does not hand back what was thrown.
     */
    let caught: unknown;
    try {
      assertEndpointPermitted(CREATE_ORDER);
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof SmileOneSafetyError, "expected a SmileOneSafetyError");
    assert.equal(caught.endpoint, CREATE_ORDER);
    assert.match(caught.message, /LIVE_ACCOUNT_SAFETY\.md/);
  });
});

test("the checked-in environment does not carry the escape hatch", () => {
  /*
   * The gate is lifted by the owner, in person, after PayFast is verified.
   * A `SMILEONE_ALLOW_FULFILMENT=1` that arrives in a committed env file, a CI
   * variable, or a copied shell profile would lift it silently and nobody
   * would notice until diamonds moved. `npm test` notices.
   *
   * Guarded by an opt-out so the owner can still run the suite on the day the
   * gate is legitimately open, without being told their own decision is a
   * failure.
   */
  if (process.env.SMILEONE_FULFILMENT_EXPECTED === "1") return;

  assert.notEqual(
    process.env.SMILEONE_ALLOW_FULFILMENT,
    "1",
    "SMILEONE_ALLOW_FULFILMENT=1 is set in this environment. If that was not " +
      "a deliberate decision by the owner, unset it now — see LIVE_ACCOUNT_SAFETY.md.",
  );
});

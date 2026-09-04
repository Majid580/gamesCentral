/**
 * How `getrole` answers, and what each answer must mean to a customer.
 *
 * Three of the four responses below were wrong in production at some point,
 * and each was wrong in the same expensive way: a permanent refusal dressed up
 * as a temporary outage, so the customer retried something that could never
 * work. Status 201 (the supplier's country block) surfaced as "we can't reach
 * the game servers"; status 20004 (a second not-found code) did the same; and
 * narrowing 20004 to the Player ID told customers with a perfectly good Player
 * ID to go and check their Player ID.
 *
 * The payloads are the ones recorded live on 2026-08-16 and 2026-08-28.
 *
 * ⛔ NOTHING HERE REACHES SMILEONE. `fetch` is replaced for the duration of
 *    each test with a stub that refuses any endpoint other than `getrole` and
 *    refuses to run at all if it is not the stub in place. Credentials are
 *    fake: `npm test` does not load `.env.local`, so the owner's real
 *    account details are not even present in this process.
 *    See LIVE_ACCOUNT_SAFETY.md.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  SmileOneError,
  SmileOneRegionBlockedError,
  getRole,
} from "@/lib/services/smileone/client";

/* ------------------------------------------------------------------ */
/* Test double                                                         */
/* ------------------------------------------------------------------ */

const FAKE_ENV = {
  SMILEONE_API_BASE_URL: "https://smileone.invalid",
  SMILEONE_UID: "test-uid",
  SMILEONE_EMAIL: "test@example.invalid",
  SMILEONE_KEY: "test-key",
};

const LOOKUP = {
  product: "mobilelegends",
  productId: "13",
  userId: "1638539586",
  zoneId: "16932",
};

/**
 * Runs `body` with `fetch` replaced by one that answers with `payload`, and
 * with fake SmileOne credentials in the environment.
 *
 * The stub asserts the endpoint before answering. If a future refactor ever
 * routed this through a different URL, the test fails loudly here rather than
 * quietly dispatching somewhere real.
 */
async function withStubbedResponse(
  payload: unknown,
  body: (calls: { url: string; body: string }[]) => Promise<void>,
  init: { httpStatus?: number; raw?: string } = {},
): Promise<void> {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  const calls: { url: string; body: string }[] = [];

  Object.assign(process.env, FAKE_ENV);

  globalThis.fetch = (async (input: RequestInfo | URL, request?: RequestInit) => {
    const url = String(input);

    assert.ok(
      url.startsWith("https://smileone.invalid/smilecoin/api/getrole"),
      `the stub was asked for ${url}, which is not the read-only getrole endpoint`,
    );

    calls.push({ url, body: String(request?.body ?? "") });

    return new Response(init.raw ?? JSON.stringify(payload), {
      status: init.httpStatus ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  try {
    await body(calls);
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(FAKE_ENV)) delete process.env[key];
    Object.assign(process.env, realEnv);
  }
}

/* ------------------------------------------------------------------ */
/* The four live answers                                               */
/* ------------------------------------------------------------------ */

test("a real account returns the username the customer must confirm", async () => {
  /*
   * The owner's own account, verbatim from the 2026-08-28 probe. This is the
   * safety net against a mistyped Player ID sending diamonds to a stranger, so
   * what matters is that the username survives the parse intact.
   */
  const live = {
    status: 200,
    message: "success",
    data: {
      username: "proplayer123",
      zone: 1,
      change_price: 1,
      use: "c",
      id_change_price_info: [
        { product_id: "13", change_price: 1 },
        { product_id: "25", change_price: 1.0043 },
      ],
    },
  };

  await withStubbedResponse(live, async () => {
    const role = await getRole(LOOKUP);

    assert.equal(role.username, "proplayer123");
    assert.equal(role.changePrice, "1");
    assert.deepEqual(role.priceMultipliers, [
      { productId: "13", multiplier: 1 },
      { productId: "25", multiplier: 1.0043 },
    ]);
  });
});

test("getrole's zone is not the customer's zone id", async () => {
  /*
   * A lookup on zone 16932 came back `zone: 1`. Whatever that field means, it
   * is not what the customer typed, and displaying it as their Zone ID would
   * have them "correcting" a number that was right.
   */
  const live = {
    status: 200,
    message: "success",
    data: { username: "proplayer123", zone: 1, change_price: 1 },
  };

  await withStubbedResponse(live, async () => {
    const role = await getRole(LOOKUP);
    assert.equal(role.zone, "1");
    assert.notEqual(role.zone, LOOKUP.zoneId);
  });
});

test("status 201 is the supplier refusing a country, not an outage", async () => {
  /*
   * Confirmed live against a real Philippine account (302375851/3596). The
   * distinct error type is the whole point: a plain SmileOneError is mapped by
   * callers to "we can't reach the game servers, try again shortly", which is
   * untrue here and would have the customer retrying a permanent no forever.
   */
  const live = {
    status: 201,
    message:
      "According to the request of the mlbb team, we do not support recharge for " +
      "users in Indonesia, Malaysia, the Philippines, Singapore, and Russia for the " +
      "time being.",
  };

  await withStubbedResponse(live, async () => {
    let caught: unknown;
    try {
      await getRole({ ...LOOKUP, userId: "302375851", zoneId: "3596" });
    } catch (error) {
      caught = error;
    }

    assert.ok(
      caught instanceof SmileOneRegionBlockedError,
      "a country refusal must not arrive as a generic SmileOneError",
    );
    assert.ok(!(caught instanceof SmileOneError), "it must not be catchable as an outage");

    /*
     * The upstream wording is kept for the log and never becomes the customer's
     * message (rule 7). The list of countries in it is Moonton's to change —
     * "for the time being" says so outright — and parsing names out of it would
     * bake today's list into our code.
     */
    assert.match(caught.upstreamMessage, /do not support recharge/);
    assert.doesNotMatch(caught.message, /Indonesia|Philippines|Russia/);
  });
});

test("both not-found codes mean the same thing: the pair does not match", async () => {
  /*
   * 20003 says "USER ID ou Zone ID não existe" and 20004 says "USER ID não
   * existe". The second reads as though the Player ID specifically is at
   * fault, and it is not — the owner's own valid Player ID with a wrong Zone ID
   * returns 20004 as well. Narrowing on that wording was tried and reverted the
   * same day.
   *
   * Both must resolve to "no such account", which the caller turns into "check
   * your details" with neither field singled out — never to an upstream failure.
   */
  for (const [status, message] of [
    [20003, "USER ID ou Zone ID não existe"],
    [20004, "USER ID não existe"],
  ] as const) {
    await withStubbedResponse({ status, message }, async () => {
      const role = await getRole({ ...LOOKUP, userId: "999999999" });

      assert.equal(role.username, null, `status ${status} should report no account`);
      assert.equal(role.changePrice, null);
      assert.deepEqual(role.priceMultipliers, []);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Everything else fails closed                                        */
/* ------------------------------------------------------------------ */

test("an unrecognised upstream status throws rather than reporting no account", async () => {
  /*
   * The direction this has to fail in. Treating an unknown code as "no such
   * account" tells a customer their details are wrong on the strength of a
   * response nobody has ever seen; throwing tells them to try again and puts
   * the code in the log where somebody can look it up.
   */
  await withStubbedResponse({ status: 40001, message: "some new upstream condition" }, async () => {
    await assert.rejects(() => getRole(LOOKUP), SmileOneError);
  });
});

test("an HTTP error and a non-JSON body both throw", async () => {
  await withStubbedResponse({}, async () => {
    await assert.rejects(() => getRole(LOOKUP), SmileOneError);
  }, { httpStatus: 502 });

  // A gateway error page, which is what an upstream outage actually returns.
  await withStubbedResponse(null, async () => {
    await assert.rejects(() => getRole(LOOKUP), SmileOneError);
  }, { raw: "<html><body>502 Bad Gateway</body></html>" });
});

test("the request is signed and carries the customer's own ids", async () => {
  /*
   * Guards against the lookup being made for the wrong account — the failure
   * `getrole` exists to prevent, reintroduced one level up.
   */
  const live = { status: 200, message: "success", data: { username: "proplayer123" } };

  await withStubbedResponse(live, async (calls) => {
    await getRole(LOOKUP);

    assert.equal(calls.length, 1);
    const sent = new URLSearchParams(calls[0].body);

    assert.equal(sent.get("userid"), LOOKUP.userId);
    assert.equal(sent.get("zoneid"), LOOKUP.zoneId);
    assert.equal(sent.get("productid"), LOOKUP.productId);
    assert.equal(sent.get("product"), LOOKUP.product);
    assert.match(String(sent.get("sign")), /^[0-9a-f]{32}$/);
    assert.ok(Number(sent.get("time")) > 0);
  });
});

test("a missing username is null, never an empty string shown as a name", async () => {
  /*
   * The customer confirms a name before paying. A blank one rendered as though
   * it were a name invites them to confirm nothing at all.
   */
  const live = { status: 200, message: "success", data: { zone: 1, change_price: 1 } };

  await withStubbedResponse(live, async () => {
    const role = await getRole(LOOKUP);
    assert.equal(role.username, null);
  });
});

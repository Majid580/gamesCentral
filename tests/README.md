# Tests

```bash
npm test
```

No test framework, no new dependencies. Node's built-in runner (`node --test`)
and `node:assert`, with Node's native TypeScript stripping — the same way every
script in `scripts/` already runs.

## Why this exists

Every invariant in this codebase was verified once, by hand, in a session, and
written up in `project_progress.md`. That is a good record and a bad safety
net: prose does not fail a build. These tests turn the invariants that cost
real money into assertions that run in a second.

They are deliberately weighted towards the things that are **expensive and
silent** when they break — a doubled delivery, a payment marked as never having
happened, a mistyped Player ID accepted — rather than towards coverage.

## What is covered

| File | What it protects | Why it matters |
| --- | --- | --- |
| `safety-gate.test.mts` | The live-account delivery gate | `createorder` against the owner's real diamonds cannot be undone. See `LIVE_ACCOUNT_SAFETY.md`. |
| `money.test.mts` | Integer paisa, and the gateway amount round trip (rule 5) | The equality this pins *is* the amount check in `verify-payment.ts`. |
| `fulfilment-plan.test.mts` | Composed-order idempotency (rule 3) | A naive retry of a half-delivered order buys the delivered packs again, at the owner's expense. |
| `order-status.test.mts` | The status machine (rule 8) | Once an order is `paid`, `failed` must be unreachable — checked transitively, not edge by edge. |
| `order-lookup-guard.test.mts` | `assertScalar` (rule 6) and phone matching | The two decisions that stand between guest order lookup and an IDOR. |
| `getrole-responses.test.mts` | The four live `getrole` answers | Three of them were once mapped to "try again shortly" — a permanent refusal dressed as an outage. |
| `region-policy.test.mts` | The supplier cost gate | Its refusal branch has never fired in the field. The first time it does will be against a real customer. |
| `smileone-sign.test.mts` | Double-MD5 request signing | A regression fails every supplier call at once, with an upstream error that names none of the causes. |
| `catalogue.test.mts` | The spreadsheet transcription | A dropped digit seeds cleanly and sells 9,288 diamonds for 3,770 rupees. |

## What is NOT covered — read this before trusting a green run

The suite covers **pure logic only**. Nothing here touches MongoDB, and nothing
here reaches the network.

Not covered, and still verified by hand or not at all:

- **Everything DB-backed.** `createPendingOrder`, `findOrderForGuest`,
  `verifyAndSettleOrder`, the fulfilment executor, the sweeper, rate limiting,
  and admin auth all need a live Atlas connection. Their *logic* is partly
  reachable through the pure modules above; their *queries* are not.
- **The atomic conditional updates.** Rules 3 and 8 depend on
  `findOneAndUpdate` matching exactly once under concurrency. That is a
  property of MongoDB and the query, and it cannot be asserted without one.
- **PayFast.** No merchant credentials exist yet. The hosted-checkout field
  names are still a draft, gated behind `PAYFAST_FIELDS_CONFIRMED=1`.
- **Fulfilment against the supplier.** It has never run and must not — see
  `LIVE_ACCOUNT_SAFETY.md`. `npm run fulfilment:drill` exercises it with the
  gate shut.
- **Anything visual.** Contrast is checked by `npm run design:contrast`; layout
  and motion are not checked by anything.

## Conventions

- **One assertion per real failure mode**, and the comment says which failure.
  A test whose comment cannot name what breaks is not pulling its weight.
- **No mocking framework.** `getrole-responses.test.mts` replaces
  `globalThis.fetch` by hand and restores it in a `finally`; its stub refuses
  any endpoint other than `getrole`, so a refactor that changed the URL fails
  the test rather than dispatching somewhere real.
- **`npm test` never loads `.env.local`.** The owner's real SmileOne
  credentials are not present in the test process at all. Anything needing
  configuration sets fake values and restores the environment afterwards.
- **`register-alias.mjs` / `alias-hook.mjs`** resolve the `@/…` tsconfig path
  alias, which plain Node does not implement. Prefer relative imports in new
  tests; the hook is there for source modules that use the alias.
- **No TypeScript parameter properties in any module a test imports.** Node's
  strip-only mode cannot parse them. `safety.ts` and `smileone/client.ts` both
  use plain field declarations for this reason.

# Games Central — Architecture

Stable reference. Update when the architecture actually changes, not on every
commit. For current status see `project_state.yaml`; for the change log see
`project_progress.md`.

---

## 1. Tech stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js App Router, Turbopack | 16.3.1 |
| UI | React, Tailwind CSS | 19.2.8, v4 |
| Backend | Next.js Route Handlers (layered) | — |
| Database | MongoDB Atlas via Mongoose | 9.9.2 |
| Validation | zod | 4.4.3 |
| Admin auth | Auth.js / NextAuth | Phase 8 |
| Payments | PayFast Pakistan, hosted checkout | Phase 5 |
| Fulfilment | SmileOne API | Phase 2/6 |

### Hosting: split target

**Previews and testing run on Vercel. Production runs on Hostinger.** This is
an owner decision (2026-08-15) and it constrains the codebase:

- No Vercel-only primitives — no Vercel Cron, KV, Blob, or `@vercel/functions`.
- Security headers live in `next.config.ts`, not `vercel.json`, so they survive
  the cutover.
- Scheduled work (SmileOne product sync) is a route handler authenticated by a
  `CRON_SECRET` bearer token, callable by Vercel Cron *or* a Hostinger crontab
  `curl` — the same code works on both.
- Rate limiting is MongoDB-backed (TTL collection), not an edge KV store.
  `UPSTASH_REDIS_URL` remains an optional upgrade path, not a requirement.
- `output: 'standalone'` is opt-in via `BUILD_STANDALONE=1` for the Hostinger
  build. See `node_modules/next/dist/docs/**/self-hosting.md`.

Open question for Phase 11: which Hostinger product (VPS with Node + PM2 +
Nginx, vs. their managed Node.js hosting). This determines the deploy method
but not the application code.

## 2. Why a single Next.js app

The owner asked for a Node.js MVC backend. Next.js Route Handlers *are*
Node.js. A separate Express service would add a network hop on every checkout
call (working against the explicit latency requirement), a second deployment, a
second place to hold secrets, and CORS handling — for separation of concerns
that the layer structure below already provides. Confirmed with the owner.

```
app/api/<resource>/route.ts     thin: parse request, delegate, shape response
lib/controllers/<resource>.ts   orchestration: validate input, call services
lib/services/<resource>.ts      business logic: SmileOne, PayFast, pricing, state
lib/models/<resource>.ts        Mongoose schemas and data access
```

Business logic never lives in a route handler.

## 3. Folder structure

```
app/
  (site)/       customer-facing pages (route group, no URL segment)
  admin/        protected admin area
  api/          route handlers
lib/
  controllers/  request orchestration
  services/     smileone.ts, payfast.ts, pricing.ts, orders.ts
  models/       Mongoose schemas + db.ts (connection helper)
  utils/        helpers
  env.ts        server-only, zod-validated environment access
components/     shared UI
public/brand/   logos and brand assets
```

## 4. Data model

All money is stored as **integer paisa**. Never floats (Section 12.13).

Implemented in `lib/models/`. Each model is registered through
`defineModel()`, which reuses an already-registered model instead of throwing
`OverwriteModelError` when Next.js re-evaluates a module on hot reload.

**Game** (`game.ts`) — `slug`, `name`, `smileOneProduct`, `requiresZoneId`,
`isActive`, `sortOrder`

Games are first-class from day one even though only Mobile Legends ships at
launch; the UI filters rather than the schema assuming one title. This
collection also owns the per-game supplier knowledge that has nowhere else to
live: the exact string SmileOne's `product` parameter expects, and whether
checkout must collect a Zone ID.

**Product** (`product.ts`) — `smileOneProductId` (unique), `game` (ref),
`displayName`, `spu`, `diamondAmount`, `basePriceUsdCents`,
`supplierRawPrice`, `isActive`, `sortOrder`, `lastSyncedAt`

`displayName` is admin-curated — SmileOne's `spu` strings are inconsistent
(`"mobilelegends BR 78 &8 Diamond"`) and are never shown to customers.

The brief names the price field `basePriceUsd`; it is stored as
**integer cents** because a float base price would break rule 5 the moment it
is multiplied by the exchange rate and markup. `supplierRawPrice` keeps the
untouched supplier string so the brief's open question — whether SmileOne
prices really are USD — stays answerable from stored data.

**Order** (`order.ts`) — `orderId` (unique, generated), `product` (ref),
`game` (ref), `playerId`, `zoneId`, `confirmedUsername`, `pricePkr` (integer
paisa), `pricing{}`, `status`, `statusHistory[]` (`{from, to, note, at}`),
`paymentReference`, `smileOneOrderId`, `contactEmail`, `contactPhone`,
timestamps

`pricing{}` snapshots the inputs that produced the total —
`basePriceUsdCents`, `exchangeRate`, `markupPercentage`, and `getrole`'s
`supplierChangePrice` when it overrode the catalogue price. The rate and
markup are editable, so without the snapshot an order's total becomes
unreproducible the first time either changes and a later dispute cannot be
settled.

`orderId` is CSPRNG-random (`GC-XXXXX-XXXXX`, ambiguous characters removed),
not sequential: guest order lookup takes an order ID, and a predictable
counter would let anyone walk the order book.

**AdminUser** (`admin-user.ts`) — `email` (unique), `hashedPassword`
(`select: false`), `role`, `isActive`, `lastLoginAt`. Provisioned
out-of-band; there is no public route that writes to this collection.

**AppConfig** (`app-config.ts`) — `markupPercentage`, `exchangeRate`,
`ordersPaused`, `pausedMessage`, `updatedBy`. Singleton enforced by a unique
index on a fixed `key`, not by convention.

**Indexes.** Created explicitly by `npm run db:sync-indexes` — the connection
sets `autoIndex: false` so cold starts never pay for index checks and index
builds never land under production load. `syncIndexes()` also drops indexes no
longer declared in a schema, which is what stops the models and the real
collections drifting apart.

| Collection | Indexes beyond `_id` |
|---|---|
| Game | `slug` (unique), `{isActive, sortOrder}` |
| Product | `smileOneProductId` (unique), `{game, isActive, sortOrder, diamondAmount}`, `lastSyncedAt` |
| Order | `orderId` (unique), `{status, createdAt}`, `createdAt`, `paymentReference` (sparse), `{contactEmail, createdAt}` |
| AppConfig | `key` (unique) |
| AdminUser | `email` (unique) |

`{status, createdAt}` deliberately replaces a standalone `status` index — the
compound serves status-only queries through its prefix, so a second index
would be maintained on every write for nothing. `paymentReference` is sparse
because it is null until checkout starts and those nulls must not collide.

### Order status machine

```
pending -> awaiting_payment -> paid -> fulfilling -> fulfilled
                                          |
                                          +-> paid_pending_fulfillment  (admin recovers)
        -> failed
```

Declared in `lib/models/order.ts` as `ORDER_TRANSITIONS` and enforced in the
service layer via `canTransition()`. The permitted statuses and the permitted
moves between them live in one file so they cannot drift apart.

The load-bearing property is an absence: **once an order reaches `paid`,
`failed` is unreachable.** After money changes hands the only sink for a
problem is `paid_pending_fulfillment`. That is rule 8 — a payment must never
be silently lost — expressed as a graph rather than a code review comment.

Every money-touching transition uses an atomic conditional update so concurrent
requests cannot double-process:

```ts
findOneAndUpdate({ _id, status: 'paid' }, { $set: { status: 'fulfilling' } })
```

`paid_pending_fulfillment` is the safety net: if SmileOne fails after a
verified payment, the order lands here and surfaces in the admin dashboard
rather than being silently lost.

## 5. External integrations

### SmileOne

Sandbox `https://frontsmie.smile.one` · Production `https://www.smile.one`.
All calls `POST` `application/x-www-form-urlencoded`, signed with a double MD5
over alphabetically-sorted params plus the merchant key. Signs are valid ~5
minutes and are generated immediately before each call from the current server
timestamp — never cached. The signing function is server-side only; the
merchant key never reaches the browser.

| Endpoint | When |
|---|---|
| `/smilecoin/api/productlist` | Periodic sync into our DB — never per page view |
| `/smilecoin/api/getrole` | After ID entry, before payment — returns in-game username |
| `/smilecoin/api/createorder` | Only after payment is independently verified |

`getrole`'s `change_price`, when present, is the source of truth for the final
charge over the cached list price; a mismatch is logged, never silently
resolved. The `use` field is undocumented — log and inspect real sandbox
responses rather than assuming its meaning.

### PayFast Pakistan

Hosted/redirect checkout, keeping card data off our servers and the site out of
PCI-DSS scope. Auth is `POST /token` with `merchant_id` + `secured_key` +
`grant_type=client_credentials`, returning a bearer token.

**The non-negotiable:** on any payment notification — webhook or redirect — we
re-fetch the transaction from PayFast (`GET /transaction/<id>` or
`/transaction/basket_id/<id>`) and confirm the amount and status match our own
order before marking it paid or calling `createorder`. A redirect or raw
webhook payload is never trusted on its own.

Exact hosted-mode field names are unconfirmed pending the owner's merchant
dashboard docs.

## 6. Pricing

```
price_pkr = round(base_price_usd * exchange_rate * (1 + markup_percentage/100))
```

Computed server-side, always, from our own data. `exchange_rate` and
`markup_percentage` are configurable (env default, overridable via the `Config`
document) — never hardcoded, never in frontend code. The client displays
prices; it never sets them.

## 7. Security architecture

Full requirements in `INITIAL_BRIEF.md` Section 12. Structural pieces:

- `lib/env.ts` imports `server-only`, making it a build error to pull secrets
  into a Client Component. No secret carries a `NEXT_PUBLIC_` prefix.
- `assertScalar` in `lib/models/db.ts` rejects object-valued input where a
  scalar is contractually expected, blocking NoSQL operator injection
  (`{ $ne: null }`).
- Security headers set globally in `next.config.ts`.
- Admin routes protected by middleware on every route, not just page load.
- Two-layer validation: `claude-security` audits the source (Phase 9);
  `strix-pentest` attacks the running staging deployment (Phase 9.5).

## 8. Performance

Server Components by default; Client Components only for the interactive
checkout pieces. The SmileOne product list is cached in our DB and refreshed on
a schedule — never fetched on a page view. `getrole` is the slowest step in
checkout (external round trip) and gets a deliberate skeleton/optimistic
loading state. The Mongoose pool is cached on `globalThis` so we open one pool
per process rather than one per request.

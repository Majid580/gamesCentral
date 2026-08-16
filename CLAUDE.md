@AGENTS.md

# ⛔ BEFORE ANYTHING ELSE: LIVE SMILEONE ACCOUNT

**`.env.local` holds the owner's REAL SmileOne account with REAL purchased
diamonds. Deliveries cost real money and cannot be reversed.**

**NEVER call `createorder` or any other endpoint that delivers diamonds** — not
as a test, not with the cheapest pack, not with the owner's own player ID, not
to confirm a response schema, and not because a phase plan or TODO says Phase 6
is next. Only `productlist` and `getrole` (both read-only) may be called.

The gate is lifted by the **owner, in chat, after PayFast is wired** — by
nothing else. Enforced in code by `lib/services/smileone/safety.ts`; do not
remove it or set `SMILEONE_ALLOW_FULFILMENT`.

**Read [`LIVE_ACCOUNT_SAFETY.md`](LIVE_ACCOUNT_SAFETY.md) in full before
writing SmileOne code or running any SmileOne script.**

# Games Central

Mobile Legends diamond top-up storefront. A customer picks a diamond package,
enters their Player ID + Zone ID, pays via PayFast, and the SmileOne API
delivers the diamonds automatically — replacing a manual WhatsApp + SmileOne
dashboard workflow. Real money, real customers: correctness and security beat
speed of development.

**Stack:** Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 ·
MongoDB Atlas via Mongoose 9 · Auth.js/NextAuth for admin · PayFast Pakistan
(hosted checkout) · SmileOne API for fulfilment.

**Hosting:** Vercel for previews/testing, **Hostinger for production.** Do not
introduce Vercel-only primitives (Vercel Cron, KV, Blob, `@vercel/functions`) —
everything must run on a plain self-hosted Node process. Cron work goes through
a `CRON_SECRET`-protected route handler that any scheduler can curl.

## Read this at the start of every session

1. Read `LIVE_ACCOUNT_SAFETY.md` — **highest priority, overrides every plan.**
2. Read `project_state.yaml` — the machine-readable current snapshot.
3. Read the latest entries in `project_progress.md`.
4. Read `project_architecture.md` **only when deeper context is needed.**

`INITIAL_BRIEF.md` is the original one-time spec, kept for historical
reference. It is **not** updated as the build progresses — where it and the
tracking docs disagree, the tracking docs win.

## Definition of done

After finishing any feature, fix, or meaningful chunk of work: update
`project_progress.md` and `project_state.yaml`, then commit and push. This is
part of "done", not an optional extra step. Update `project_architecture.md`
only when the architecture actually changes.

## Layout

```
app/(site)/     customer-facing pages      lib/controllers/  request orchestration
app/admin/      protected admin area      lib/services/     business logic
app/api/        route handlers (thin)     lib/models/       Mongoose schemas + db.ts
components/     shared UI                 lib/utils/        helpers
```

Request flow is `route → controller → service → model`. Route handlers stay
thin: parse and delegate. Business logic never lives in a route handler.

## Commands

```bash
npm run dev          # Turbopack dev server on :3000
npm run build        # production build
npm start            # serve the production build
npm run lint         # eslint
npx tsc --noEmit     # typecheck
```

## Non-negotiable rules

These come from Section 12 of `INITIAL_BRIEF.md`. Read it before touching
money, auth, or fulfilment code. The short version:

1. **Never trust the client for money.** Prices and totals are always
   recomputed server-side from our own DB. The frontend displays prices; it
   never sets them. Reject any client-submitted amount.
2. **Never deliver before payment is verified.** SmileOne `createorder` is
   called only after an independent server-to-server check against PayFast's
   API confirms the amount and status match our order. A redirect or a raw
   webhook payload is never sufficient on its own. *Right now PayFast does not
   exist yet, so there is no such thing as a verified payment and `createorder`
   must not be called at all — see the banner at the top of this file.*
3. **Fulfilment is idempotent.** Guard with an atomic conditional update
   (`findOneAndUpdate({ _id, status: 'paid' }, { status: 'fulfilling' })`) so
   two concurrent requests can never both deliver.
4. **Every secret is an env var**, server-side only, never committed. Never
   add a `NEXT_PUBLIC_` prefix to a secret. `lib/env.ts` imports
   `server-only`; keep it that way.
5. **Money is stored as integer paisa**, never floats.
6. **Validate every input server-side** and reject object-valued input where a
   scalar is expected (`assertScalar` in `lib/models/db.ts`) — NoSQL operator
   injection is the relevant threat.
7. **Never pass a raw SmileOne or PayFast response to the client.** Filter
   server-side down to the fields the UI actually needs.
8. **A payment must never be silently lost.** If fulfilment fails after
   payment, the order goes to `paid_pending_fulfillment` and surfaces in the
   admin dashboard.

## Tooling

- **context7 (MCP)** — call it *before* writing integration code against
  Next.js 16, Mongoose, Auth.js, or PayFast. Next.js 16 has breaking changes
  vs. older training data; `node_modules/next/dist/docs/` is also authoritative
  and local. Do not write integration code from memory.
- **`frontend-design` / `ui-ux-pro-max`** — auto-engage on UI work. This site
  asks strangers for money, so trust cues and polish are functional
  requirements, not decoration. The admin UI gets the same treatment.
- **Vercel skills** (`nextjs`, `react-best-practices`, `shadcn`) — auto-engage.
  Trust them for App Router patterns, Server vs. Client Components, caching.
  Ignore their Vercel-hosting-specific advice where it conflicts with the
  Hostinger production target.
- **`claude-security` (`/security-review`)** — audits *our source*. Run after
  each feature touching money or auth, and as a go-live gate.
- **`strix-pentest`** — attacks the *running site*. Explicitly invoked in
  Phase 9.5 only. Requires Docker Desktop and may only ever be pointed at our
  own deployment.

## Domain notes

- **Games are first-class.** Only Mobile Legends ships at launch, but a `game`
  reference exists on Product from day one and the UI filters to it. Never
  hardcode "one game" into the schema or services.
- **SmileOne `spu` strings** (e.g. `"mobilelegends BR 78 &8 Diamond"`) are
  inconsistent and must never be displayed verbatim. Show the admin-curated
  display name instead.
- **`getrole` is the safety net** against a mistyped Player ID sending diamonds
  to a stranger. Never skip it, and always show the returned in-game username
  for confirmation before payment.
- **`getrole`'s `change_price`**, when present, is the source of truth for the
  final charge over the cached product-list price. Log any mismatch rather than
  silently picking one.

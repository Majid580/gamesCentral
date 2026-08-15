# Games Central — Project Brief & Build Specification

> **Historical reference only.** This is the one-time starting snapshot of
> requirements, preserved as written on 2026-08-15. It is **not** updated as
> the build progresses. Where this document and the tracking docs
> (`project_state.yaml`, `project_progress.md`, `project_architecture.md`)
> disagree, **the tracking docs win.**
>
> **One redaction:** the SmileOne sandbox merchant key in Section 8 has been
> replaced with a placeholder. Per Principle 4, no key belongs in git — even a
> shared sandbox one. The real value lives in `.env.local` as `SMILEONE_KEY`.

---

## 0. What This Document Is

This is the complete starting brief for building **Games Central**, a Mobile
Legends diamond top-up storefront.

This brief is a **one-time snapshot** of requirements. Once the project starts,
the three tracking documents in Section 4 (plus the auto-loaded `CLAUDE.md`)
become the living source of truth — this file itself does not get updated as
the build progresses.

Anywhere this document says **(confirm)**, or in Section 20 (Open Decisions),
stop and ask the user before proceeding rather than guessing.

---

## 0.1 Installed Tooling & Skills — When to Use What

The developer's Claude Code environment has skills and plugins installed that
are directly relevant to this build. **The rule is simple: let the ones that
auto-engage do their job, and explicitly invoke the ones that don't.**

**These engage automatically — do NOT stop to invoke them:**

- **`frontend-design`** and **`ui-ux-pro-max`** — activate whenever you design,
  build, or review UI. Every customer-facing page, component, and layout should
  reflect their guidance: distinctive (not templated-AI-looking) visual design,
  deliberate typography, coherent color system, accessibility, and motion. This
  is a site asking strangers for money, so polish and trust cues matter.
- **Vercel skills** (`nextjs`, `react-best-practices`, `shadcn`, `turbopack`,
  `env-vars`, `routing-middleware`) — activate on Next.js/React/shadcn work.
  Trust them for App Router patterns, caching, Server vs. Client Components,
  and shadcn/ui usage.

**These do NOT auto-start — invoke them explicitly:**

- **`context7`** (documentation MCP) — **Call it before implementing against
  any fast-moving or version-specific API.** Next.js 16 is new, and
  SmileOne/PayFast details shift. Pull current, version-specific docs instead
  of relying on memory. This is the defense against writing
  plausible-but-outdated code.
- **`strix-pentest`** — **Invoke explicitly in the dedicated pen-test phase
  (Phase 9.5), never during normal coding.** Runs active scans inside a Kali
  Docker sandbox against a *running* target. Requires Docker Desktop, and must
  only be pointed at **this project's own** deployment.
- **Vercel deployment MCP** — invoke explicitly for deploy, build-status, logs,
  env-var, and domain tasks.
- **`claude-security`** (`/security-review`) — Anthropic's code-vulnerability
  scanner, for the Phase 9 hardening pass. Audits *your own source*. Distinct
  from `strix-pentest`, which attacks the *running site*. Run both.

---

## 1. Business Overview

Games Central automates an existing top-up reselling business. Today it runs
manually: a customer messages the owner on WhatsApp with their Mobile Legends
**Player ID** and **Zone ID**, the owner logs into his own SmileOne account,
manually places the order, and the customer receives diamonds. The owner earns
a margin on each transaction.

The website replaces this manual loop end to end:

1. Customer browses Mobile Legends diamond packages as product cards.
2. Customer enters their Player ID + Zone ID and picks a package.
3. Customer pays online (EasyPaisa, JazzCash, cards, etc. via PayFast).
4. The system automatically delivers diamonds through the SmileOne API.

Only Mobile Legends at launch, but **don't hard-code "one game" into the
architecture.** A `game` reference exists from day one; the UI simply filters
to Mobile Legends.

---

## 2. Non-Negotiable Principles

These override convenience or speed of development wherever they conflict:

1. **Never trust the client for money.** Prices, totals, and product validity
   are always recomputed server-side.
2. **Never deliver before payment is verified.** SmileOne's `createorder` is
   only ever called after a payment is confirmed server-to-server.
3. **Simple over clever.** Every added moving part needs a concrete
   justification tied to an actual requirement — not "best practice" in the
   abstract.
4. **Every secret lives in an environment variable — never in code, never in
   git.**
5. **Updating the tracking docs (Section 4) is part of finishing a feature.**

---

## 3. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | **Next.js 16** (App Router, Turbopack) |
| Backend | Node.js **inside the same Next.js app**, Route Handlers in a layered `route → controller → service → model` structure |
| Database | **MongoDB (Atlas cluster)** via Mongoose |
| Auth (admin) | **Auth.js / NextAuth** |
| Hosting | **Vercel** *(superseded — see tracking docs: Vercel for preview, Hostinger for production)* |
| Payments | PayFast Pakistan, hosted/redirect checkout |

**Why one Next.js app instead of a separate Express backend:** Next.js Route
Handlers *are* Node.js. A separate Express service would add a network hop
(more latency), a second deployment, CORS handling, and a second place to
secure secrets. The layered structure gives the same separation of concerns.

---

## 4. Project Memory System

Four files let any new session understand full project state without re-reading
the codebase:

- **`CLAUDE.md`** (repo root) — loaded automatically every session. Under ~200
  lines. 10-line orientation, the read-order instruction, the
  "update-the-docs-is-part-of-done" rule, real commands, and pointers to the
  security rules and installed tooling.
- **`project_architecture.md`** — stable reference: stack, folder structure,
  data models, API contract, integrations, security architecture, deployment.
  Update when architecture actually changes.
- **`project_progress.md`** — running reverse-chronological log. Date, what
  changed, non-obvious decisions and why, what's next. Update after every
  feature/fix/milestone.
- **`project_state.yaml`** — machine-readable snapshot parseable in seconds:
  current phase, tech stack, completed/in-progress/pending features, known
  issues, blockers, integration status, next steps.

Keep `project_state.yaml` and the recent end of `project_progress.md` accurate
above everything else in the repo.

---

## 5. Git Workflow

- Repo: `https://github.com/Majid580/gamesCentral` — commit and push after every
  meaningful chunk of work.
- `.gitignore` from the first commit: `node_modules`, `.next`, `.env*` (except
  `.env.example`), local DB dumps.
- Commit messages: short, imperative, type prefix fine (`feat:`, `fix:`,
  `chore:`). They and `project_progress.md` should tell the same story.
- Never commit real credentials. Commit `.env.example` with names only.
- Single `main` branch. Tag milestones (`v0.1-mvp`) if useful.

---

## 6. Core User Journey

1. **Browse** — package cards (diamond amount, PKR price) from *our* database,
   synced from SmileOne — never fetched live on every page view.
2. **Select** — customer picks a package, enters Player ID + Zone ID.
3. **Validate** — backend calls `getrole` to confirm the account exists and
   returns its in-game username. Show *"Confirm this is your account:
   **[username]**"* before payment. This is the main safety net against a
   mistyped ID sending diamonds to a stranger.
4. **Confirm & pay** — create an internal order (`pending`) with a
   server-computed PKR total, then redirect to PayFast.
5. **Verify** — PayFast confirms payment (webhook + an independent
   server-to-server status check, never the redirect alone). Mark `paid`.
6. **Fulfill** — call `createorder`. On success mark `fulfilled` and show/email
   confirmation with the SmileOne order ID. On failure mark
   `paid_pending_fulfillment` and surface it in admin rather than losing it.
7. **Track** — no customer accounts in v1. Look up an order by order ID + the
   email/phone given at checkout.

---

## 7. Admin Requirements

- Protected admin area (separate auth from the customer flow): view/search
  orders, see status history, manually retry or mark-fulfilled an order stuck
  at `paid_pending_fulfillment`, basic stats (orders today, revenue, failure
  rate).
- Admin auth: prefer Auth.js/NextAuth. Whatever the choice: hashed passwords
  (bcrypt/argon2), session or short-lived JWT, rate-limited login, route-level
  protection via middleware on **every** admin route.
- Package/pricing management: review the synced list, curate which packages are
  shown (clean display names, not raw `spu` strings), set the markup.
- Admin UI gets the same design treatment — it's where recovery of stuck orders
  happens.

---

## 8. SmileOne Integration

The owner's `mlbb_API_Documentation.pdf` is authoritative over this summary.
Test against sandbox first.

**Base URLs:** Sandbox `https://frontsmie.smile.one` · Production
`https://www.smile.one`

**Sign generation (required on every call):**

```js
function generateSmileOneSign(params, merchantKey) {
  const sortedKeys = Object.keys(params).sort();
  let str = '';
  for (const k of sortedKeys) str += `${k}=${params[k]}&`;
  str += merchantKey;
  return md5(md5(str)); // double MD5, exactly as documented
}
```

Signs are valid ~5 minutes — always generate immediately before the call using
the current server timestamp, never a cached one. Runs **server-side only**;
the merchant key never reaches the browser.

**Endpoints** (all `POST`, `application/x-www-form-urlencoded`):

| Endpoint | Params | Returns | When |
|---|---|---|---|
| `/smilecoin/api/productlist` | uid, email, product, time, sign | `{id, spu, price}[]` | Periodic sync into our DB |
| `/smilecoin/api/getrole` | email, uid, userid, zoneid, product, productid, time, sign | `username, zone, change_price, use` | After ID entry, before payment |
| `/smilecoin/api/createorder` | email, uid, userid, zoneid, product, productid, time, sign | `order_id` | Only after payment verified |

Sandbox credentials (testing only — never use in production):

```
email:       agent@smileone.com
uid:         1041302
key:         [REDACTED — stored as SMILEONE_KEY in .env.local, never in git]
test userid: 17366
test zoneid: 22001
```

Notes for the implementer:

- `getrole`'s `change_price` may differ from the cached product-list price —
  treat `change_price` as the source of truth for the final charge when
  present, and log any mismatch instead of silently picking one.
- The `use` field isn't explained in the provided docs — log it during sandbox
  testing and inspect real responses rather than assuming its meaning.
- `spu` strings (e.g. `"mobilelegends BR 78 &8 Diamond"`) are
  inconsistent/abbreviated — don't display them verbatim. Maintain an
  admin-curated mapping (SmileOne `id` → clean display name + diamond count).
- Make `createorder` **idempotent** against our own order ID. Use an atomic
  conditional update (`findOneAndUpdate({ _id, status: 'paid' }, { status:
  'fulfilling' })`) so two concurrent requests can't both proceed.

---

## 9. PayFast Integration

PayFast Pakistan (`gopayfast.com`, regulated by the State Bank of Pakistan)
offers two paths:

1. **"API Based" / direct integration** — our site collects raw card numbers,
   CVV, bank account numbers, and CNIC. This pulls **full card data through our
   own servers**, putting the site in **PCI-DSS scope**.
2. **Hosted/redirect checkout** — the customer is redirected to a PayFast-hosted
   page; PayFast carries the PCI-DSS burden.

**Recommendation: hosted/redirect checkout (option 2).**

**(confirm) before building:** field-level docs for the *hosted* mode
specifically weren't available during research. Once merchant sandbox
credentials exist, get the hosted-checkout guide from the PayFast dashboard or
account manager, pull current docs via context7, then confirm exact field names.

Confirmed and reusable regardless of mode:

- Auth: `POST /token` with `merchant_id`, `secured_key`,
  `grant_type=client_credentials` returns a bearer token.
- `GET /transaction/<transaction_id>` or
  `GET /transaction/basket_id/<basket_id>` returns transaction status — **use
  this to independently verify a payment server-to-server.**
- `POST /transaction/refund/<transaction_id>` handles refunds.
- Currency is PKR only.

**Non-negotiable regardless of field names:** on any payment notification,
re-fetch the transaction status directly from PayFast using our stored
reference, and confirm the **amount and status match the order we created**
before marking it paid or calling SmileOne. Never fulfill on a client-side
redirect alone.

---

## 10. Pricing & Currency Logic

SmileOne prices appear to be USD — confirm against real sandbox responses.

```
price_pkr = round(smileone_price * exchange_rate * (1 + markup_percentage))
```

`exchange_rate` and `markup_percentage` are configurable (env var or admin
`config` document), never hardcoded. Store all money as **integers in the
smallest unit (paisa)** or fixed-point — never raw floats.

---

## 11. Data Model

- **Product** — `smileOneProductId`, `game`, `displayName`, `diamondAmount`,
  `basePriceUsd`, `isActive`, `lastSyncedAt`
- **Order** — `orderId` (internal, unique), `productRef`, `playerId`, `zoneId`,
  `confirmedUsername`, `pricePkr` (integer paisa), `status` (`pending` →
  `awaiting_payment` → `paid` → `fulfilling` → `fulfilled` /
  `paid_pending_fulfillment` / `failed`), `paymentReference`, `smileOneOrderId`,
  `contactEmail`, `contactPhone`, `timestamps`, embedded `statusHistory[]`
- **AdminUser** — `email`, `hashedPassword`, `role`, `lastLoginAt`
- **Config** — `markupPercentage`, `exchangeRate`

Indexes at minimum: `Order.orderId` (unique), `Order.status`,
`Order.createdAt`, `Product.smileOneProductId`. Enforce the status state machine
in the service layer, and use atomic `findOneAndUpdate` guards for
money-touching transitions.

---

## 12. Security Requirements

1. Server always recomputes price; client-submitted amounts never trusted.
2. All secrets in server-side env vars only. `.env.example` in git with names
   only. `NEXT_PUBLIC_`-prefixed vars are exposed to the browser — keep secrets
   un-prefixed.
3. Verify payment server-to-server before `createorder`.
4. Idempotent fulfillment — never deliver twice for one order.
5. Rate-limit `getrole` lookups, order creation, admin login.
6. Validate/sanitize all inputs server-side — never rely on client-side
   validation alone.
7. Mongoose with parameterized queries; guard against NoSQL operator injection
   (reject object-valued inputs where a scalar is expected).
8. Admin auth: hashed passwords, short-lived sessions/JWT, rate-limited login,
   middleware on every admin route.
9. HTTPS + HSTS everywhere; secure/httpOnly/sameSite cookies.
10. Standard security headers (CSP, X-Content-Type-Options, Referrer-Policy).
11. Least-privilege DB user for the app's connection.
12. Structured logging of payment/fulfillment events; never log full secrets or
    raw payment details.
13. Money stored as integers/fixed-point, never floats.
14. Never pass raw SmileOne/PayFast responses straight to the client — filter
    server-side to only what the UI needs.
15. Keep dependencies patched; run `npm audit` periodically; avoid adding a
    package for something 20 lines of code would do.
16. `paid_pending_fulfillment` safety net so a payment is never silently lost.

### 12.1 Two-layer security validation

- **Code review — `claude-security` (`/security-review`), Phase 9.** Scans *our
  own source* for injection, secret leakage, broken auth, unsafe money
  handling, NoSQL injection. Run after each major money/auth feature, and as a
  go-live gate.
- **Live penetration test — `strix-pentest`, Phase 9.5.** Actively attacks the
  *running deployment* (staging first). **Explicitly invoke it.** Requires
  Docker Desktop, our own site as the only target, and written owner
  authorization. Focus: authentication bypass on `/admin`, price/amount
  tampering, IDOR on order lookup, injection on `getrole`/order inputs. Feed
  CVSS ≥ 7.0 findings back into fixes and re-scan.

---

## 13. Performance Requirements

- Server Components by default; Client Components only for interactive pieces.
- Cache the synced SmileOne product list in the DB — never call SmileOne on a
  page load.
- `next/image` for all art/logos; serve WebP/AVIF.
- Skeleton/optimistic UI while `getrole` is in flight — the slowest step in
  checkout.
- DB indexes per Section 11; **reuse a pooled Mongoose connection across
  serverless invocations** rather than reconnecting per request.
- Keep the client bundle lean — check bundle size before adding a UI library.

---

## 14. Required Pages

Per PayFast's stated requirements plus standard practice:

- Privacy Policy
- Return/Refund Policy
- Shipping/Service (Delivery) Policy — for digital goods: how top-ups are
  delivered, expected time-to-delivery, what happens if delayed
- Terms & Conditions
- Contact page with a **real** local office address and contact number
  (PayFast checks this — no placeholders)
- At least 7–8 distinct products/packages listed
- A short disclaimer that Games Central is an independent top-up reseller, not
  officially affiliated with Moonton/Mobile Legends

---

## 15. Branding & Assets

Owner has dark-mode and light-mode logos, currently JPG. JPG has no
transparency — fine as a source file, but for a logo sitting on
different-colored headers, get PNG or SVG versions with transparent backgrounds
before final polish. Not a launch blocker.

---

## 16. Environment Variables (names only)

```
DATABASE_URL=
SMILEONE_API_BASE_URL=
SMILEONE_UID=
SMILEONE_EMAIL=
SMILEONE_KEY=
PAYFAST_MERCHANT_ID=
PAYFAST_SECURED_KEY=
PAYFAST_MODE=sandbox|production
SESSION_SECRET=
ADMIN_EMAIL=
NEXTAUTH_SECRET=
NEXT_PUBLIC_SITE_URL=
DEFAULT_MARKUP_PERCENTAGE=
USD_TO_PKR_RATE=
RESEND_API_KEY=        # optional
UPSTASH_REDIS_URL=     # optional
```

---

## 17. Suggested Folder Structure

```
gamesCentral/
├── CLAUDE.md
├── project_architecture.md
├── project_progress.md
├── project_state.yaml
├── INITIAL_BRIEF.md
├── .env.example
├── app/
│   ├── (site)/
│   ├── admin/
│   └── api/
├── lib/
│   ├── controllers/
│   ├── services/
│   ├── models/
│   └── utils/
├── components/
└── public/
```

---

## 18. Suggested Build Phases

0. **Scaffolding** — Next.js 16 init, folder structure, `CLAUDE.md` + tracking
   docs, `.env.example`, first commit/push, pooled Mongoose connection helper.
1. **Static shell** — home page, legal pages (placeholder text marked TODO),
   both-mode logos, base layout.
2. **SmileOne sandbox integration** — sign utility, product-list sync,
   `getrole`. Verify end-to-end before touching payments.
3. **Product browsing UI** on the synced/curated package data.
4. **Checkout flow UI** — selection → ID entry → validate/confirm → order
   record (payment stubbed).
5. **PayFast sandbox integration** — hosted checkout redirect, callback
   handling, server-to-server verification.
6. **Real fulfillment** — verified `createorder`, idempotency,
   `paid_pending_fulfillment` path.
7. **Order confirmation/status page** (+ email if wanted).
8. **Admin dashboard** — auth, order management, manual retry.
9. **Code security hardening pass** — Section 12 checklist, run
   `claude-security`.
9.5. **Live penetration test** — `strix-pentest` against staging.
10. **Performance pass** — Section 13 checklist.
11. **Sandbox → production cutover** — Section 21.

---

## 19. Pitfalls to Avoid

- Trusting any price/amount that comes from the client
- Calling `createorder` before payment is verified, or more than once per order
- Trusting a payment redirect/webhook without an independent status check
- Committing `.env` files or real credentials
- Hardcoding prices or markup in frontend code
- Skipping `getrole` validation
- NoSQL operator injection — unsanitized object-valued input into a query
- Reconnecting to MongoDB on every serverless invocation
- Writing integration code from memory instead of pulling current docs via
  context7
- Pointing `strix-pentest` at anything other than our own deployment
- Letting the tracking docs go stale

---

## 20. Open Decisions / Assumptions to Confirm

*(All resolved on 2026-08-15 except where noted — see `project_state.yaml`
`decisions:` for the authoritative record.)*

- **Database engine: MongoDB Atlas** — confirmed. Real connection string still
  outstanding.
- **Admin auth** — Auth.js/NextAuth **confirmed**.
- **Hosting** — **superseded:** Vercel for free frontend testing, **Hostinger
  for production**.
- **Architecture** — single Next.js app **confirmed**.
- **PayFast integration mode** — hosted/redirect recommended; **still to
  confirm** exact field names against the live merchant dashboard.
- **Markup percentage and USD→PKR rate** — left configurable, no default
  assumed.
- **No customer account system for v1** — guest checkout + order lookup
  **confirmed**.

---

## 21. Go-Live Checklist

- [ ] All sandbox tests pass end-to-end (browse → validate → pay → fulfill) in
      both SmileOne and PayFast sandboxes
- [ ] `claude-security` code review passes with no unresolved high-severity
      findings
- [ ] `strix-pentest` run against staging passes with no unresolved CVSS ≥ 7.0
      findings
- [ ] Legal pages have real, final text — not placeholders
- [ ] Contact page has the real office address and phone number
- [ ] Swap `SMILEONE_*`, `PAYFAST_*`, and `DATABASE_URL` env vars to production
      values in the host's dashboard (never in code)
- [ ] Webhook URL is a real, public HTTPS endpoint reachable by PayFast
- [ ] The app connects to MongoDB with a least-privilege Atlas user
- [ ] Run one real, small-value transaction end-to-end before announcing launch
- [ ] Confirm at least 7–8 packages are live and priced correctly
- [ ] Security headers, rate limiting, and admin auth all verified in the
      production environment, not just locally

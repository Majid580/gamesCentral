# Project Progress

Reverse-chronological log. Newest entry on top. Every feature, fix, or
milestone gets an entry — see `CLAUDE.md` for why this is part of "done".

---

## 2026-08-15 — Data model: five collections, indexed and verified on Atlas

The live cluster unblocked the schemas. Section 11's data model is now
implemented, indexed, and checked against the real database rather than
assumed.

**Built**

- `lib/models/define-model.ts` — `defineModel()` reuses an already-registered
  model instead of throwing `OverwriteModelError`, which Next.js hot reload
  triggers constantly (modules re-evaluate; the `mongoose` singleton on
  `globalThis` does not). Also `integerMoneyField()`, a reusable money field
  whose validator makes a float a **write-time failure** rather than a drift
  nobody notices until reconciliation.
- **Game** — first-class from day one. Beyond display fields it owns the
  per-game supplier knowledge with nowhere else to live: the exact string
  SmileOne's `product` parameter expects, and whether checkout must collect a
  Zone ID. Adding a second game must never need a migration.
- **Product** — synced catalogue, admin-curated `displayName`, raw `spu`
  retained for admin matching but never rendered.
- **Order** — the money-touching one. Status machine, embedded
  `statusHistory[]`, generated order ID, frozen pricing snapshot.
- **AdminUser** — `hashedPassword` is `select: false` so an accidental
  `findOne()` in an unrelated path cannot pull a credential hash into a
  response payload.
- **AppConfig** — pricing singleton, plus an `ordersPaused` kill switch so an
  admin can stop taking money the moment SmileOne or PayFast misbehaves
  instead of accruing unfulfillable orders.
- `npm run db:sync-indexes` — explicit index creation as a deploy step.

**Decisions and why**

- **`basePriceUsd` is stored as `basePriceUsdCents`, deviating from the brief's
  field name.** A float base price breaks rule 5 the moment it is multiplied
  by the exchange rate and the markup, and that is precisely the value that
  gets multiplied. `supplierRawPrice` keeps the untouched supplier string
  alongside it, so the brief's own open question — whether SmileOne prices
  really are USD — stays answerable from stored data instead of being lost at
  parse time.
- **The status machine has no route from `paid` to `failed`.** Rule 8 says a
  payment must never be silently lost; encoding that as a missing edge makes
  it structural rather than something a future reviewer has to remember.
  `paid_pending_fulfillment` is the only sink after money changes hands.
- **Order IDs are CSPRNG-random, not sequential.** Guest order lookup takes an
  order ID, so a predictable counter would let anyone walk the order book.
  Ambiguous characters (0/O/1/I/L) are excluded because these get read aloud
  over WhatsApp and typed back by hand. `randomInt` avoids the modulo bias a
  naive `randomBytes[i] % 31` would introduce.
- **Orders snapshot their pricing inputs.** The rate and markup are editable
  by design; without the snapshot an order's total becomes unreproducible the
  first time either changes, and a dispute months later cannot be settled.
- **Dropped the standalone `status` index** after seeing it in the first sync
  output. The `{status, createdAt}` compound already serves status-only
  queries through its prefix, so the second index was pure write cost.
- **Models use relative `./x.ts` imports rather than the `@/` alias.** Node
  cannot resolve tsconfig path aliases, and the standalone scripts must import
  the models. `scripts/` already set this precedent, and `tsconfig.json`
  already enables `allowImportingTsExtensions` for it. `db:sync-indexes` runs
  under `--conditions=react-server` so the `server-only` marker resolves to
  its empty stub instead of throwing.

**Verified**

- `npm run db:sync-indexes` against Atlas created all five collections and
  their indexes; re-running after removing the redundant `status` index
  reported `dropped: status_1`, confirming the drop path works too.
- **31/31 schema invariants proved against the real database** with a
  throwaway script, which then cleaned up after itself (final document counts
  all zero). Covered: float and negative money rejected on both Order and
  Product; every unique constraint (orderId, smileOneProductId, game slug,
  admin email, config singleton); enum rejection for status and role;
  `hashedPassword` hidden by default and readable via `.select("+…")`; email
  lowercasing; order-ID format, alphabet, and 5000-way uniqueness; and all
  seven status-machine assertions including `paid -> failed` blocked.
- Models load in the **real Next.js runtime**, not merely compile: a temporary
  route handler importing all five returned
  `{"models":["Game","Product","Order","AppConfig","AdminUser"],"guard":false}`
  where `guard` is `canTransition("paid","failed")`. Route deleted afterwards.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` all clean.

**Snag worth recording**

The first build-check route was placed at `app/api/_buildcheck/`. Next.js
treats a leading underscore as a **private folder** and excludes it from
routing entirely, so it never got bundled and the build proved nothing —
it silently passed. Renaming it revealed `ƒ /api/buildcheck` in the route
table and gave a real answer.

**Next**

- Phase 2's productlist sync now has somewhere to write, but remains blocked
  on the SmileOne sandbox base URL.
- Pricing service (`basePriceUsdCents × exchangeRate × (1 + markup)` → integer
  paisa) is unblocked and needs no supplier access.

---

## 2026-08-15 — MongoDB Atlas connected; Node SRV resolver fault diagnosed

The owner supplied the Atlas connection string, clearing the longest-standing
blocker. The cluster is live and writable, but reaching it exposed a local
resolver fault that had to be fixed before any DB-backed work could run.

**Built**

- `DATABASE_URL` written to `.env.local` (gitignored) with an explicit
  `/gamescentral` database segment — without a path segment the driver
  silently connects to `test`, which would have scattered collections into the
  wrong database for the rest of the build.
- `scripts/db-check.mts` + `npm run db:check` — a standalone connectivity
  probe. Redacts credentials from all output, reports server version and
  collections, then round-trips an insert/delete to prove the Atlas user has
  **write** access and not merely connect access. A read-only user passes
  `ping` and fails the first real checkout; better to learn that now.
  Failures print a cause-specific hint (DNS / auth / IP allowlist).
- `lib/utils/dns-resolver.ts` — `ensureSrvResolverAvailable()`, called from
  `connectToDatabase()` and the probe, but only for `mongodb+srv://` URIs.

**The SRV fault, since it will recur on any Windows dev machine**

`mongodb+srv://` must resolve an SRV record first, and Node does that with its
bundled c-ares resolver (`dns.resolveSrv`) — *not* the OS resolver behind
`dns.lookup`. On Windows, c-ares reads nameservers from the static
`NameServer` registry value. This machine's DNS is DHCP-assigned, so the
address lives in `DhcpNameServer`, c-ares found no servers, and fell back to
its compiled-in default of `127.0.0.1` where nothing is listening.

The symptom is deeply misleading: `dns.lookup` keeps working, so ordinary
hostnames resolve fine while every SRV query dies with
`querySrv ECONNREFUSED`, which reads like a dead cluster rather than a local
misconfiguration. Verified directly — `Resolve-DnsName -Type SRV` returned all
three shard hosts from Windows, while `dns.getServers()` inside Node returned
`["127.0.0.1"]`.

`ensureSrvResolverAvailable()` fires **only** when the process has no usable
nameserver at all, and then points c-ares at 1.1.1.1/8.8.8.8 for that process
with a loud warning. Because the guard requires a provably broken resolver it
cannot mask a real DNS failure in production, and on the Hostinger target
c-ares reads `/etc/resolv.conf` and the whole path is a no-op.

**Decisions and why**

- **Kept `mongodb+srv://` as canonical** rather than pasting the non-SRV
  string that also connects. The SRV record is what lets Atlas move or rescale
  shard hosts without a config change; hardcoding the three current hostnames
  trades a permanent maintenance hazard for a local convenience.
- **Repaired the resolver in the app path, not just the script.** Without it
  `npm run dev` cannot reach the database on this machine, which blocks every
  remaining phase — a dev-script-only fix would have looked green while the
  app stayed broken.

**Verified**

- `npm run db:check` — connected in ~1.2s, ping ok, MongoDB **8.0.29**,
  database `gamescentral`, no collections yet, insert + delete round-tripped.
- Credentials and the Atlas IP allowlist both accept this machine.
- `npm run lint` and `npx tsc --noEmit` clean.
- **SmileOne blocker re-tested on the real Windows resolver and confirmed
  genuine, not a sandbox artifact:** `frontsmie.smile.one` and
  `sandbox.smile.one` both return "DNS name does not exist" while
  `www.smile.one` resolves to 104.18.35.98 / 172.64.152.158. The Phase 2
  blocker stands as written.

**Open — needs the owner**

- **Credentials are `root` / `root`.** Fine for wiring up; not fine for a
  database that will hold real orders and customer contact details. Before
  go-live: a strong generated password and a least-privilege user scoped to
  `readWrite` on `gamescentral` only, plus a check that Network Access is not
  left at `0.0.0.0/0`. Section 12.4 territory.

**Next**

- Phase 2 remains blocked on the SmileOne sandbox base URL.
- Product/Order Mongoose schemas can now be built and indexed against a real
  cluster.

---

## 2026-08-15 — Phase 1.5: colour system, theme toggle, and motion

Visual and interaction pass over the Phase 1 shell. No commerce, auth, or
fulfilment code touched. Requested scope was "better colour, keep light and
dark, add animation including scroll animation".

**Built**

- **The dispersion ramp** (`--spectrum-1..4`). Decorative colour is no longer
  ad-hoc: it walks the cool half of the visible spectrum — cyan, indigo,
  fuchsia, rose — because that is what a cut diamond does to light, and
  diamonds are the product. **Green is deliberately excluded from the ramp**,
  so seeing green anywhere on the site still means money and never decoration.
  Rule 1 of the palette survives intact.
- **Light/dark toggle** in the header (`components/site/theme-toggle.tsx`).
  The tokens already supported `data-theme`; nothing set it, so a visitor could
  never see the other theme. Now they can, and the choice persists.
- **Scroll reveal** (`components/site/scroll-reveal.tsx`) — one
  IntersectionObserver mounted once in the site layout, driving any element
  tagged `data-reveal`. Sections and pages stay Server Components and only
  carry an attribute.
- **Page-load entrance** on the hero (staggered), a slow gradient sweep across
  the headline, hover glow + light-sweep on buttons and cards, sliding nav
  underline, staggered mobile-nav panel.
- **The hero stone** — a six-facet round-brilliant SVG in profile, where every
  facet takes one stop of the ramp. It is both the hero image and the literal
  definition of the page's colour system.
- Ambient fixed mesh gradient behind every page, per theme.

**Bugs found and fixed along the way**

- **Dark mode could serve a colour that fails WCAG AA.** The dark palette was
  written twice — once under `prefers-color-scheme`, once under
  `[data-theme="dark"]` — and the two had drifted. The manual copy still
  carried `--primary: #8b5cf6`, which measures 4.46:1 on the background against
  a 4.5:1 floor. Harmless while nothing set `data-theme`; live the moment a
  toggle exists. Fixed, and made structurally impossible to recur: dark values
  are now declared once as `--dark-*` and mapped onto the live tokens by both
  paths, so there is only one place a dark value can be written.
- **`hidden sm:inline-flex` did not hide anything.** `cn()` is a plain join
  with no conflict resolution, so the caller's `hidden` and the button's base
  `inline-flex` tied on specificity and Tailwind's emit order decided it —
  `inline-flex` won. The header CTA stayed visible on mobile. It fit before, so
  nothing showed; adding the 44px theme toggle pushed the header 22px past the
  viewport and exposed it. Fixed by moving the button skeleton into
  `@layer components` (`.btn`), which Tailwind's utilities layer outranks, so a
  caller's className now always wins. No `tailwind-merge` dependency needed.
- Hover states written as hand-rolled CSS lacked Tailwind's implicit
  `@media (hover: hover)` gate and would stick after a tap on touch. Gated.
- `suppressHydrationWarning` added to `<body>`. Browser extensions stamp
  attributes onto it before React hydrates (ColorZilla's
  `cz-shortcut-listen`, Grammarly's equivalents), each raising a mismatch
  unrelated to our markup. Not caused by this work — the `<html>` suppression
  for `data-theme` does not cascade — but a noisy dev console hides real
  errors. Covers only that element's own attributes, not its children.

- **The `#packages` CTAs only worked once per page load.** `next/link`
  navigates the router instead of letting the browser perform a fragment
  navigation. Once the URL already carried `#packages` that navigation was a
  no-op, and since Link had already called `preventDefault()` the browser's
  native scroll-to-fragment never ran either. Click "Choose a package", scroll
  up, click again — nothing. Measured: click 1 → y=893, clicks 2 and 3 → y=0.
  Fixed with `components/site/anchor-scroll.tsx`, one capture-phase listener
  mounted in the site layout. Link bails out when `e.defaultPrevented` is set
  (verified in `node_modules/next/dist/client/app-dir/link.js:336`), so
  preventing there hands over the click cleanly. Chosen over converting seven
  call sites to plain `<a>`, which would have cost prefetch and client-side
  navigation on the cross-page links. Cross-page `/#packages` is left entirely
  to the router and still lands correctly.

**Decisions and why**

- **No animation library.** GSAP + ScrollTrigger is ~40KB for what
  IntersectionObserver does in 30 lines. On a storefront, bundle size is a
  conversion cost (Section 12.15). Everything animates transform, opacity, or
  background-position only, so it stays on the compositor thread.
- **Scroll reveal hides content behind `@media (scripting: enabled)`**, not a
  JS-applied class. With JS off — or in a crawler that does not run it —
  nothing is ever hidden, and `<html>` is never mutated, so there is no
  hydration mismatch to suppress.
- **The theme script is a raw inline `<script>`, not `next/script`.**
  `strategy="beforeInteractive"` was tried and rejected: Next queues inline
  content onto `self.__next_s` and replays it after the framework chunks load,
  well after first paint — the exact flash it exists to prevent. Verified in
  the SSR HTML. The cost is a React dev-only console warning, documented in
  place so it does not get "fixed" back into a flash.
- **A toggle that needs JS is hidden without JS** (`@media (scripting: none)`).
  A control that silently does nothing is worse than no control.
- **`useSyncExternalStore` rather than `useState` + effect** for the toggle's
  label. The effective theme lives in two places React does not own — the DOM
  attribute and the OS preference — and subscribing to both means the label
  stays right when someone changes their system theme with the page open.
- **Legal pages get no scroll animation.** They are reference documents that
  people read under stress; revealing paragraphs as they scroll would be
  hostile. They get the colour work only.
- **Numbering kept on "How it works", added nowhere else.** Those steps are a
  real sequence — you cannot pay before confirming the account — so the numbers
  carry order rather than decorate.

**Verified (measured, not eyeballed)**

- **Contrast recomputed for every role each spectrum stop can play**, including
  as text on its own 14%-tint chip. Two light-mode stops failed: `#0e7490` at
  4.23:1 and `#e11d48` at 3.61:1 as a step number. Solved for the brightest
  replacements that clear 4.5:1 everywhere — `#0d6d87` and `#bf193d` — rather
  than guessing. All four stops now pass every role in both themes; dark mode
  passed unchanged at 5.00–10.44.
- Toggle round-trip in the browser: `data-theme`, `localStorage`,
  `color-scheme`, resolved token values, button label, and the `theme-color`
  meta tags all update correctly in both directions.
- Mobile 375×812: horizontal overflow back to **0px**, every visible tap target
  ≥44×44 (only the sr-only skip link measures smaller, by design).
- `npm run build`: all 8 routes still prerender as **static** — neither the
  toggle nor the reveal forced anything dynamic. `lint` and `typecheck` clean.

**Not verified — needs a human**

The Browser pane was not displayed during this session
(`document.visibilityState === "hidden"`), so the page never composited frames.
That means **no screenshot was taken and the scroll reveal was never observed
firing** — IntersectionObserver does not report intersections in a hidden
document. The wiring is confirmed correct (elements resolve to `opacity: 0`
with the transform applied, the observer is constructed and observes 19
targets), but the animation itself is unwatched. Open the preview and scroll
before trusting it.

**Next**

- Unchanged: Phase 2 is still blocked on the SmileOne sandbox URL.

---

## 2026-08-15 — Phase 2 (partial): SmileOne signing verified, sandbox host unreachable

**Built**

- `lib/services/smileone/sign.ts` — the double-MD5 signature, `time` +
  `sign` attachment, and form encoding. Deliberately free of `server-only`
  and env access so the probe script can exercise the *real* signing code
  rather than a copy of it.
- `lib/services/smileone/client.ts` — `server-only`. Signed POST helper with
  a 12s timeout, plus `fetchProductList` and `getRole`. Returns narrowed
  types; no raw upstream payload ever reaches a caller (Section 12.14).
- `scripts/smileone-sandbox-check.mts` — read-only sandbox probe
  (`npm run smileone:probe`). Calls productlist and getrole only; it
  deliberately does **not** call `createorder`, which would spend sandbox
  balance and create an order.
- `.env.local` (gitignored, verified via `git check-ignore`) holding the
  sandbox credentials for local testing.

**Verified**

- Signing self-check passes: sorted-key independence (key insertion order
  does not change the digest), 32-char hex output, and it throws if a `sign`
  is already present in the params (which would sign a signature).

**BLOCKER — the documented sandbox host does not exist**

`https://frontsmie.smile.one` has **no DNS record.** Checked on 2026-08-15:

| Host | Result |
|---|---|
| `frontsmie.smile.one` | NO DNS RECORD |
| `sandbox.smile.one` | NO DNS RECORD |
| `test.smile.one` | NO DNS RECORD |
| `api.smile.one` | NO DNS RECORD |
| `dev.smile.one` | NO DNS RECORD |
| `www.smile.one` | resolves (Cloudflare) |
| `smile.one` | resolves |

General outbound networking is fine — `registry.npmjs.org` returned 200 — so
this is not a local network or firewall problem. The sandbox hostname in the
brief is either wrong or has been decommissioned.

**Consequence:** the request side is done and the signing is verified, but the
**response schemas in `client.ts` are unconfirmed**. They are written
defensively — they accept the documented fields, tolerate the two plausible
envelope shapes (`{data:{product:[…]}}` vs `{product:[…]}`), and log the actual
top-level shape on a mismatch rather than throwing something opaque. They must
be tightened against a real response before Phase 3 depends on them.

Deliberately **not** worked around by pointing the probe at production
`www.smile.one` — that is a live third-party system and the sandbox
credentials are marked "never use in production".

**Needed from the owner:** the correct sandbox base URL from
`mlbb_API_Documentation.pdf` (authoritative per the brief) or from the
SmileOne account manager.

**Next**

- Unblock the sandbox URL, re-run `npm run smileone:probe`, tighten the
  response schemas, then build the Product model + sync (needs `DATABASE_URL`).

---

## 2026-08-15 — Phase 1: static shell, design system, legal pages

**Built**

- Design token system in `app/globals.css` — light + dark, driven by CSS
  variables so `bg-background` works in both without `dark:` variants
  everywhere. Responds to `prefers-color-scheme` *and* a `data-theme`
  attribute, so a manual theme toggle can be added later without redoing
  tokens.
- Typography: Space Grotesk (display) + DM Sans (body) via `next/font/google`.
- Site chrome: `SiteHeader` (sticky, skip link, active nav state),
  `SiteFooter`, `MobileNav`, and the `(site)` route-group layout.
- Pages: home, `/privacy`, `/refund`, `/delivery`, `/terms`, `/contact`, and a
  `/track` placeholder. All 8 routes statically prerendered.
- Components: `PackageCard`, `Logo`, `Button`/`ButtonLink`, `LegalShell`.
- `lib/utils/money.ts` — integer-paisa formatting that *throws* on a
  non-integer input, so a float can never silently reach a price display.
- `lib/site-config.ts` — one place for nav, contact details, and the reseller
  disclaimer.

**Decisions and why**

- **Palette.** Crossed three product types from the ui-ux-pro-max dataset that
  this site sits between: Gaming (dark indigo canvas, neon purple), Marketplace
  P2P ("trust purple + transaction green"), and Digital Products ("buy green").
  Result: **purple carries brand, green carries money.** Every buy/confirm
  action is green so the commerce path reads as one continuous signal instead
  of a wall of identical buttons. Rose is reserved for "most popular" emphasis
  and never used as a plain action colour.
- **Light mode is the Marketplace palette, dark mode is the Gaming palette** —
  same purple family, so the owner's light and dark logos both land on one
  coherent identity rather than two unrelated themes.
- **Typography** is the dataset's "Tech Startup" pairing. The dataset lists
  Fredoka/Nunito for gaming, but that reads as a children's app — wrong for a
  site taking payments. Space Grotesk gives distinctive letterforms without
  sacrificing the credibility the checkout and legal pages need.
- **No shadcn/ui, no clsx, no tailwind-merge.** Section 13 says check bundle
  size before adding a UI library and Section 12.15 says don't add a package
  for what 20 lines can do. `cn()` is 3 lines; the buttons and cards are small.
  Revisit if the admin dashboard (Phase 8) needs real composite widgets.
- **Legal pages are substantive drafts, not lorem ipsum.** Every page carries a
  visible "Draft — needs owner review" banner and inline `TODO(owner)` markers
  only where the owner holds facts I don't (registered entity, retention
  period, jurisdiction). Section 21 gates go-live on these being resolved.
- **`/track` is an honest empty state rather than a dead form.** A lookup box
  that silently does nothing is worse than saying it isn't ready. The real one
  lands in Phase 7 and must require order ID *plus* matching contact detail —
  order ID alone would be an IDOR.
- **The `.claude/launch.json` dev-server config** is committed so future
  sessions can start the preview without rediscovering the command.

**Verified (not assumed)**

- `npm run build`: all 8 routes compile and prerender as static. `npm run lint`
  and `npm run typecheck`: clean.
- **Contrast measured on the rendered tokens, not eyeballed.** Dark mode
  initially failed WCAG AA in two places — `--primary` `#8b5cf6` measured
  4.46:1 on the background and 4.06:1 on cards, against a 4.5:1 floor. Solved
  for a replacement (`#9b7ef8`: 6.05 / 5.52 / 6.10) rather than guessing. All
  pairs now pass AA in both themes; light mode passed unchanged (4.70–15.24).
- **Mobile (375×812): no horizontal overflow, and every tap target now clears
  44×44.** Footer links measured 19px tall and the logo link 39px — both fixed.
- Mobile nav verified functionally: `aria-expanded` toggles, label swaps
  open/close, panel renders all four links, body scroll locks.
- Package cards were `<article>` elements with no accessible name; each now has
  an `<h3>` and `aria-labelledby`, with a visually-hidden suffix so a screen
  reader hears "86 diamonds — Starter top-up" rather than a bare number.

**Known gaps carried forward**

- Home page renders `PLACEHOLDER_PACKAGES` behind a visible "preview build"
  notice. Prices are illustrative and **must not ship publicly** — Phase 3
  deletes that module and reads the synced catalogue.
- `components/brand/logo.tsx` is an SVG placeholder. Needs the owner's real
  logos as PNG/SVG with transparency.
- Contact address and phone are placeholders. PayFast verifies these.

**Next**

- Phase 2: SmileOne sandbox — sign utility, product-list sync, `getrole`.

---

## 2026-08-15 — Phase 0: scaffolding and foundations

**Built**

- Next.js 16.3.1 scaffold (App Router, Turbopack, TypeScript, Tailwind v4,
  ESLint) with React 19.2.8.
- Section 17 folder structure: `app/(site)`, `app/admin`, `app/api`,
  `lib/{controllers,services,models,utils}`, `components`, `public/brand`.
- `next.config.ts`: security headers (CSP, HSTS, nosniff, frame-deny,
  Referrer-Policy, Permissions-Policy), `serverExternalPackages: ["mongoose"]`,
  AVIF/WebP image formats, opt-in `standalone` output.
- `lib/env.ts`: zod-validated, lazily-evaluated, `server-only` environment
  access.
- `lib/models/db.ts`: globally-cached pooled Mongoose connection plus
  `assertScalar` guard against NoSQL operator injection.
- `.env.example` (names only), hardened `.gitignore`, `CLAUDE.md`, and the
  three tracking docs.

**Decisions and why**

- **Confirmed with the owner:** single Next.js app (no separate Express
  service), Auth.js/NextAuth for admin, guest checkout only in v1.
- **Hosting split — the significant one.** The owner will use Vercel only for
  free frontend testing and host production on **Hostinger**. Everything is
  therefore built host-agnostic: security headers live in `next.config.ts`
  rather than `vercel.json`; scheduled product sync will be a
  `CRON_SECRET`-protected route handler that any scheduler can curl rather than
  Vercel Cron; rate limiting will be MongoDB-backed rather than Vercel KV. The
  `standalone` build output is opt-in behind `BUILD_STANDALONE=1` so the
  Hostinger build emits a self-contained bundle without changing dev or
  preview builds.
- **Env validation is lazy, not module-load.** Validating at import time would
  break `next build` in environments that legitimately lack runtime secrets.
  Validating on first access instead keeps builds green while still failing
  loudly on any request path that actually needs a secret.
- **`autoIndex: false`** on the Mongoose connection — index creation on every
  cold start is a needless per-invocation cost; indexes get synced explicitly.
- **CSP ships with `'unsafe-inline'` on `script-src`.** A nonce forces every
  page dynamic, which would cost the static rendering of the marketing and
  legal pages. Logged as a known issue and scheduled for Phase 9, where it
  becomes nonce + `strict-dynamic` scoped to dynamic routes only.
- **Scaffolding detour:** `create-next-app` rejects `gamesCentral` as a package
  name (npm forbids capitals), so the app was scaffolded to a temp directory
  as `games-central` and moved in. `package.json` name is `games-central`; the
  repo directory keeps its original casing.

**Verified**

- Dependency versions pinned as installed: next 16.3.1, react 19.2.8,
  mongoose 9.9.2, zod 4.4.3. `npm audit` clean (0 vulnerabilities).
- Full Next.js 16 documentation is available offline at
  `node_modules/next/dist/docs/` — a local authority to check alongside
  context7, notably `self-hosting.md` for the Hostinger target.

**Next**

- Phase 1: base layout, header/footer, home page, Section 14 legal + contact
  pages.
- Needed from the owner: MongoDB Atlas connection string, logo files
  (PNG/SVG with transparency preferred over the current JPGs), and the real
  office address + phone number for the Contact page (PayFast verifies these —
  placeholders will fail review).

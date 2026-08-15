# Project Progress

Reverse-chronological log. Newest entry on top. Every feature, fix, or
milestone gets an entry — see `CLAUDE.md` for why this is part of "done".

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

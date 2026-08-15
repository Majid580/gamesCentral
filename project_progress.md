# Project Progress

Reverse-chronological log. Newest entry on top. Every feature, fix, or
milestone gets an entry — see `CLAUDE.md` for why this is part of "done".

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

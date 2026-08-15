# Project Progress

Reverse-chronological log. Newest entry on top. Every feature, fix, or
milestone gets an entry — see `CLAUDE.md` for why this is part of "done".

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

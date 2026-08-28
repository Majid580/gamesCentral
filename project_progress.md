# Project Progress

Reverse-chronological log. Newest entry on top. Every feature, fix, or
milestone gets an entry — see `CLAUDE.md` for why this is part of "done".

---

## 2026-08-28 — Region gating: a probe, a baseline, and one wrong assumption corrected

The owner wants players from countries where MLBB recharge costs more than our
listed price turned away politely before payment. The obvious implementation —
map Zone ID to country — **does not exist and must not be built.** MLBB Zone
IDs are server shards assigned at account creation; players from Pakistan,
Indonesia and Brazil sit on the same zones. The "server ID → country"
spreadsheets on forums are guesswork, and here a wrong guess means delivering
at a loss.

**The signal we need is already in a response we call on every checkout.**
`getrole` returns three undocumented fields the production client narrows away:
`zone` (not an echo of what we send), `use`, and `id_change_price_info`. New
read-only probe at `scripts/smileone-region-probe.mts`
(`npm run smileone:region`) prints the payload verbatim for several labelled
accounts and tabulates them side by side. It calls `getrole` and nothing else,
routes every request through `assertEndpointPermitted`, and self-checks that
the `createorder` gate is still shut before it opens a socket.

**Baseline, owner's own account 1638539586/16932:** `zone=1`,
`change_price=1`, `use=c`, 11 entries in `id_change_price_info`, all `1` except
product 25 at `1.0043`.

**`change_price` is a multiplier, not a price — CLAUDE.md is misleading on
this.** It reads as "the source of truth for the final charge over the cached
product-list price", which invites Phase 6 to *substitute* it. The live value
is `1`, and no diamond pack costs 1 BRL. Both `change_price` and the
`id_change_price_info` entries are scaling factors. Phase 6 must multiply.
Substituting would charge one rupee-equivalent for every pack in the shop.

That correction is also the answer to the original question, and a better one
than a country list: the multiplier measures *our actual cost for this specific
account*, in supplier currency, per product. A margin floor built on it needs no
lookup table, cannot go stale when SmileOne re-prices, and fails in the safe
direction. A country allowlist can only ever approximate it — so it becomes the
second layer, not the first.

**Blocked on ground truth.** One account is a baseline, not a finding. The
region signal only appears as a *difference* between accounts whose country we
already know. Needs real Player IDs from the owner's WhatsApp order history,
labelled by country — a few Pakistani, a few from each country to be excluded.

**The gate itself, built the same day — then rebuilt when the data arrived.**
Owner named the excluded countries: Philippines, Russia, Malaysia, Indonesia,
Singapore. Hard refusal, not re-pricing. The first version had a cost gate plus
a deliberately empty zone→country table, on the reasoning that an empty table
refuses nobody where a guessed one refuses the wrong people.

**Then the owner supplied a real Philippine account, and the empty table turned
out to be the right answer for a better reason than the one I had.** Probing
302375851/3596 beside the owner's own account returned HTTP 200 with status
`201` and, verbatim:

> According to the request of the mlbb team, we do not support recharge for
> users in Indonesia, Malaysia, the Philippines, Singapore, and Russia for the
> time being.

**Exactly the five countries the owner named.** SmileOne already enforces this
policy itself, sourced from Moonton, at `getrole`, read-only, before a rupee
moves. There is nothing for us to detect. The zone→country table was deleted
rather than filled in, and `SUPPLIER_BLOCKED_COUNTRIES` now exists purely as
documentation with an explicit note not to enforce it — a local copy would need
a mapping that does not exist and would go stale the day Moonton revises the
list, which "for the time being" says outright will happen. The status code is
the stable part; the country names in the message are not.

**This was previously surfacing as a 503.** `unwrapEnvelope` throws on any
non-200 upstream status, and 201 fell through to the generic handler, so a
Philippine customer was told "we can't reach the game servers right now, try
again shortly" — untrue, and cruel against a permanent no. Status 201 now maps
to `SmileOneRegionBlockedError` → `RegionNotServedError` → a 403 with a polite
message and no field flagged, because the customer has made no mistake. The
upstream wording is logged, never forwarded (rule 7).

**The cost gate survives as a separate, non-duplicate concern.**
`lib/services/region-policy.ts` catches the account SmileOne *will* serve but at
a multiplier above what our catalogue assumes (`> 1.05`). Honest caveat: no
account has ever come back above 1.0043, so its refusal branch has only been
exercised by the seven logic checks, never in the field.

**Verified end to end**, not just in unit logic: through the running app,
`ml-dia-86` with the Pakistani account returns 200 and `proplayer123`; the
Philippine account returns 403 and the refusal message renders in the checkout
form with neither input marked as an error.

**Known gap, recorded not hidden.** The gate is bypassable by POSTing straight
to `/api/checkout/create-order`, which takes `confirmedUsername` from the
request body and never re-verifies. Harmless today — nothing can be delivered
while the `createorder` gate is shut — but it must close before Phase 6. The
fix is to re-run `verifyGameAccount` inside `createPendingOrder`, which would
also stop rule 1 leaking in through a client-supplied username. Not done
unilaterally: it makes order creation depend on SmileOne being reachable, so
supplier downtime would block sales rather than just delay delivery. The owner
decides that trade.

**The bypass is closed, on the owner's go-ahead.** `createPendingOrder` now
re-runs `verifyGameAccount` before writing the order, so the region block and
getrole's mistyped-ID safety net cannot be skipped by posting straight to
`/api/checkout/create-order`. `confirmedUsername` and `supplierChangePrice` are
no longer taken from the request body — the order records the server's own
lookup. The client still sends the username it showed the customer, used only
to log a disagreement. A mismatch does not refuse the sale: the Player ID is
identical in both lookups, so the destination cannot have moved, and a rename
is not worth losing an order over.

The accepted cost, agreed rather than slipped in: **order creation now depends
on SmileOne being reachable.** Supplier downtime blocks new sales instead of
merely delaying delivery. `orderCreateRules` also consumes the shared
`lookup:global` bucket now, because order creation reaches the merchant account
too and both of its own rules are keyed on values the caller controls.

**A second not-found code, unhandled all along.** Probing a bogus Player ID
returned `{"status":20004,"message":"USER ID não existe"}` — distinct from the
20003 the code knew about. It fell through to the generic failure path, so a
mistyped Player ID has been telling customers *"we can't reach the game
servers, try again shortly"*: a permanent no dressed up as a transient outage,
which they would have retried indefinitely. Both codes now map to
`AccountNotFoundError`.

**And a wrong turn worth recording.** 20004's message names the USER ID, so the
error was narrowed to flag only the Player ID field — better UX, apparently.
Testing it against the owner's own *valid* Player ID with a wrong Zone ID
returned 20004 as well. The "improvement" would have told a customer whose
Player ID was perfect to go and re-check their Player ID. Reverted the same
day; both fields stay flagged, and the reasoning is now a comment beside the
constant so nobody re-derives it.

**Verified end to end** against the live supplier through the running app: the
Philippine account is refused at *both* endpoints, a bogus Player ID returns
404 naming both fields, the valid account still returns its username, the
per-IP order limiter fires on the fifth attempt, and the database holds zero
orders for either test Player ID — every refusal happened before anything was
written.

**Next**

- No further region work. The country question is answered and closed; do not
  reopen it by building a zone lookup.
- Phase 5 (PayFast) remains the only thing blocking go-live.

## 2026-08-20 — The palette is the logo: navy and azure, measured

The owner supplied two brand marks — navy "GAMES" with an azure "CENTRAL"
script over a pale infinity ribbon (light), and the same lockup in white and
steel-blue on navy (dark). The site was still wearing the Phase 1 palette: deep
indigo canvas, neon purple primary, a fuchsia/rose dispersion ramp. The logo
and the site were two unrelated identities sharing a header.

**Four literals, then everything else derived.** `--brand-navy`, `--brand-azure`,
`--brand-ice` and `--brand-steel` are declared once as the actual logo colours,
and every other token is tuned around them. The point is not tidiness: it is
that a future colour change has one obvious place to start, and the site cannot
drift away from the mark sitting in its header.

**The logo's own azure is unreadable, and had to stay that way.** `#1ca9e8`
measures 2.66:1 against white. It cannot carry text, and it cannot hold white
text on a button — a "Pay now" button in the exact colour of the wordmark fails
AA outright. `--primary` is therefore that same hue darkened to `#0b6ea6` in
light and lifted to `#38b6f0` in dark, while the vivid original survives
untouched in the glows, the page mesh, and the marks themselves, where contrast
requirements do not apply. This is the most important thing to understand
before editing the palette: the brand colour and the primary token are
deliberately not the same value.

**Roles held; one changed.** Blue is brand and navigation, green is money and
only money, and the third role — emphasis — moved from rose to gold. Rose next
to azure reads as a clash rather than a signal, and gold is the classic
complement to navy. The side effect is the useful part: gold is now the *only*
warm colour anywhere on the site, so a single "Most popular" pill on a page of
blue is impossible to miss without any extra weight or size.

**The dispersion ramp narrowed.** It ran cyan -> indigo -> fuchsia -> rose,
half of which now fought the logo. It now walks the cool arc the logo occupies:
cyan `#0d6d87`, brand blue `#0b63b8`, indigo `#4f46e5`, violet `#7331d8` —
roughly 193deg to 272deg of hue. That is still enough separation for a 26-card
grid to read as four families, while every card is visibly a sibling of the
mark. Green and gold stay excluded from the ramp, so seeing either one anywhere
still means "money" or "look here", never "decoration".

**Contrast was measured before the colours were chosen, not after.** Picking
values by eye and auditing later means shipping the failure and finding it in
review. `npm run design:contrast` (`scripts/contrast-check.mts`) parses
`app/globals.css` rather than restating the palette — a second copy would drift
within a week, and a contrast check measuring the wrong colours is worse than
no check at all — and measures 33 pairs per theme, including every spectrum
stop against its own 14% tint chip, which is the tightest surface any of them
lands on. Three candidate stops (`#0e7490`, `#0b6fa8`, `#7c3aed`) measured
4.16, 4.22 and 4.33 there and were rejected in favour of darker values.

**Then it was verified in a browser, which found two real bugs.** Token-level
arithmetic does not prove what a page renders, so every text element on the
live site was measured against its true composited background: 201 elements in
dark, 196 in light, across the home page, `/track`, `/checkout/[sku]` and the
admin login. Zero failures; the tightest real pair is 4.71:1 against a 4.5
floor.

One run reported 13 light-mode failures that turned out to be the harness's
fault, and the trap is worth recording because it is easy to fall into again:
flipping `data-theme` directly from the console bypasses the `.theme-switching`
class, so every element carrying `transition-colors` kept painting the previous
theme's value — exactly the sticky-transition bug already documented in
`globals.css`. Re-testing through the real toggle, and through a pinned reload,
gave zero.

**Brand assets are wired, with placeholders standing in.** `components/brand/logo.tsx`
now renders `public/brand/logo-light.svg` and `logo-dark.svg`. Which one shows
is decided entirely in CSS, keyed off the same three theme states the palette
uses. That is not a style preference: the theme is applied by an inline script
before hydration, so reading it in React would put the wrong logo in the server
HTML and swap it afterwards — a logo that visibly flickers on load, on a site
that asks strangers for money. Both files are `unoptimized`, because
`/_next/image` refuses SVG unless the whole app opts into `dangerouslyAllowSVG`,
which would let any future remote SVG execute script.

Two defects surfaced from measuring the rendered DOM rather than trusting the
markup:

- The footer's wrapper was a plain `grid` and stretched to a **536px-wide
  invisible box** sitting over the column beside it. Now `inline-grid`.
- The accessible name was on the light `<img>`. The inactive mark is
  `visibility: hidden`, which removes it from the accessibility tree — so in
  dark mode the footer logo had **no accessible name at all**. The name now
  lives on the wrapper with both images marked decorative, which is stable
  whichever theme is active.

`npm run brand:check` (`scripts/brand-check.mts`) guards the handover. It fails
on a missing `viewBox`, and on a light/dark aspect-ratio mismatch — the failure
that would otherwise ship silently, because unequal marks make the header
change width every time a visitor toggles the theme. It warns about a baked-in
background rectangle, and about an embedded `<image>`, which means the file is
a traced JPG rather than true vector.

The two SVGs currently in `public/brand/` are stand-ins drawn to the right
proportions, so nothing renders broken in the meantime. `--dark-background`
(`#0a1a2e`) is deliberately set close to the dark mark's own navy field, so
that if the owner's export keeps its background rectangle, that rectangle sinks
into the page instead of reading as a navy box floating in the header.

**Also changed.** `app/icon.svg` added as the favicon via the Next file
convention — it ships its own navy field rather than a transparent mark,
because a browser tab strip can be light or dark and the page has no say in
which. The `themeColor` meta and `ThemeToggle`'s `THEME_COLOR` map moved to the
new canvases. The transactional email palette was re-tinted to match; it keeps
hardcoded hex because email clients cannot resolve CSS variables.

**Verified**

- `npx tsc --noEmit` clean, `npx eslint` clean, `npm run build` succeeds with
  `/icon.svg` registered as a static route.
- `npm run design:contrast` — 66 pairs across both themes, zero below AA.
- `npm run brand:check` — both marks usable, aspect ratios agree to 0.0%.
- Live DOM sweep in both themes across four pages — zero failures.
- Theme toggle exercised through the real button: palette, canvas and logo all
  swap together, with no flash and no layout shift.

**Next**

- Owner to paste the real exports over `public/brand/logo-light.svg` and
  `logo-dark.svg` — same names, transparent background, both on one canvas of
  the same aspect ratio — then run `npm run brand:check`. No code change
  needed.
- Unchanged and still the only thing blocking go-live: PayFast merchant
  credentials.

---

## 2026-08-18 — The deploy that never built: a peer conflict the lockfile hid

Eight Vercel deployments in a row failed, and none of them reached the
application. They died in `npm install`:

```
npm error ERESOLVE could not resolve
npm error While resolving: next-auth@5.0.0-beta.32
npm error Found: nodemailer@9.0.5
npm error Could not resolve dependency:
npm error peerOptional nodemailer@"^7.0.7 || ^8.0.5" from next-auth@5.0.0-beta.32
Error: Command "npm install" exited with 1
```

**Why local development never saw it.** `node_modules` on the dev machine was
installed at some point with `--legacy-peer-deps` (or `--force`), so a resolved
tree already existed on disk and every later `npm install` was satisfied by it.
A clean checkout has no such tree and re-resolves from the registry, where the
conflict is unavoidable. This was not a Vercel problem in any sense: the same
`npm install --dry-run` fails on the dev machine, and it would have broken the
Hostinger production build the first time that box ran an install.

**What was rejected.** Downgrading to `nodemailer@^8.0.11` satisfies the peer
range and installs cleanly — and reintroduces GHSA-p6gq-j5cr-w38f, a high
severity advisory affecting nodemailer `<=9.0.0` where the message-level `raw`
option bypasses `disableFileAccess`/`disableUrlAccess`, giving arbitrary file
read and SSRF in the delivered message. It is fixed in exactly the 9.0.5 this
project was already on, and `npm audit` went from 0 to 3 high the moment the
downgrade was tried. Buying a green build with a known advisory is the wrong
direction in a codebase that handles money. A committed `.npmrc` carrying
`legacy-peer-deps=true` was rejected too: it would work on both hosts, but it
switches peer resolution off for every dependency added from here on, so the
next genuine conflict arrives silently.

**What shipped** is five lines in `package.json`: an `overrides` entry pinning
next-auth's nodemailer to the root version. The peer is declared
`peerOptional` and belongs to next-auth's Email/magic-link provider, which this
project does not use — admin auth is credentials-only. Nothing in the resolved
tree changes except that npm stops refusing to place it.

**Verified**

- Reproduced and isolated in a pristine directory, no `node_modules`, which is
  precisely what Vercel does: `HEAD`'s `package.json` + lockfile fail with
  ERESOLVE; the same pair carrying the override adds 389 packages and exits 0.
- `npm audit`: 0 vulnerabilities. nodemailer stays at 9.0.5.
- `npm run build`, `npx tsc --noEmit` and `npm run lint` all clean. The only
  call site is `nodemailer.createTransport()` in `lib/services/email/transport.ts`,
  untouched.

**Resolved same day**

The Vercel project variables were all present, correctly targeted at Production
and Preview, and all EMPTY — the shape you get from pasting `.env.example`
(where every value is deliberately blank) instead of `.env.local`. Three
deploys were spent theorising about sensitive-variable semantics and
environment targeting before a temporary diagnostic in `next.config.ts`
settled it by printing key NAMES and set/EMPTY/ABSENT status — never values —
into the build log. Every key read `EMPTY`. Re-set from `.env.local` via
`vercel env add --value --force`, the build prerendered `/` from Atlas and
went green. Lesson worth keeping: `requireEnv` reports an empty string as
"Missing", which reads like an absent variable and sends you looking in the
wrong place. The diagnostic was reverted; it is a good tool to reach for again.

**Deployment is live** at https://games-central-ecs3.vercel.app — production,
gated by Vercel Authentication (Deployment Protection), so only ECS team
members can open it until that setting is changed.

**Previously open, now closed**

- The Vercel project `ecs3/games-central` has `SMILEONE_ALLOW_FULFILMENT` set
  on Production and Preview. Vercel marks it Sensitive, so its value cannot be
  read back through the API. `safety.ts` opens the gate on the exact string
  `"1"`. It must not exist on any environment — see LIVE_ACCOUNT_SAFETY.md.
- `BUILD_STANDALONE` and `SMILEONE_STUB` are also set on Vercel. The first is
  the Hostinger-only build switch; the second throws by design on a production
  build. Both should be absent there.
- MongoDB Atlas Network Access still needs `0.0.0.0/0` — the home page
  prerenders at build time and queries Atlas, and Vercel's build IPs are
  dynamic. The database user credentials remain the real gate.

---

## 2026-08-18 — Email: the order ID reaches the customer, and the queue reaches the owner

Two silences the shop had no answer for. A customer who closed the tab had
their order ID nowhere — and the tracking page cannot help someone who does not
have it. An order landing in `paid_pending_fulfillment` told nobody at all; it
waited until the owner happened to open the dashboard, while someone who had
paid watched nothing arrive.

Both are now emails. Plain SMTP rather than a provider SDK, matching how the
rest of this codebase avoids platform-specific primitives: production is a
self-hosted Node process, and SMTP works from any mailbox. The owner supplied
`gamersretro50@gmail.com`, so that is what ships — moving to a
`@gamescentral.pk` mailbox later is `SMTP_*` plus one line in `site-config.ts`,
not a rewrite.

**Dark until configured, and never fatal**

With `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD` unset every send is skipped and
logged. Confirmed live: ten orders created, ten `[email] not configured —
skipping` lines, ten orders saved and returned 200. That is the whole posture —
the order record is the truth and email is a courtesy on top of it, so nothing
in this feature can fail an order. Every send is fire-and-forget behind a
rejection handler, because an unhandled rejection from a floating promise
terminates a Node process by default, and a bounced email taking down the
server mid-order would invert the priority exactly.

**Four messages**

*Order saved*, sent the moment the order exists — before payment, deliberately.
Waiting for a successful payment would withhold the order ID from precisely the
people most likely to need support. It is written to never read as a receipt:
nothing has been charged at that point and it says so, rather than a cheerful
subject line a customer later quotes back asking where their diamonds are.

*Delivered*, with the restart tip included on purpose — a balance that has not
refreshed yet is the most common "it didn't arrive" message a top-up shop gets,
and answering it before it is asked saves a worried evening and a support
conversation.

*Paid, delivery needs a hand* — the hardest to write and the most important to
send. It admits the problem in the first sentence and states that the money is
accounted for, because silence here is what turns a delayed order into a fraud
accusation.

*Operator alert* to the owner, which may carry internal detail the customer's
copy never does: the reason, the outstanding packs, a link into the admin
screen, and — when a supplier call went out and never confirmed — the
instruction to check the SmileOne dashboard before retrying.

Both halves of the paid-but-undelivered case go out from one function, so there
is no path that alerts the operator without reassuring the customer or the
reverse.

**Public order creation is now rate limited, and had to be**

Checking the wiring surfaced this: `createOrder` had no limit. That was
tolerable when abusing it wrote database rows. The moment it sends mail, that
unauthenticated endpoint becomes a way to make our server bomb any inbox the
caller names — with our domain's reputation attached, and a fast route onto a
spam blocklist that would then eat the receipts real customers depend on.

Two rules. Six per IP per ten minutes bounds volume. Four per **recipient
address** per hour is the one that protects a third party, because per-IP does
nothing against a distributed attempt and `x-forwarded-for` is spoofable
anyway. Verified both: four requests for one address succeeded and the fifth
was refused **across six different spoofed IPs**, and eight requests from one
IP with eight different addresses cut off at six.

The recipient rule keys on a SHA-256 prefix rather than the address. These keys
are written to the database on every allowed request, and a plaintext list of
customer email addresses sitting in a rate-limit collection would be a second,
unnecessary copy of personal data to protect.

**nodemailer 9, not 8**

`npm install nodemailer` resolved to 8.0.11, which carries a high-severity
advisory (`GHSA-p6gq-j5cr-w38f`) — and `@auth/core` depends on nodemailer too,
so the whole tree was flagged. We never use the `raw` option the advisory
concerns, but a payments codebase with a dirty `npm audit` is a codebase where
the next real advisory gets ignored. Installing 9 directly deduped and cleared
`@auth/core` as well: **0 vulnerabilities.**

**`npm run email:preview`**

Renders all four messages to `.email-preview/` (gitignored) from the same
functions the app uses, so what is reviewed is what customers receive rather
than an approximation. `--send` mails them to `ADMIN_EMAIL` and nowhere else —
there is no way to point it at an arbitrary address, because a preview tool
that can mail strangers is a spam tool.

It also asserts escaping rather than leaving it to the eye. These bodies are
built by string concatenation with no React involved, and they interpolate an
in-game username chosen by a stranger; the sample data uses
`Ali's <Squad> "Legend"` and the script fails if that reaches the HTML unescaped.

The email modules use relative imports, matching `lib/fulfilment-plan.ts` and
the models and for the same reason — Node does not resolve the `@/` alias, and
the preview has to load the real templates or it is reviewing a copy that can
drift.

**Verified**

`tsc`, `lint`, `build`, `npm audit` all clean. Ten orders created with email
unconfigured, all saved, all skipped cleanly. Both rate limits confirmed by
request, including the spoofed-IP case. The fulfilment drill still passes in
gated mode — the notification hooks did not disturb it.

Nothing was delivered. `createorder` has still never been called.

---

## 2026-08-18 — Security pass on the new surface, and a CSP that would have blocked every payment

`CLAUDE.md` says to run a security review after anything touching money or
auth. The previous entry touched all of it, so this is that pass. Four findings,
one of which was waiting to break the shop on its first real payment.

**The CSP would have blocked the PayFast handoff. Silently.**

`form-action 'self'` — with a comment claiming it was "intentionally broad
enough for the PayFast redirect handoff". It was not. `submitToGateway()`
builds a real form and POSTs it cross-origin to PayFast, and `'self'` makes the
browser refuse to submit. The customer clicks Pay, nothing happens, and the
only explanation is a line in a console nobody has open.

This is the worst kind of bug to meet live: it appears the moment real
credentials arrive, it looks like a PayFast problem rather than ours, and the
obvious debugging instinct — checking the request in the network tab — shows no
request at all.

`form-action` now lists both PayFast hosts, mirroring `BASE_URLS` in the
client. Both are listed rather than switching on `PAYFAST_MODE`, because the
header is baked at build time while the mode is read at runtime, so deriving it
from the mode would let a sandbox build block a production payment. It also
picks up `PAYFAST_API_BASE_URL`, so the single env change that corrects the
host when PayFast confirms it now corrects the CSP too. Verified both ways: the
header carries the two known hosts, and adding an override put a third origin in
it. **That override is read at build time, so changing the host on a running
server needs a rebuild** — noted next to the variable in `.env.example`, because
the failure mode is exactly the silent one above.

**A sweep could run for fifty minutes**

25 orders per run × up to 10 supplier calls each × a 12-second timeout. That
upper bound sits inside a single HTTP request, well past any reverse proxy's
patience — and a proxy that gives up kills the process mid-delivery, which is
the precise situation the sweeper exists to clean up. It would have been a
recovery mechanism that manufactures the thing it recovers from.

There is now a 60-second budget, checked *between* orders and never mid-order:
abandoning an order halfway through its packs to save a few seconds would be
self-defeating. Orders it does not reach are still `paid`, still past their
grace period, and first in line next run. The report says how many were
deferred.

**One bad order took the whole batch down with it**

Any throw inside the sweep loop — an Atlas blip, a document that fails
validation — aborted the run and left every paid order behind it waiting. Each
order is now isolated in its own try/catch and counted as `errored`; it keeps
its status, so it is a candidate again next run rather than being skipped
forever.

**Two smaller ones**

`clientIp()` returned the `x-forwarded-for` value unbounded, and every allowed
request writes it into the database as part of a rate-limit key. Node accepts
16KB of headers, so each request could store kilobytes of an attacker's
choosing on an indexed field — filling a collection using the very mechanism
meant to limit them. Truncated to 45 characters, which is the length of the
longest real IPv6 address, so no genuine client is affected and two clients that
differ only past it share a bucket. Sharing is the correct failure here: a
shared bucket is more restrictive, never less.

The cron secret comparison returned early on a length mismatch — the standard
way to keep `timingSafeEqual` from throwing, and quietly a length oracle. Both
sides are now hashed to a fixed 32 bytes first, so every comparison is the same
size whatever was presented.

**Checked and deliberately left alone**

The `?from=` parameter on the admin login redirect is already guarded against
becoming an open redirect (`startsWith("/admin")` plus an explicit `//`
rejection) — worth recording so the next reviewer does not re-derive it.

`script-src 'unsafe-inline'` **stays**, and this is now a decision rather than a
deferral. The only `dangerouslySetInnerHTML` in the codebase is the pre-paint
theme script, whose content is a compile-time constant; React escapes
everything else, so there is no injection sink for a nonce to defend. A nonce
must be generated per request, and the inline script lives in the shared root
layout — which means adopting one forces the marketing and legal pages dynamic
and gives up their static rendering. That is a real, measured cost against a
hypothetical benefit. Revisit if a genuine HTML sink is ever introduced; the
note in `next.config.ts` says so.

**Verified**

`npx tsc --noEmit`, `npm run lint`, `npm run build` clean. The fulfilment drill
still passes in gated mode, all 8 checks. Cron auth still answers 404 for a
missing secret, a wrong secret of the same length, and a short one, and 200 for
the real one. CSP header confirmed by request, with and without an override.

Nothing was delivered. `createorder` has still never been called.

---

## 2026-08-18 — Everything that does not need PayFast: delivery, tracking, and an honest double-diamonds claim

PayFast is waiting on the merchant account, so this session took the rest of
the shop as far as it goes without them. Two things were genuinely missing —
the code that delivers a paid order, and the page a customer uses to check one —
and both are now built and exercised end to end.

**The delivery executor, written but not able to deliver**

`lib/services/fulfilment.ts` walks a paid order's plan and buys the outstanding
packs. It cannot deliver anything today and that is not an accident: it calls
`createSupplierOrder`, which goes through the gate in `smileone/safety.ts`, which
blocks `createorder` before a socket opens. Writing it now rather than on the
day payments go live means the money path gets reviewed calmly instead of under
pressure.

Three properties it is arranged around:

*Only paid orders.* The claim is an atomic conditional update on `paid` —
`paid_pending_fulfillment` too, but only for an explicit retry. There is no
argument that skips it.

*Never buy the same pack twice.* SmileOne's `createorder` has nowhere to put a
reference of ours, so calling it twice buys twice, and "1050 Diamonds" is three
separate purchases. Each call that lands is recorded on its own, and a retry
subtracts what landed rather than replaying the plan.

*Never guess about a call whose outcome is unknown.* This is the one that needed
a new field.

**`fulfilmentInFlight`, and why a paid order sometimes refuses to be retried**

Between a request reaching SmileOne and our record of it being written, there is
a window where the diamonds are gone and we do not know it. A process that dies
in that window leaves a delivery nobody can account for. Retrying blind buys the
pack a second time at the owner's expense; assuming it worked shorts the
customer. Both are wrong, and no amount of care in the code makes the third
option appear.

So the marker goes down *before* the request goes out and is cleared with the
delivery record. A run that finds it set stops, moves the order to
`paid_pending_fulfillment` naming the pack, and tells an operator to check the
SmileOne dashboard — the only place that actually knows. The admin screen shows
that state as a red panel and **withholds the retry button entirely**, rather
than offering one and hoping.

The distinction that makes this bearable is which failures prove nothing was
delivered. Exactly two do: the safety gate refusing (never dispatched) and the
supplier answering HTTP 200 with an application-level failure status — a
structured "no" from the party that would have done the delivering, which is
where insufficient balance lands. Those clear the marker and the order is freely
retryable. A timeout, a dropped connection, an HTTP 500, or a 200 we could not
parse do not, because every one of them can happen *after* a successful
delivery.

**The sweeper, because the request that was going to deliver can go away**

Delivery starts in the process that verified the payment, and is deliberately
not awaited — a ten-pack combo is ten sequential supplier calls, and holding the
response open for that is a page that hangs at the exact moment a customer is
most anxious about their money. Nothing is lost if that process dies: the order
keeps its progress, and `POST /api/cron/fulfil-orders` picks it up.

A plain `CRON_SECRET`-authenticated route, not a platform cron primitive, because
production is Hostinger. It answers **404** — not 401 — when the secret is
missing, wrong, or shorter than 32 characters, so an unset variable can never
leave the endpoint open and a prober cannot tell the route exists.

It takes `paid` orders older than two minutes (the in-process trigger gets first
refusal) and releases `fulfilling` orders stalled past fifteen. It deliberately
does **not** retry `paid_pending_fulfillment`: an order is there because
something went wrong, the reason is usually still true, and an automatic loop
would send the same doomed call every five minutes. A person presses the button.

**`npm run fulfilment:drill` — proof, not assertion**

The properties worth proving are all about what happens across processes and
retries, so mocking them in isolation would test the mock. The drill drives the
real route, the real service and the real database, and asserts against both
configurations the shop actually has:

- **gated** (today): a paid order is not delivered, lands in the admin queue
  with an operator instruction, and leaves no call in flight. 8 checks pass.
- **stub** (`SMILEONE_FULFILMENT_STUB=1`): full delivery, idempotent re-sweep,
  a half-delivered order resuming at the right pack, and every refusal path.
  16 checks pass.

It aborts if it ever sees a delivery whose supplier order id is not prefixed
`STUB-`, so a drill against a real-delivery configuration stops instead of
buying 26 packs of diamonds.

Two branches it cannot set up on its own were verified by hand, because they
need the server's own environment changed. With the stub told to fail on the
third of three calls:

- `unknown` — 2 packs delivered, marker retained naming pack 23, status
  `paid_pending_fulfillment`, note reading *"…did not report back… Check the
  SmileOne dashboard before retrying."* A second sweep left it untouched.
- `refused` — same 2 packs, marker **cleared**, note reading *"Nothing was
  delivered for it. Safe to retry once the cause is known."*

The two failure classes behave differently, which is the entire point.

**Phase 7: order tracking that works the way people actually type**

`/track` is a real lookup now. It requires the order ID *and* a matching contact
detail — the ID alone would be an IDOR, and it is precisely the sort of string
that gets forwarded over WhatsApp. "No such order" and "wrong contact" return
the identical message, so the ID cannot be used as an oracle for which orders
exist.

The customer never sees our status names. `paid_pending_fulfillment` is a good
name for an operator and a frightening piece of jargon for the person who paid,
so the controller maps every status to a six-word customer vocabulary and the
browser gets nothing else — which also keeps our state machine off the wire.

Two normalisations, both fixing the same failure: a customer who cannot find
their own order contacts support, which is the manual workflow this site exists
to replace.

- Order IDs are matched loosely: `gc65tcgwgwen` finds `GC-65TCG-WGWEN`.
- Phone numbers are stored normalised as well as raw. Someone who typed
  `0322 4810876` at checkout and `+923224810876` at lookup is the same person,
  and an exact string comparison said otherwise. The raw value stays for whoever
  reads the order; `contactPhoneNormalised` is what matching uses.

Verified in the browser with both normalisations in play at once, against a
half-delivered fixture — which correctly reported *"706 diamonds have reached
your account so far"* rather than leaving the customer to work it out from the
diamond count in their game.

Rate limits: 20 per IP per 10 minutes, and **10 per order ID per hour**. The
second one is the rule that matters — order IDs travel, so the realistic attack
is holding one and guessing the contact detail, and counting against the ID caps
that no matter how many addresses it comes from. Spoofing `x-forwarded-for`
does not evade it. There is no global rule here on purpose: one attacker must
not be able to stop everyone else from checking their orders.

**The double-diamonds claim, which was not quite true**

Recorded as a go-live blocker and now fixed. We deliver the paid half; the
matching half is Moonton's first-recharge bonus, granted in-game on the first
purchase of that tier. A customer who has already used theirs receives 55
diamonds having read "55 + 55", and `getrole` does not report promo eligibility,
so we cannot detect it or warn them personally.

That leaves saying it plainly, in the three places they decide: the section
blurb, a line under the bonus badge on every double-diamonds card, and a notice
in the checkout summary immediately above the pay button. The checkout notice
renders only for `double_diamonds` — confirmed absent on `ml-dia-1050`.

**Verified**

`npx tsc --noEmit`, `npm run lint`, `npm run build` all clean; 16 routes,
`/api/cron/fulfil-orders` and `/api/orders/lookup` registered. `npm run
catalogue:verify` still 26/26 with all 6 retry cases passing. The drill passes
in both modes. IDOR guard, the identical-message property, NoSQL operator
injection (`{"$ne":null}` rejected by zod before it reaches Mongo), the rate
limit tripping with a truthful `Retry-After: 3581`, and cron auth returning 404
for both a missing and a wrong secret — all confirmed by request.

Every fixture created during testing was deleted by id afterwards. **Nothing was
delivered. `createorder` has still never been called.**

**Where this leaves the shop**

Everything except taking money is now built and exercised. A customer can pick a
package, have their account verified against the real SmileOne API, place an
order, and track it; a paid order would be delivered automatically, retried
safely, swept up if a process died, and put in front of an operator with a
specific instruction when it cannot be. The only missing link is the one the
owner is waiting on.

**Still needs PayFast, and nothing else does**

1. Merchant credentials.
2. The hosted-checkout field guide, to confirm the draft in
   `hosted-checkout.ts`, then `PAYFAST_FIELDS_CONFIRMED=1`.
3. The real API hosts, via `PAYFAST_API_BASE_URL` rather than an edit.

Once payments verify end to end, the last step is the owner lifting the delivery
gate in person — not a TODO, not this document. `LIVE_ACCOUNT_SAFETY.md` is
unchanged and still applies.

---

## 2026-08-16 — Real business details, and legal pages that are done being drafts

PayFast verify the published address and phone during merchant review, and
until now both were `[TODO: …]`. The owner supplied the real ones: Games
Central, +92 322 4810876, Feroz Wattowan, District Nankana Sahib, Punjab.

**The judgement calls, since legal text is not a place to improvise**

The entity is written as *"a sole proprietorship business operating in
Pakistan"* and **no company registration number is claimed**. Inventing one
would be far worse on a legal page than having none, and a sole proprietorship
is the ordinary form for a shop this size. `siteConfig.legal` is the single
place to change it if the business later incorporates.

Jurisdiction is the courts at Nankana Sahib — the owner's own district, rather
than defaulting to Lahore. Record retention is stated as **five years** from
the order date, matching the period Pakistani businesses generally keep
accounting records, and phrased as a definite period because "as long as
necessary" tells a customer nothing and satisfies no reviewer.

**Draft banners removed, deliberately**

Two pages still carried `DraftNotice` banners reading "Draft — needs owner
review". They were honest when written, but they are *customer-facing*, and a
merchant reviewer reading "draft" on a refund policy is being told the site is
unfinished. The content behind them was checked instead:

- Delivery: 1–5 minutes normally, contact us after 30, resolved within 24h.
- Refund: request within 7 days, reviewed within 48h, 5–10 business days to
  reach a statement — already phrased as bank-dependent, so it never needed
  PayFast's internal timeline to be accurate.

All achievable, so the banners went and the commitments stayed. They are
recorded in `project_state.yaml` as promises the owner has not explicitly
confirmed, which is where that belongs — not on the page a customer reads.

The `DraftNotice` component itself is deleted rather than left unused, with a
comment saying where it went.

**One thing that is now a promise we must keep**

`support@gamescentral.pk` is printed on every legal page as the address for
data requests and refunds. The owner did not supply an email, and this is the
natural one for the domain — but **the mailbox has to actually exist**. A
published contact address that bounces is worse than no page at all, and
PayFast may well write to it. Flagged in `site-config.ts` and the tracking
docs.

Also worth stating plainly: the "delivered within 1–5 minutes" promise is only
true once Phase 6 automatic delivery ships. Until then the owner fulfils by
hand from the admin queue, which is exactly the manual SmileOne workflow the
site is replacing — fine at launch scale, but the page is making a promise the
code does not yet keep on its own.

**Verified**

`/contact`, `/terms`, `/privacy`, `/refund` and `/delivery` all render the real
details with zero occurrences of "TODO" or "Draft — needs owner review".
Policy dates bumped to 16 August 2026. Production build passes.

---

## 2026-08-16 — PayFast, built around what is actually known

The owner's arrangement is that PayFast add the payment method at go-live, so
the integration had to be built without credentials. That is workable, but it
forced a real decision about what to do with the parts nobody has documented.

**First: it is not the PayFast you can look up**

Every documentation index — context7 included — returns **PayFast South Africa**
(`payfast.co.za`). Ours is **PayFast Pakistan** (`gopayfast.com`), a different
company with an unrelated API. Code written from the South African docs looks
completely correct and fails against this gateway. Recorded in
`project_state.yaml` and at the top of the client so nobody "fixes" it later.

**Confirmed vs. guessed, kept strictly apart**

The brief confirms three things, and they are the three that matter: the
`/token` exchange, `GET /transaction/basket_id/<id>`, and PKR-only. Those carry
the entire security-critical path. What is *not* confirmed is the hosted
checkout form — the brief says so explicitly — plus the API hosts, which I
initially wrote from memory and then marked honestly rather than leaving them
looking verified.

Everything unconfirmed lives in one function in `hosted-checkout.ts`. That
placement is the point: when the real documentation arrives, the fix is one
edit against one list.

**Why guessing there is survivable, and guessing elsewhere would not be**

Nothing downstream believes that form. Rule 2 means payment is confirmed by
re-fetching the transaction from PayFast using **our own basket id** — which is
our order id, the one identifier we know before the gateway has seen anything.
If a field name is wrong, the gateway rejects the request and the customer
never reaches a payment page: visible, immediate, harmless. There is no path
where a wrong field name turns an unpaid order into a paid one.

The production gate makes that explicit. With `PAYFAST_MODE=production` and
`PAYFAST_FIELDS_CONFIRMED` unset, the app refuses to build a redirect at all.
Sandbox is unrestricted so the flow is testable the moment credentials arrive.

**Fail closed, everywhere**

Since the response shape is unknown, verification can meet something it does
not recognise. The rule throughout is that an unreadable answer means *not
paid*. Success statuses are an allowlist, not a blocklist of failures — a
blocklist treats every unseen status as success, which is exactly backwards for
a vocabulary we have not confirmed. An unparseable amount returns null rather
than 0, because a silently-zero parse compares equal to nothing and unequal to
everything, and either way an unreadable amount must never look like a matching
one.

An amount mismatch is treated as a security event: logged loudly, written to
the order's status history for the admin, and **not settled**. The order stays
in `awaiting_payment` rather than going to `failed`, because money may well
have moved and `failed` would be both a lie and the end of the recovery path.

**Two triggers, neither trusted**

The customer's return and PayFast's webhook both call the same verification
with nothing but an order id. They differ in *when* they fire, never in what
they are believed about — a customer who closes the tab is covered by the
webhook, a webhook that never arrives is covered by the return. Settlement is
an atomic conditional update, so when they race, exactly one wins and the loser
correctly reports success.

That design also answers the webhook signature question: a forged notification
can at most make us ask PayFast about an order we already know, and PayFast's
answer decides. It needs no signature to be safe.

**Verified**

With no credentials configured: `begin` returns 503 with an honest "online
payment isn't live yet, your order is saved", and the order stays `pending`
rather than stranding in `awaiting_payment`. An order forced to
`awaiting_payment` and then settled stayed **`awaiting_payment` with a null
payment reference** — the fail-closed path, logged as
`gateway_unreachable`. Production build passes with all three payment routes
registered.

**Where this leaves the shop**

Once credentials land, a verified payment moves an order to `paid`, where it
appears in the admin dashboard's owed-fulfilment queue with its exact pack list
— which is the owner's existing manual SmileOne workflow, minus the WhatsApp
and the retyping. Automatic delivery is Phase 6 and stays behind the gate.

---

## 2026-08-16 — Rate limiting the account lookup

`/api/checkout/verify-account` is public, unauthenticated, and reaches the
owner's real SmileOne account on every call. It cannot spend money — `getrole`
only reads and `createorder` is blocked — but an unthrottled public endpoint
fronting a partner API is a good way to get the merchant account throttled or
suspended, and that takes the whole shop offline.

**Why not reuse the login limiter**

`LoginAttempt` counts only *failures*, and a successful login clears the
counter — a user who knows their password is not the threat. This is the
opposite: every call counts, success included, because the cost being limited
is the supplier request itself. Same MongoDB TTL pattern, different semantics,
so `RateLimitHit` is its own collection with a namespaced key.

**Two axes, and the second is the one that matters**

12 per IP per 10 minutes is generous for a customer who mistypes a Player ID
once or twice, and useless to a script. But `x-forwarded-for` is client-supplied
and spoofable, so per-IP limiting only stops the unsophisticated case. The
global cap — 60 lookups a minute across everyone — is the real protection,
because the failure being prevented does not care how many machines the flood
came from.

That has a genuine cost: an attacker who trips the global rule makes real
customers wait. Taken deliberately. A minute of "try again shortly" ends by
itself; a suspended merchant account needs a phone call and takes the shop down
for as long as that takes.

**Details worth keeping**

Hits are recorded only when the request is *allowed*. Counting refused calls
would let a client that keeps hammering extend its own lockout indefinitely,
which reads as a broken site rather than a rate limit. `Retry-After` is computed
from the oldest hit in the window rather than guessed, so the number is true.

The limiter runs after schema parsing, not before: malformed bodies never reach
the supplier, so they are not the traffic worth limiting, and rejecting them
cheaply costs an attacker nothing to discover anyway.

This is a counter, not a lock — two simultaneous requests can both read a count
just under the limit and both proceed. Fine: the limit exists to stop sustained
hammering, and being off by one under a race does not change whether the
supplier sees a flood.

**Verified**

15 rapid lookups from the browser: 12 returned `200` with the real username,
the 13th returned `429` with `Retry-After: 581`. That figure stayed identical
across calls 13, 14 and 15 — proof that refused calls are not recorded.

`RateLimitHit` was added to `scripts/db-sync-indexes.mts` in the same change;
its TTL index would otherwise silently not exist, which is the two-step trap
already logged for `LoginAttempt`.

---

## 2026-08-16 — Composition: 26 products out of 16 supplier packs

The owner resolved the catalogue gap, and it was not missing stock. Most of
their products are **combinations** of packs the supplier already sells: "344
Diamonds" is two 172s, "600" is an 86 plus two 257s, "3x Weekly Pass" is the
weekly pass bought three times. One customer order therefore becomes several
`createorder` calls.

**Reading the supplier's numbers**

SmileOne's `spu` encodes `paid&bonus`, not a total: `78&8 Diamond` delivers 86.
Every mapping depends on reading it that way, so `SUPPLIER_PACKS` writes the
resulting total out per pack rather than leaving it implied. Once decoded, 8 of
the 13 diamond SKUs are a single supplier pack, and the other 5 compose:

| Product | Plan | Calls |
| --- | --- | --- |
| 344 | 2× 172 | 2 |
| 514 | 2× 257 | 2 |
| 600 | 1× 86 + 2× 257 | 3 |
| 1050 | 1× 706 + 2× 172 | 3 |
| 1412 | 2× 706 | 2 |

1050 and 1412 were derived rather than given; the owner specified 344, 514 and
600. `706 + 172 + 172` is the only exact way to reach 1050.

**Written down, not solved at runtime**

A subset-sum solver would find these automatically — and would also find a
*different* answer the day the supplier's pack list changes, quietly altering
what a paying customer receives. The mapping is money, so it is a table in
`lib/fulfilment-plan.ts`, reviewable as a diff.

Where two compositions tie, fewest calls wins: 344 as `172 × 2` costs exactly
the same as `86 × 4` but gives an order half as many chances to fail halfway.

**The arithmetic is checked, not trusted**

`npm run catalogue:verify` recomputes every plan against the advertised diamond
count. A `quantity: 2` mistyped as `1` silently halves someone's delivery and
no amount of careful reading catches that reliably. `npm run db:seed` refuses
to run if the check fails, which matters because the seed is the only thing
that writes plans to the database.

**Retrying a half-delivered order**

This is the expensive case. A 3-call order where two land and the third times
out must retry *only the third* — repeat all three and the customer gets 1050
free diamonds at the owner's expense. `remainingCalls()` subtracts what
actually landed, matching by pack rather than by position (the supplier tells
us which product a call bought, not which line of our plan it was for). Six
cases cover it, including "more delivered than planned", which clamps to zero
rather than returning a negative that reads as "one more".

Orders snapshot their plan at purchase, like `pricing` already did — an order
delivers what was agreed when the customer paid, not what the catalogue says
later. Each successful call is appended to `fulfilmentDeliveries`, which is
what makes the retry arithmetic possible and lets an operator see exactly what
a customer did and did not receive.

**The last six, resolved by the owner's own prices**

Four Double Diamonds and two combos had no exact supplier pack — the flat packs
are 55/165/275/565 against catalogue amounts of 50/150/250/500, and nothing
delivers exactly 150 or 50. Rather than round and hope, `createPendingOrder`
returned 409 for them (verified live: `ml-dbl-250` declined before an order row
existed) and the question went to the owner.

Their rule: use the pack if it exists, otherwise find a combination matching
**price and diamonds**. The price half turned out to be decisive. Dividing each
catalogue price by its supplier cost gives a near-constant rate:

| Product | Supplier cost | PKR per BRL |
| --- | --- | --- |
| 86 diamonds — 380 PKR | 6.25 | 60.8 |
| 1050 diamonds — 4,500 PKR | 75.00 | 60.0 |
| 9288 diamonds — 37,700 PKR | 625.00 | 60.3 |
| 1 Pass + 150 dia — 1,150 PKR | 8.00 + **11.99** (165 pack) | 57.5 |
| 2 Pass + 50 dia — 1,150 PKR | 16.00 + **4.00** (55 pack) | 57.5 |

The whole catalogue was priced off these exact packs at roughly 60 PKR per BRL.
Both combos were priced from the 165 and 55 packs — independent confirmation of
the mapping the owner chose. The same test picks the flat packs for the Double
Diamonds: 250 PKR ÷ 60 is 4.17 BRL, and the 55 pack costs 4.00.

The flat packs are also the only ones whose `spu` carries no `&bonus`, which is
the tell: they are the tiers the game's first-recharge promotion doubles.
SmileOne delivers the single amount; Moonton grants the match. That is why
`expectedSupplierDiamonds()` targets only `diamondAmount` for this kind — using
the doubled figure would have made every such plan look wrong.

**Renamed to what is actually delivered**

50/150/250/500 became 55/165/275/565, and the two combos became "1 Pass + 165
Diamonds" and "2 Passes + 55 Diamonds" (owner's decision). Advertising 150 while
delivering 165 is a promise that does not match the delivery. SKUs are
unchanged — the seed upserts on `sku`, so renaming one would create a second
product and orphan any order referencing the first. Prices are untouched; they
are the owner's to set.

All 26 products now sell. Verified live: `ml-dbl-250` and
`ml-combo-2pass-50dia` both create orders, and the combo's order carries
`[{16642, ×2}, {22590, ×1}]`.

**Two things this broke, both instructive**

The unique index on `smileOneProductId` had to go. It encoded "one product =
one supplier SKU", which composition falsified: 172 and 344 both start from
pack 23, and the seed died on a duplicate key. `fulfilmentPlan` is the real
mapping now, and its correctness constraint is arithmetic, not an index.

And the first test order saved **without** its plan. `defineModel()` reuses the
model registered on the mongoose singleton, that cached model keeps its
original schema across a hot reload, and Mongoose silently strips fields it
does not know about — a successful write, a document missing the field, no
error anywhere. Restart the dev server after a schema change. Noted in
`define-model.ts` where someone will actually hit it.

**One thing to watch before go-live**

The Double Diamond cards state "pay for 55 diamonds and receive 110 in total"
as a fact, but the second 55 is Moonton's promotion, not ours. A customer who
already used their double on that tier gets 55 and will believe they were
short-changed — and `getrole` does not report promo eligibility, so we cannot
warn them beforehand. Not introduced here (the old 50+50 naming made the same
claim), but now understood well enough to name. The wording should say so.

**Verified**

`GC-PN669-J3JU9` (1050 Diamonds) carries `[{26, ×1}, {23, ×2}]` and an empty
delivery list, read back from Atlas. 26 fulfillable, 0 unmapped, 0 broken, 6/6
retry cases pass.

Nothing was delivered. `createorder` is still blocked in `safety.ts`, and the
executor that would walk `remainingCalls()` is deliberately not written yet —
it belongs with PayFast, which is the owner's stated next priority.

---

## 2026-08-16 — Real player-name lookup, live on the site

The owner supplied a Player ID + Zone ID (`1638539586` / `16932`), `getrole`
returned **`proplayer123`**, and the owner confirmed that is correct. The
account-verification path is now real from the browser all the way to SmileOne.

**What a wrong ID actually looks like**

Two deliberate misses — a nonsense Player ID, and the owner's real Player ID
against a wrong Zone ID — returned byte-identical responses:

```
HTTP 200  {"status":20003,"message":"USER ID ou Zone ID não existe"}
```

Two things follow. First, a failed lookup arrives as **HTTP 200**, so it has to
be detected from the body — `unwrapEnvelope()` now does that, and `getRole()`
maps status `20003` specifically to "no account" while letting every other
non-200 status stay an upstream error. That distinction is the whole point: a
typo and an outage need opposite instructions, and before this the customer got
*"we can't reach the game servers"* for their own typo.

Second, the supplier cannot tell us **which** of the two fields is wrong. So the
controller's error shape changed from `field: string` to `fields: string[]` and
a not-found marks both inputs. Claiming it was the Player ID would send someone
with a mistyped Zone ID looking in the wrong place.

Copy is now: *"No player found for that Player ID and Zone ID. Check both and
try again."* The Portuguese upstream message is never forwarded to the browser
(rule 7) — it stays in the server log.

**Verified in the browser, not just in the script**

| Input | Result |
| --- | --- |
| `999999999999` / `99999` | not-found message, both boxes red, `aria-invalid="true"`, API 404 |
| `1638539586` / `16932` | **proplayer123** shown for confirmation, API 200 |

No "Development stub" badge on the success case, which is the proof it was a
real lookup — `SMILEONE_STUB` is empty. Server log shows the two calls:
`POST /api/checkout/verify-account 404` then `200`. Screenshots still time out
(Browser pane never composites on this machine — same known issue as the
unobserved scroll reveal), so this was verified through page text, computed
styles, network records and server logs instead.

**Two findings worth keeping**

`getrole`'s `zone` is not an echo of the Zone ID sent — zone `16932` came back
as `zone: 1`. The UI shows the customer's typed value and must keep doing so.

The response also carries an undocumented `id_change_price_info`: per-product
`{product_id, change_price}` entries, all `1` except product 25 at `1.0043`, so
they read as multipliers rather than prices. Phase 6 has to reconcile that with
the top-level `change_price` before computing any charge. It also lists
`product_id: 20340`, which does not appear in `productlist` — more evidence the
catalogue mapping is unsettled.

**The risk this opens, stated plainly**

`/api/checkout/verify-account` is public, unauthenticated and unthrottled, and
every call now reaches the owner's real SmileOne account. It cannot spend money
— `getrole` only reads, and `createorder` is still blocked in `safety.ts` — but
an unrate-limited public endpoint fronting a partner API is a good way to get
the merchant account throttled or suspended, which would take the storefront
down. The MongoDB TTL pattern already written for admin login applies directly.
Logged as a pre-go-live task, not Phase 9 cleanup.

---

## 2026-08-16 — SmileOne live account connected, read-only, with a hard delivery gate

The owner supplied their **real** SmileOne credentials — a production account
holding real purchased diamonds — with one instruction: verify that the player
name lookup works, and **never** test an actual diamond transfer until PayFast
is finished. Everything below follows from that.

**The blocker is gone, and it was the host all along**

The sandbox host from the brief (`frontsmie.smile.one`) still has no DNS
record. The production host does: `https://www.smile.one` answered **HTTP 200**
to a signed `productlist` call on the first attempt. So the double-MD5 signing
implemented back in Phase 2 is now confirmed correct against the live API —
a wrong signature would have been rejected outright. Phase 2's request *and*
response side are no longer guesses.

**Safety, enforced in code rather than promised in prose**

A written rule that a future session might not read is not a control. Three
layers, so an accidental delivery has to get through all of them:

1. `lib/services/smileone/safety.ts` — a read-only endpoint allowlist
   (`productlist`, `getrole`). `smileOneRequest()` runs every call through
   `assertEndpointPermitted()` *before* the fetch, so `createorder` throws
   without touching the network. The only escape hatch is
   `SMILEONE_ALLOW_FULFILMENT=1`, deliberately absent from `.env.local`.
2. `LIVE_ACCOUNT_SAFETY.md` plus a banner at the very top of `CLAUDE.md`, which
   every session loads automatically. It states plainly that the gate is lifted
   by the owner in person after PayFast is wired — not by a TODO, a phase plan,
   or a previous chat claiming approval.
3. `scripts/smileone-check.mts` (renamed from `smileone-sandbox-check.mts` —
   a file called "sandbox" that hits a live money-spending account is an
   accident waiting to happen) imports the same gate, and *asserts that
   `createorder` is blocked* before it sends anything. If the gate ever stops
   working, the probe aborts instead of proceeding.

**What the live API actually returns**

The envelope is `{status: 200, message: "success", data: …}` — application
failures arrive as HTTP 200 with a non-200 `status`, so `unwrapEnvelope()` now
detects that and throws with the upstream message instead of letting it surface
downstream as an uninformative "shape mismatch". The defensive zod unions
written blind have been narrowed to the confirmed shape.

Products carry two undocumented fields, `cost_price` and `discount`. Both are
ignored: our prices are owner-set retail, not derived (see the pricing
decision).

**The catalogue does not line up, and that is a real problem for Phase 6**

`product=mobilelegends` returns **16** products, all of them Brazil-region
(`"mobilelegends BR 55 Diamond"`, `"Passagem do crepúsculo"`) priced in what
appear to be BRL. The owner's `Catalogue.xlsx` has **26**. Mapping our SKUs
onto supplier product ids cannot be completed against this list, and the region
question has to be settled with the owner before fulfilment is built. Recorded
as a blocker rather than guessed at — mapping a SKU to the wrong supplier id
means delivering the wrong pack to a paying customer.

The `getrole` fallback product id moved from `"212"` (a guess, and not in the
live list) to `"13"` (78&8 Diamond, confirmed present).

**Stub off**

`SMILEONE_STUB` is now empty. `getrole` only reads, so it is safe to run
against the live account, and a fabricated username would hide exactly the
failure this code path exists to catch.

**Not done yet**

The name lookup itself is unrun: it needs a real Player ID + Zone ID, and
inventing one would either return nothing or look up a stranger. Waiting on the
owner for a test account. The not-found response shape is likewise unconfirmed,
so `verifyGameAccount` cannot yet distinguish "wrong Player ID" (which should
tell the customer to check their input) from "supplier is down" (which should
not). Both get answered by the same one test.

---

## 2026-08-15 — Admin login: field clearing, error reporting, signed-out chrome

Owner reported that the login fields kept the previous credentials after
signing in or out. Fixing it turned up two more problems behind it.

**Field clearing (the reported bug)**

Two things refill those boxes, neither of them our code: the browser's password
manager autofills on arrival, and the inputs are uncontrolled, so when React
reuses the same DOM nodes across a client-side navigation the typed values
survive. On a shared terminal in a shop that means the next person sees the
last operator's email and password.

The form is now reset on submit, on mount, and on `pageshow` — the last one
because a mount effect does not run when the browser restores a page from the
back/forward cache. `autoComplete="off"` on the form and `new-password` on the
password field discourage the manager, but browsers do not reliably honour
that on credential fields, which is why the reset exists as well rather than
instead. The submit-time reset runs in `requestAnimationFrame`, after React has
serialised the FormData, so it cannot race the submission.

Tradeoff, stated because it is a real one: autofill is off, so the generated
password gets pasted from a password manager rather than filled.

**Failed logins were silent**

Found while testing the above. The error was being bounced through a
`?error=` redirect that never carried the parameter, so a wrong password
cleared the fields and said nothing at all. Now returned as action state via
`useActionState` — no URL round trip, immediate feedback, and the button shows
a pending state so the form cannot be double-submitted.

**The admin header rendered on the login page**

The real find, and it came from a broken test rather than from looking. The
admin layout wraps `/admin/login` too, so a signed-out visitor saw Dashboard
and Orders links plus a Sign out button — links that bounce straight back to
login, beside a control for ending a session that does not exist. The layout
now renders its chrome only when there is a session.

**Worth recording: the test was wrong before the code was**

Three rounds of "the error still doesn't show" were caused by
`document.querySelector('form')` selecting the sign-out form in that header
rather than the login form. Every conclusion drawn from it was wrong:
`requestSubmit()` looked broken, the action looked like it never ran, and one
"successful login" was a false positive from a session that was already
active. The instrumentation that settled it rendered the action state into the
page, because the server log turned out to be buffered and showed nothing.
Lesson for next time: assert which element is being driven before drawing
conclusions from what it does.

**Verified** (production build, real browser, clicking the actual button)

- Failed login → fields empty, error visible, `pending` observed transitioning
  true → false with the error in state.
- Successful login → navigates to `/admin`, header appears.
- Sign out → back on `/admin/login`, both fields empty, header gone.
- Login page carries exactly one form and no admin nav while signed out.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` clean.

**Note for the owner**

An admin account exists under `your@email.com` — the example command was run
verbatim. Create one with a real address and delete that one.

---

## 2026-08-15 — Phase 8: admin area, auth and order recovery

Auth.js v5 login, dashboard, order search, and manual recovery for orders
stuck at `paid_pending_fulfillment`. This is the screen that exists so a paid
order can never be silently lost.

**Built**

- `auth.ts` (Auth.js v5) with a Credentials provider — the only provider, and
  there is no sign-up path. The only way an AdminUser exists is
  `npm run admin:create` run by hand on the server.
- `proxy.ts` — Next.js 16 renamed Middleware to **Proxy**
  (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`).
- `lib/services/admin-auth.ts` — bcrypt verification and rate limiting.
- `lib/services/admin.ts` — stats, order list/detail, and `transitionOrder`.
- `/admin`, `/admin/login`, `/admin/orders`, `/admin/orders/[orderId]`.
- `LoginAttempt` model with a TTL index.
- `npm run admin:create -- <email> [admin|operator]`.

**Two layers of authorisation, deliberately**

Next.js 16's own Proxy docs say it is **not** an authorisation solution — it
runs before the request completes and should only do cheap optimistic checks.
So `proxy.ts` checks for the *presence* of a session cookie and redirects, and
nothing more. The real check is `requireAdmin()`, which every admin data
function calls before touching the database.

That split is what makes a new admin page safe by construction: it cannot
render customer data without calling a data function, and every data function
has already authorised. A matcher typo in `proxy.ts` would expose a route; it
would not expose any data.

Verified by sending a **forged session cookie**: it passes the proxy's presence
check exactly as designed, then `requireAdmin()` redirects it to the login page
with nothing leaked.

**Decisions and why**

- **bcrypt, not argon2id.** argon2 is the stronger algorithm, but every Node
  binding ships native code and the Hostinger plan type is still undecided. A
  hash that cannot be computed on the production host is worse than a slightly
  weaker one that can. Revisit if the plan turns out to be a VPS.
- **Rate limiting counts email and IP as separate keys.** Email-only lets an
  attacker lock a real admin out of their own dashboard; IP-only lets a botnet
  walk one password list across many addresses. Five failures in fifteen
  minutes blocks either.
- **Stored in MongoDB with a TTL index**, not an edge KV — production is a
  self-hosted Node process, and a rate limiter that needs its own cleanup job
  stops working silently when that job dies.
- **Every login failure renders the same message** and the rate limit is never
  named. Distinguishing "no such account" from "wrong password" turns the form
  into an account-enumeration oracle. `verifyAdminCredentials` also runs a
  bcrypt comparison against a dummy hash when the user does not exist, so a
  miss takes as long as a hit.
- **`admin:create` generates the password and never accepts one as an
  argument.** Shell arguments land in shell history and in the process list,
  which is the wrong place for a credential that can read customer data.
- **Manual transitions go through the same status machine as the code path.**
  An admin picks from `allowedTransitions` only, and `transitionOrder`
  re-checks server-side, so `failed` is unreachable once an order is paid
  (rule 8). The update is an atomic conditional on the current status, so two
  operators clicking at once cannot both apply it (rule 3) — the second is
  told the order changed underneath them.
- **Search input is regex-escaped** before it reaches a Mongo query. An
  unescaped user string is both a ReDoS and a wildcard-match bug.
- **Sessions are JWT and expire in 8 hours.** This session can read customer
  contact details and retry deliveries; an admin laptop left open should not
  stay authorised all week.

**Verified** (production build on a spare port)

- Signed out, `/admin`, `/admin/orders`, and `/admin/orders/[id]` all 307 to
  the login page with the intended destination preserved in `?from=`.
- A forged session cookie reaches `requireAdmin()` and is rejected; no
  dashboard content in the response.
- Wrong password → generic error. Correct password → session issued, redirect
  to `/admin`, both pages render.
- **Rate limit holds under the test that matters**: after five failures the
  *correct* password is also refused.
- Temporary probe admin and all login-attempt rows deleted afterwards; admins
  and orders both back to 0.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` clean; build reports
  `ƒ Proxy (Middleware)`.

**Snags**

- `notFound()` was imported from `next/cache` instead of `next/navigation`.
  It still existed, so the only symptom was fourteen "order is possibly null"
  type errors — the return type was not `never`, so TypeScript never narrowed.
- The new `LoginAttempt` model was invisible to `db:sync-indexes` until it was
  added to that script's model list, so its TTL index silently did not exist.
  Worth remembering: adding a model is two steps, not one.

**Not built yet** — catalogue/price editing from the admin UI. Prices are
owner-set and currently change through `lib/catalogue-source.ts` +
`npm run db:seed`, which is reviewable as a diff. A price editor is worth
having but it edits live money and deserves its own pass.

**Next**

- Phase 7: guest order lookup on `/track` — unblocked.
- Phase 9: security review, now that auth exists alongside the money code.

---

## 2026-08-15 — Phase 4: checkout flow, payment stubbed

Storefront → checkout → order. The selection bar's Continue button is live and
now routes to a real checkout. No money moves yet.

**Built**

- `/checkout/[sku]` — order summary plus a three-stage form. `force-dynamic`,
  because the price shown must be the current one.
- `POST /api/checkout/verify-account` and `POST /api/checkout/create-order` —
  thin handlers over `lib/controllers/checkout.ts`, per the route → controller
  → service → model rule.
- `lib/services/orders.ts` — `createPendingOrder` and `findOrderForGuest`.
- `/order/[orderId]` — post-checkout confirmation.
- Theme-switch transition fix (see the separate commit) shipped alongside.

**Three stages, not one form.** Identify the account, confirm the username,
then pay. The confirmation step is the entire reason the flow is shaped this
way: a mistyped Player ID delivers to a stranger and the money is gone, so the
customer has to see the in-game name and actively accept it. It is never
auto-advanced, and "That's not me — change ID" is always available.

**The `getrole` stub, and why it is shaped the way it is**

The SmileOne sandbox host still does not resolve, so account verification
cannot be performed at all. Without a stub the whole checkout UI would be
unbuildable and untestable. `SMILEONE_STUB=1` returns a deterministic
generated username in development, and a Player ID ending in `0` is treated as
not found so the failure path gets exercised too. The confirmation card shows a
visible "Development stub" warning whenever the name is generated.

The guard **throws** if the flag is set on a production build rather than
falling back quietly — a fabricated username that lets a real customer pay for
delivery to an unchecked account is the worst available outcome. There is
deliberately no `NEXT_PUBLIC_` variant, so nothing the browser sends can turn
it on.

That guard was initially written at module scope, which **broke the build**:
`next build` sets `NODE_ENV=production` and imports every route to collect page
data, so any machine with the stub enabled for local development could not
build. Moved inside the function, so it fires at the point of use. Builds work;
the dangerous combination still cannot be served.

**Decisions and why**

- **`createPendingOrder` has no price parameter.** Not "ignores one" — there
  is nowhere to pass a price. The client sends a SKU; the cost is read from
  our own catalogue document (rule 1). `quotedPricePkr` is accepted only so
  the server can *report* that the price moved mid-checkout instead of quietly
  charging a different amount.
- **`/order/[orderId]` deliberately does not look the order up.** Order IDs
  are shown on screen, forwarded in messages, and sit in browser history, so
  the ID alone must never be enough to read someone's contact details or
  delivery target. `findOrderForGuest` requires a matching email or phone;
  wiring it in is Phase 7.
- **The confirmation page says plainly that no payment was taken.** A page
  that looks like a receipt is the worst possible place to be vague about
  whether money moved.
- **Errors sit next to the field that caused them** and the server returns a
  `field` key so the client can mark the right input. No upstream message or
  endpoint is ever forwarded to the browser (rule 7).

**Two bugs found**

1. **Every order failed validation.** `Order.pricing.basePriceUsdCents` was
   `required`, but under the owner-set pricing model products have no supplier
   base price — it is `null` on all 26. The Order schema still assumed the
   computed-pricing model the catalogue had already moved away from. Made
   nullable.
2. **Schema edits do not reach a running dev server.** `defineModel` returns
   the already-registered model from `globalThis`, which is what makes hot
   reload work — and also means a changed schema is ignored until the process
   restarts. Cost a confusing round of "the fix didn't work" before the fresh
   process proved it had.

**Verified** (against a production build on a spare port, since Next refuses a
second dev server for the same directory)

- **Rule 1 holds under attack.** A client claiming `quotedPricePkr: 1` is
  still charged 115000 paisa and the response flags `priceChanged: true`. A
  client injecting `pricePkr: 1` into the body is also charged 115000 — zod
  strips unknown keys and the service never reads a caller-supplied price.
- **The stub refuses to run in production**: with `SMILEONE_STUB=1` and
  `NODE_ENV=production`, verify-account throws rather than returning a name.
- NoSQL operator injection (`sku: { $ne: null }`) rejected at the zod layer
  with 400 before reaching a query.
- Validation: bad Player ID → 400 with `field`; unknown SKU → 409; bad phone →
  400; stub not-found path → 404.
- Checkout page renders the right summary ("250 paid + 250 free = 500
  diamonds", Rs 1,150).
- Test orders removed afterwards; orders collection back to 0.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` clean.

**Next**

- Phase 5: PayFast hosted checkout — still blocked on merchant credentials.
- Phase 7's order lookup can be built now; `findOrderForGuest` already exists
  with the IDOR guard.

---

## 2026-08-15 — Real catalogue live: 26 products, 3D storefront cards

The owner supplied `Catalogue.xlsx` (OneDrive) with the real Mobile Legends
pricing. Read it, seeded it, and built the storefront on top of it. The
placeholder catalogue is deleted.

**Reading the sheet** — the share link needed a real browser session; the
legacy `api.onedrive.com` shares endpoint now 401s and the file is
SharePoint-backed. Fetched it in-page with the session's own cookies, then
parsed the xlsx **as a ZIP inside the browser** (central directory walk +
`DecompressionStream('deflate-raw')`) to pull just `sheet2.xml` and
`sharedStrings.xml`. The file is 3.2 MB but the actual data is under 20 KB —
the rest is product imagery — so extracting two entries beat piping megabytes
of base64 through the JS bridge. The owner's screenshots then confirmed the
transcription independently.

**Pricing model changed — the significant decision.** The sheet gives **final
retail PKR already including the owner's margin**, so the
`basePriceUsd × exchangeRate × (1 + markup)` pipeline is not used: `pricePkr`
is authoritative and owner-set. The formula stays in `AppConfig` for any
future product priced off a live supplier rate. Rule 1 is untouched — the
price still comes from our database server-side and is never accepted from the
client, and checkout will re-read it rather than trust the rendered value.

**Built**

- `lib/catalogue-source.ts` — the transcription, reviewable as a diff when a
  price changes. Whole rupees in the source, converted to integer paisa
  exactly once at seed time.
- `npm run db:seed` — idempotent upsert on `sku`, so re-running after a rename
  updates in place. Products dropped from the source are **deactivated, never
  deleted**, because orders reference products and history must stay readable.
- Product schema gained `kind` (`diamonds | pass | combo | double_diamonds`),
  `sku`, `tagline`, `bonusDiamonds`, `featured`, and an authoritative
  `pricePkr`. `diamondAmount` became optional — a pass has no diamond count.
- `lib/services/catalogue.ts` — narrows Mongoose documents to exactly the
  fields the UI needs (rule 7).
- `components/store/product-card.tsx` + `catalogue.tsx` — the storefront.
- Home page reads MongoDB; `lib/placeholder-catalogue.ts` and the old
  `package-card.tsx` are gone.

**The card design**

The site's thesis is a cut gem, so a product card is a slab with real
thickness rather than a rectangle with a shadow. Two layers, and which you get
depends on the device:

- **Thickness** — a hard, un-blurred box-shadow in the card's dispersion
  colour under the bottom edge. This is the mobile-first half: a touch screen
  has no hover, so the card must already read as three-dimensional before
  anyone touches it. Pressing sinks it and shortens the slab, like a real key
  travelling.
- **Specular + tilt** — pointer-tracked highlight, gated behind
  `hover: hover and pointer: fine`, because on touch a tilt sticks after a tap
  and reads as broken.

The tilt runs on **one delegated pointermove for the whole grid**, writing CSS
custom properties directly onto the hovered card. Routing that through React
state would re-render 26 cards per frame to move a highlight.

Each kind leads with what actually distinguishes it: diamonds lead with the
count, double-diamond offers lead with the total and state the bonus in words
("Pay for 250, get 250 free") rather than leaving the customer to decode
"250+250", and passes and combos lead with their name because they have no
meaningful number.

**Decisions and why**

- **Cards are `<button aria-pressed>`, not clickable divs.** Choosing a
  package is a toggle: it must be keyboard-reachable and announce its state.
  Each carries one visually-hidden sentence ("86 diamonds, Rs 380") because
  the visual card splits its meaning across a number, a badge, and a footer
  that make no sense read in sequence.
- **Selection bar is anchored to the bottom of the viewport** — the site is
  used mostly on phones, the thumb is already there, and by the time someone
  is ready to continue the chosen card has scrolled away.
- **`Continue` is disabled rather than linked.** Checkout is the next build
  step; a dead-end link would be worse than an honest unavailable state.
- **ISR (`revalidate = 60`) rather than static.** The build initially
  prerendered the catalogue into the HTML, which would freeze prices until the
  next deploy. Per-request rendering would instead hit Atlas on every page
  view and risk the shared-tier connection cap.

**Three real bugs found by measuring, not by looking**

1. **The SRV fix from earlier today was wrong.** `dns.setServers()` only
   repairs the default resolver if it runs before anything else in the process
   touches DNS. That holds in a script; it does not in the Next.js dev server,
   which resolves hostnames during boot — so the home page failed with
   `querySrv ECONNREFUSED` while the process resolvers already read
   `["1.1.1.1","8.8.8.8"]`. Proved a fresh `Resolver` instance pointed at the
   same server returned all three shard records in that same process.
   Replaced with `resolveMongoUri()`, which does the SRV+TXT lookup on a
   private resolver and rewrites the URI to its non-SRV equivalent —
   order-independent and touching no global state. It appends `tls=true`
   because `mongodb+srv://` implies TLS and `mongodb://` does not; dropping it
   would have silently downgraded the connection to plaintext.
2. **`sparse: true` did not do what it looks like it does.** A sparse index
   skips documents where the field is *missing*, but the schema defaults
   `smileOneProductId` to an explicit `null`, so the second unmapped product
   collided on `null`. Needed a partial index keyed on `$type: "string"`.
3. **`transition-colors` held a stale colour across a theme switch.** The
   "Select" label kept the dark theme's `#a5a1bd` on a white card after
   switching to light — 2.49:1 against a 4.5:1 requirement, on all 26 cards.
   A CSS transition captures the computed colour and does not re-run when the
   underlying custom property changes. Removing the transition fixed it; it
   was animating a colour change that accompanies a text change and so
   carried no meaning anyway.

**Verified**

- All 26 products seeded at the owner's exact prices; `db:seed` re-run is
  clean (25 created / 1 updated on the second pass, 0 retired).
- Storefront renders from MongoDB: 26 cards across 4 sections in the correct
  order, real `<button>` elements, accessible names reading "86 diamonds,
  Rs 380".
- **Contrast measured on 112 text elements in both themes: zero failures.**
- Responsive at 375 / 768 / 1440 → 2 / 3 / 4 columns, no page overflow at any
  width. Caught and fixed inner overflow at 375px, where four-digit counts
  (1050+) pushed the "diamonds" unit 10px past the card edge and
  `overflow-hidden` clipped the word.
- Touch: tap selects, sticky bar appears, no target under 44×44px.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` clean; `/` reports
  `Revalidate 1m`.

**Not verified — carrying forward**

The pointer tilt and specular could not be observed: the Browser pane stayed
hidden all session, which means it never composites, so `requestAnimationFrame`
never fires and screenshots time out. The same limitation that left scroll
reveal unobserved. The code path is correct and the CSS computes (the slab
shadow and 3D matrix were both read back), but the motion itself is unwatched.
Confirm in a real browser.

**Open — needs the owner**

- Two catalogue items share PKR 1,150 (`1 Pass + 150 Diamonds` and
  `2 Passes + 50 Diamonds`). Owner has confirmed these are intentionally
  separate products at the same price.
- 344 diamonds costs more per diamond (4.42) than 257 (4.28); same at 514 vs
  600. Mirrors SmileOne's own tier structure, but customers do notice.
- The sheet's "Homepage" tab asks for the product section to be "exactly the
  same as" firushop.com.ar. Built to work the same way in Games Central's own
  visual language rather than reproducing another shop's page.

**Next**

- Checkout flow (Phase 4) — the selection bar is wired and waiting for it.
- Mapping each product to its SmileOne `productid` once the sandbox URL exists.

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

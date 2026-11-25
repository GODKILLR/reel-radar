# Reel Radar by Star Labs

Instagram outlier finder. Users track competitor accounts and the app flags
reels that beat their own account's median views (default 3x). It is a free
lead-magnet tool for Star Labs' audience. Live: https://reel-radar-starlabs.vercel.app
(Vercel project `reel-radar`, auto-deploys on push to `main` of
`GODKILLR/reel-radar`). Database: Postgres on Neon.

Read `docs/HANDOFF.md` for the decisions behind this, the cost maths, current
live state and what is left to do.

## The product model (final - do not drift from it)
- **Everyone brings their own Apify API key.** They paste it on the Accounts
  page; collection runs on THEIR free monthly credit, not ours. No key = they can
  browse Discover and save ideas but cannot track accounts.
- **Plans only set how many accounts a user can track:** Free 10 ($0), Pro 20
  ($1/mo), Ultra 100 ($2/mo). Every plan: latest 100 reels per account, daily
  refresh, unlimited saved ideas. Defined in `src/lib/plans.ts`.
- **No points.** They were removed. `users.points` / `points_ledger` still exist in
  the schema but are unused; never show or charge points.
- **Payments are not connected.** Admins switch plans by hand on `/admin`.
- **Discover** = outliers from accounts an admin marks "Featured" on `/admin`
  (off by default). Those are the only accounts WE pay to collect (plus accounts
  admins track).
- Users must not see cost/vendor detail except on the "connect your key" card
  (which names Apify on purpose). Cost and raw errors live on `/admin` only.

## Collection (the part that is easy to break)
- **Happens on user request**, not on a timer: `POST /api/collect` is called when
  a user adds an account, opens the feed/Accounts page, connects a key, or presses
  "Refresh now" (`runForUser` in `src/lib/poller.ts`). `/api/cron` is only a safety
  net for featured accounts. It is cheap to call: nothing due = zero outside calls.
- **Who pays:** `splitPools` - platform key for featured + admin-tracked accounts;
  every other account on its owner's own key. An account whose owner has no
  working key is collected by NOBODY (never falls onto our bill).
- **Account phases** (`accountPhase`): `new` -> `pending` (first fetch in flight,
  hands off for everyone, 30 min timeout) -> `established`. The first fetch is
  claimed atomically (`claimBackfill`) so two requests never pay for it twice.
- **Two collectors:** cheap default `sones/instagram-posts-scraper-lowcost`
  ($0.0003/post) and `apify/instagram-post-scraper` ("official", $0.0027/post).
  Some accounts' reels come back from the cheap one with NO views; when a run has
  >= 3 reels and none with views, `competitors.views_source` becomes `official`
  and the account is re-collected automatically (`src/lib/views.ts`, webhook).
  Each run stores which collector produced it (`scrape_runs.adapter`).
- **Callbacks:** `POST /api/hooks/scrape?n=<nonce>`; the nonce is single-use per
  run (`scrape_runs.hook_nonce`). Never put a global secret in that URL: for a
  user's run it is stored inside the USER's own Apify account.
- Results are only accepted for the accounts that run was asked to collect.

## Database size (Neon free = 1 GB)
- Stored per reel: no video-file link (never used, expires), caption cut to 300
  chars, only the newest `METRICS_KEEP` snapshots, no views/velocity indexes.
  Per account we keep the newest 100 reels (+20 photos). Saved ideas are never trimmed.
- `src/lib/cleanup.ts` runs about daily (from `/api/cron` and, after the response,
  from `/api/collect`; a `maintenance` row guarantees once a day). Always: trim to
  plan depth, prune snapshots, mark accounts nobody tracks. Only when the DB is
  >= `CLEANUP_AT_PERCENT` full: delete accounts untracked for `ORPHAN_DAYS`
  (never Discover accounts, never one with a saved reel) and drop the tracking of
  users unseen for `INACTIVE_DAYS` (the user, email and saved ideas always stay).
  Below the threshold it only reports. `/admin` shows size and the last run.
- Users' `last_seen_at` is touched at most once a day (`getUser`).

## Security rules (non-negotiable)
- User Apify tokens: AES-256-GCM, bound to the user id, key =
  `KEY_ENCRYPTION_SECRET`; never returned to the browser (only last 4 chars),
  never logged, never in URLs (Bearer header only). Losing that secret makes every
  stored key unreadable.
- Sessions: signed cookie `uid.expires.hmac` (edge middleware only checks the
  signature; route handlers load the real user). Passwords: scrypt.
- Every API route authenticates itself; admin routes return 404 to non-admins.
- Do not push secrets to Vercel from automation: the owner runs that step.

## Layout
- `src/lib/plans.ts` plans; `session.ts` user/limits/`canCollect`; `auth.ts`
  cookies; `password.ts`; `collector.ts` key encryption + credit checks;
  `poller.ts` all collection logic; `apify.ts` collector REST client;
  `actors/` the two collector adapters; `ingest.ts` upsert + outlier scoring;
  `views.ts` missing-views detection; `schema.sql` idempotent schema (+ self-heal).
- `src/app/api/*` routes; `src/app/*/page.tsx` UI; Star Labs theme in `globals.css`.
- `scripts/` CLIs (`migrate`, `make-admin`, `trigger`, checks); `scripts/e2e/` the
  end-to-end harness (read its README).

## Commands (run from this folder)
- `npm run dev`, `npm run build`, `npx tsc --noEmit`
- `npm run authcheck` (unit: auth, passwords, plans, key encryption, pools,
  account phases, missing-views) and `npm run actorcheck` (collector adapters)
- `npm run migrate` - additive, idempotent; ALWAYS run before deploying code that
  needs new columns. `npm run make-admin -- <email> [--claim-legacy]`.
- End-to-end: see `scripts/e2e/README.md` (needs no real keys and never touches
  the live database).

## Deploy
Migrate first, then `git push origin main` (Vercel builds from GitHub). Env var
NAMES live in `.env.example`. After changing an env var in Vercel, redeploy.

## Working rules for this project
- Typecheck + `npm run authcheck` + the e2e suites before saying something works.
- Never test against the live database. Use the e2e harness (embedded Postgres +
  fake collector).
- Windows host: use PowerShell/Bash accordingly; `tsx` scripts with top-level
  `await` must be `.mts`.
- Keep user-facing copy plain: no cost, vendor or token talk outside the key card.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

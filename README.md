# Reel Radar

Reel Radar is a free, open-source tool that finds the Instagram reels beating
their own account's average, so you can spot a working idea while it is still
working.

Built by [Star Labs](https://starlabsstudio.com). Live app:
[reel-radar-starlabs.vercel.app](https://reel-radar-starlabs.vercel.app).
Non-developer setup guide: [starlabsstudio.com/reel-radar](https://starlabsstudio.com/reel-radar/).

It replaces the manual loop of saving each competitor's reel and checking back
later. You add accounts by handle. Reel Radar collects their reels and flags the
outliers.

## What it does

- **Add an account by handle.** Paste `natgeo`, `@natgeo`, or a profile URL. The
  latest reels are collected once, then kept fresh.
- **One feed, all accounts.** Sort by newest, most views, fastest growing,
  biggest outlier, most likes, or best engagement. Filter by account, period,
  reels only, outliers only, or saved.
- **Outlier detection.** A reel is flagged when its views reach a multiple
  (default 3x) of *that account's own median*. Raw view counts only tell you who
  has the most followers. 5x the median means the idea beat the account's own
  baseline.
- **View velocity.** Reels keep a time series of snapshots, so you can see views
  per hour and spot a reel that is climbing today.
- **Watchlist.** Save a reel to a to-recreate board with an
  idea, scripted, filmed, posted status.
- **Discover.** Outliers from accounts an admin has marked "Featured". It works
  without connecting your own key.
- **Alerts (optional).** Telegram and/or email when a tracked account posts a new
  outlier. Each reel alerts once.

## How it works

Everyone brings their own [Apify](https://apify.com) API key. A user signs up
with email and password, then pastes their key on the Accounts page. Reel Radar
verifies it, stores it **encrypted** (AES-256-GCM, bound to the user id, needs
`KEY_ENCRYPTION_SECRET`), and collects that user's accounts on *their own*
monthly free credit. The key is never sent back to the browser, only its last
4 characters. Without a working key a user can browse Discover but cannot track
accounts.

**Plans only set how many accounts a user can track** (defined in
`src/lib/plans.ts`): Free 10, Pro 20, Ultra 100. Every plan shows the latest 100
reels per account with unlimited saved ideas. There is no payment provider
connected. An admin switches plans by hand on `/admin`.

### Collection happens on request

Adding an account, opening the feed, connecting a key, or pressing **Refresh
now** calls `POST /api/collect`. That collects whatever the user's accounts need:
new accounts immediately, stale ones when due, plus a weekly deeper sweep. It is
cheap to call, and when nothing is due it answers without contacting Apify. A
refresh is throttled to once per 15 minutes per user, and a new account's first
fetch is claimed atomically so two requests never pay for it twice.

Apify scrapes take minutes, longer than a serverless function can wait, so the
work is split in two:

```
POST /api/collect  -->  queues an Apify run  -->  returns immediately
                                  |
                  Apify scrapes, then calls back
                                  v
        POST /api/hooks/scrape  -->  upsert posts
                                     write metrics snapshot
                                     recompute outliers + velocity
                                     send alerts
```

- **Who pays.** Featured and admin-tracked accounts run on the platform key.
  Every other account runs on its owner's own key. An account whose owner has no
  working key is collected by nobody and never falls onto the platform bill.
- **Callbacks use single-use tokens.** Each run has its own nonce (`?n=`), never
  a global secret, because the callback URL is visible inside the user's own
  Apify account. Results are accepted only for the accounts that run was asked to
  collect.
- **Two collectors.** The default is the low-cost
  `sones/instagram-posts-scraper-lowcost` (about $0.0003 per post). Some
  accounts come back from it with no view counts. When a run has at least 3 reels
  and none has views, that account switches to `apify/instagram-post-scraper`
  (about $0.0027 per post) and is re-collected automatically.
- **Small database.** Per account it keeps the newest 100 reels (plus 20 photos),
  a caption cut to 300 characters, and only the latest few metric snapshots. A
  daily clean-up keeps a free 1 GB Postgres comfortable.

## Tech stack

Next.js (App Router), React, TypeScript, Tailwind CSS, Postgres (any provider,
[Neon](https://neon.tech) works well), deployed on Vercel.

## Self-hosting

### 1. Postgres

Any Postgres works. Use the **pooled** connection string, since serverless
functions open many short connections.

### 2. Configure

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, `APIFY_TOKEN` (the platform key, used for featured
accounts), `APP_BASE_URL` (your public URL, which Apify calls back to, so it
cannot be localhost), and generate the secrets:

```bash
openssl rand -hex 32   # CRON_SECRET
openssl rand -hex 32   # WEBHOOK_SECRET
openssl rand -hex 32   # KEY_ENCRYPTION_SECRET (back this up: losing it makes
                       # every stored user key unreadable)
```

All other variables are optional tuning knobs with defaults. See `.env.example`.

### 3. Deploy

```bash
npx vercel login
npx vercel link
npm run push-env      # pipes secrets from .env into Vercel without printing them
npx vercel --prod
```

New Vercel projects enable SSO protection, which blocks Apify's callback. Turn it
off under Settings, Deployment Protection, once the app's own sign-in is
deployed.

### 4. Create the tables

```bash
npm run migrate       # additive and safe to re-run
```

### 5. Make yourself admin

Sign up in the app, then:

```bash
npm run make-admin -- you@example.com
```

On `/admin`, switch on the accounts you want to appear in Discover.

### 6. Scheduler (optional)

Collection is on request, so a scheduler is only a safety net for featured
accounts. Vercel's Hobby plan allows cron once a day, and declaring anything more
frequent in `vercel.json` fails the deployment, so scheduling is external. See
[CRON.md](CRON.md).

### Alerts (optional)

**Telegram:** message [@BotFather](https://t.me/botfather), run `/newbot`, and set
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
**Email:** set `RESEND_API_KEY`, `ALERT_EMAIL_TO`, and `ALERT_EMAIL_FROM`
([resend.com](https://resend.com)).

If neither is set, alerts are skipped and everything else still works.

## Local development

```bash
npm install
npm run dev
```

Reads work locally against your `DATABASE_URL`. Apify cannot reach `localhost`
to deliver its callback, so collection does not complete locally. Use
`npm run poll:local` (it does the callback's work itself), or expose the app with
a tunnel such as `npx ngrok http 3000` and set `APP_BASE_URL` to the tunnel URL.

```bash
npm run migrate       # apply the schema
npm run authcheck     # auth and key-handling assertions
npm run actorcheck    # both collector adapters (no database needed)
npm run e2e           # end-to-end suites against an embedded Postgres
npx tsc --noEmit      # type check
```

The end-to-end suites in `scripts/e2e/` use an embedded Postgres and a fake
collector. They never touch real services.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/posts` | GET | feed; `sort`, `competitorId`, `days`, `type`, `outliersOnly`, `watchlistOnly`, `q`, `limit`, `offset` |
| `/api/competitors` | GET, POST | list / add |
| `/api/competitors/[id]` | PATCH, DELETE | pause-resume / remove |
| `/api/watchlist` | POST | save or update status |
| `/api/watchlist/[id]` | DELETE | unsave |
| `/api/collect` | POST | collect for the signed-in user |
| `/api/stats` | GET | summary, last run |
| `/api/cron` | GET, POST | safety-net poll for featured accounts *(secret)* |
| `/api/hooks/scrape` | POST | Apify callback *(single-use nonce)* |

## Known limitations

- **Thumbnails expire.** Instagram CDN URLs are signed and die after some days.
  Older cards fall back to a placeholder, and the post link always works.
- **No follower counts.** Neither collector returns them.
- **Outlier scores need history.** The median uses up to 30 recent mature reels,
  so a new account's scores are unreliable until its first fetch lands. Posts
  under 24 hours old are deliberately left unscored.
- **Views are plays.** `views` is `videoPlayCount`, matching Instagram's UI.
- **Public accounts only.** Private accounts cannot be tracked.
- **No payments or email verification yet.** Plans are switched by hand, and
  signup has no CAPTCHA.

## Contributing

Issues and pull requests are welcome. Please run `npx tsc --noEmit`,
`npm run authcheck`, `npm run actorcheck`, and `npm run e2e` before opening a
pull request.

## License

[MIT](LICENSE) (c) 2026 Ketan Kokane (Star Labs)

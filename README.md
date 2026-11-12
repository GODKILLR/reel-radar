# Reel Radar

Tracks what your Instagram competitors post, refreshes every 2 hours via Apify,
and surfaces which of their reels are actually outperforming â€” so you can spot a
working idea while it is still working.

Replaces the manual "save each competitor's reel and check back later" loop.

---

## What it does

- **Add an account by handle.** Paste `natgeo`, `@natgeo`, or a profile URL. Its
  post history is backfilled once, then kept fresh.
- **One feed, all competitors.** Every tracked post in a grid, sortable by newest,
  most views, fastest growing, biggest outlier, most likes, or best engagement.
  Filter by account, period, reels-only, outliers-only, or saved.
- **Outlier detection.** A reel is flagged when its views reach a multiple
  (default 3Ã—) of *that account's own median*. This is the number that matters:
  raw view counts just tell you who has the most followers, whereas 5Ã— the median
  means the idea beat the account's own baseline.
- **View velocity.** Because it polls every 2 hours, it keeps a view time series
  and shows views/hour. You see a reel climbing today, not next week.
- **Watchlist.** Star a reel into a to-recreate board with an
  idea â†’ scripted â†’ filmed â†’ posted status.
- **Alerts.** Telegram and/or email when a competitor posts a new outlier. Each
  reel alerts once, ever.
- **Trending audio.** Click the â™ª chip on any reel to see every tracked reel
  riding that same sound.
- **Replay ratio.** Instagram exposes both plays and accounts-reached; the ratio
  is a decent proxy for how loopable a hook is.
- **Spend tracking.** Rolling 24-hour and 30-day Apify cost, on the Competitors
  page. Cost never becomes a month-end surprise.

---

## How the polling works

Vercel functions time out long before an Apify scrape finishes, so the work is
split in two and nothing blocks:

```
cron (every 2h)  â”€â”€â–¶  queues ONE Apify run for all accounts  â”€â”€â–¶  returns in <1s
                                      â”‚
                      Apify scrapes (minutes), then calls back
                                      â–¼
            /api/webhooks/apify  â”€â”€â–¶  upsert posts
                                      write metrics snapshot
                                      recompute outliers + velocity
                                      send alerts
```

The actor accepts an array of usernames, so 20 competitors cost one run, not 20.

### Three tiers, so a 2-hour cadence stays affordable

Re-scraping each competitor's entire back catalogue twelve times a day would be
pure waste â€” a six-month-old reel's view count barely moves.

| Tier | Window | Frequency | Purpose |
|---|---|---|---|
| `backfill` | 180 days, 150 posts | once, when added | establishes the median baseline |
| `hot` | 2 days, 8 posts | every cycle | new posts + accurate velocity |
| `warm` | 30 days, 60 posts | every 72h | catches late bloomers |

All windows are env-tunable â€” see `.env.example`.

---

## Cost

Two scrapers are supported; `APIFY_ACTOR` picks one. Both return the **same view
counts** (verified: the same reel read 58,370,708 vs 58,370,605 across the two,
a 0.0002% drift that is just real growth between calls).

| | `lowcost` (default) | `official` |
|---|---|---|
| Actor | `sones/instagram-posts-scraper-lowcost` | `apify/instagram-post-scraper` |
| Per post | **$0.0003** | $0.0027 |
| Per run | $0.005 | none |
| Views, likes, comments, duration | yes | yes |
| Profile pictures | **yes** | no |
| Reach / replay ratio | no | yes |
| Trending audio (`audio_id`) | no | yes |
| Hashtags, mentions | parsed from caption | structured arrays |
| First-party | no (8 reviews) | yes |

The low-cost actor is ~9x cheaper per post and the default. Switch with
`APIFY_ACTOR=official` if you want replay ratio and trending-audio grouping, or
if the third-party actor ever breaks.

### Monthly cost on `lowcost`

One run covers every account at once, so the $0.005 start fee does not scale
with how many competitors you track. Assuming each posts ~1.5 reels/day
(3 per 2-day hot window) and a weekly warm sweep:

| Accounts | Poll every | Hot | Warm | **Total/month** |
|---|---|---|---|---|
| 5 | 2h | $3.42 | $0.41 | **$3.83** |
| 10 | 2h | $5.04 | $0.79 | **$5.83** |
| 15 | 2h | $6.66 | $1.18 | **$7.84** |
| 20 | 2h | $8.28 | $1.56 | **$9.84** |
| 25 | 2h | $9.90 | $1.95 | **$11.85** |
| 20 | 4h | $4.14 | $1.56 | **$5.70** |
| 25 | 6h | $3.30 | $1.95 | **$5.25** |

Apify's free plan includes **$10/month**, so up to about 20 accounts at 2-hour
polling fits without paying anything. Past that, either slow the interval or top
up. The same setup on the `official` actor costs roughly 9x more, which is why
it is not the default.

Rolling 24-hour and 30-day spend is shown on the Competitors page, read from
Apify's own billing figure for each run rather than an estimate.

## Setup

### 1. Postgres

Any Postgres works. Easiest is [Neon](https://neon.tech) (free tier is ample).
**Use the pooled connection string** â€” serverless functions open many short
connections.

### 2. Apify token

[console.apify.com/settings/integrations](https://console.apify.com/settings/integrations)

### 3. Configure

```bash
cp .env.example .env
```

Fill in `APIFY_TOKEN`, `DATABASE_URL`, and two secrets:

```bash
openssl rand -hex 32   # CRON_SECRET
openssl rand -hex 32   # WEBHOOK_SECRET
```

### 4. Deploy

```bash
npx vercel login
npx vercel link            # pick the existing reel-radar project
npm run push-env           # pipes the secrets from .env into Vercel
npx vercel --prod
```

`npm run push-env` reads `.env` and feeds each secret to the Vercel CLI over
stdin, so values are never printed or logged. Re-running it is safe. The
non-secret tuning variables can be set the same way or left to the defaults in
`src/lib/config.ts`.

Note that Vercel enables **SSO protection** on new projects, which blocks
Apify's webhook and the external cron from reaching the app. Turn it off under
Settings -> Deployment Protection, but only *after* the account system below is
deployed, since in-app sign-in is what replaces it.

Set `APP_BASE_URL` to your production URL. **Apify calls back to it**, so it
must be publicly reachable â€” this is the one variable that cannot point at
localhost.

### 5. Create the tables

```bash
curl -X POST "https://your-app.vercel.app/api/admin/migrate?secret=$CRON_SECRET"
```

Safe to re-run.

### 6. Schedule the poll

âš ï¸ **Vercel's Hobby plan caps cron at once per day**, and declaring anything more
frequent in `vercel.json` makes the *deployment* fail outright with
`cron_jobs_limits_reached`. So `vercel.json` declares no crons and scheduling is
external. See [CRON.md](CRON.md).

Point a free scheduler ([cron-job.org](https://cron-job.org) or GitHub Actions) at:

```
https://your-app.vercel.app/api/cron?secret=YOUR_CRON_SECRET
```

The endpoint accepts `Authorization: Bearer <CRON_SECRET>` or `?secret=`, so it
works with either.

### 7. Add competitors

Open the app â†’ **Competitors** â†’ paste handles. History lands on the next poll.
To not wait:

```bash
curl "https://your-app.vercel.app/api/cron?secret=$CRON_SECRET"
```

### Alerts (optional)

**Telegram** â€” message [@BotFather](https://t.me/botfather), `/newbot`, copy the
token. Get your chat id by messaging your bot then opening
`https://api.telegram.org/bot<TOKEN>/getUpdates`. Set `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID`.

**Email** â€” set `RESEND_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`
([resend.com](https://resend.com), free tier is fine).

Both can be set; both fire. Neither set means alerts are silently skipped and
everything else still works. The first backfill claims its outliers *silently*,
so adding 20 accounts does not fire hundreds of notifications on day one.

---

## Accounts and plans

**Everyone brings their own key.** Users sign up with email + password
(`/signup`), then paste their own Apify API token on the Accounts page. We verify
it, store it **encrypted** (AES-256-GCM, bound to their user id, needs
`KEY_ENCRYPTION_SECRET`) and collect their accounts on *their* monthly free
credit. The token is never sent back to the browser (only its last 4 characters).
Without a working key a user can browse Discover but cannot track accounts.

There are no points and no usage meters. **A plan only sets how many accounts a
user can track**, and lives in `src/lib/plans.ts`:

| | Free | Pro | Ultra |
|---|---|---|---|
| Price | $0 | $1 / month | $2 / month |
| Accounts tracked | 10 | 20 | 100 |

Every plan shows the latest 200 reels per account, refreshed daily, with
unlimited saved ideas. Prices are display-only until a payment provider is
connected; paid plans are switched on by hand from `/admin` for now.

- **Who pays for what.** Each cycle runs one pool on our key (featured accounts
  and accounts an admin tracks) and one pool per user on that user's own key. A
  user's broken key or empty credit only pauses their own accounts; those never
  fall back onto our bill. Our collection cost is therefore only the featured
  accounts.
- **Collection happens on request, not on a timer.** Adding an account, opening
  the feed or Accounts page, connecting a key, or pressing **Refresh now** calls
  `POST /api/collect`, which collects whatever that user's accounts need on their
  own key (new accounts immediately, stale ones when due, a weekly deeper sweep).
  It is cheap to call: when nothing is due it answers without contacting the
  collector. A refresh is throttled to once per 15 minutes per user, and a new
  account's first fetch is claimed atomically so two requests can never pay for
  it twice. The external scheduler (`/api/cron`) is now only a safety net for
  featured accounts; admins can also press **Collect featured accounts now** on
  `/admin`.
- **Credit.** Before each run we read the user's remaining credit and skip runs
  that would not fit. Out-of-credit users are re-checked every cycle and resume
  by themselves when their credit renews.
- **Callbacks.** Run-completion callbacks use a single-use per-run token
  (`?n=`), never a global secret, because that URL is visible inside the user's
  own collector account. Results are only accepted for the accounts that run was
  asked to collect.
- **Shared data.** Posts are collected once however many users track an account.
  Per-user: which accounts they track and their saved ideas. An account nobody
  tracks (and that is not featured) stops being collected.
- **Admin.** `/admin` shows users, their key status, featured accounts and
  collection spend (only runs on our key). Its API returns 404 to non-admins.

**Discover** shows outliers from accounts an admin has switched to "Featured" on
`/admin`. Nothing is featured by default.

**Going live** (one time, in order):

1. Apply the schema: `npm run migrate` (additive and idempotent).
2. Add `KEY_ENCRYPTION_SECRET` to the host (keep a backup: losing it makes every
   stored user key unreadable), deploy, and check `APP_BASE_URL`.
3. Sign up in the app, then:
   `npm run make-admin -- you@example.com --claim-legacy`.
4. On `/admin`, switch on the accounts you want in Discover.

connected.

## Local development

```bash
npm install
npm run dev
```

Reads work locally against the same `DATABASE_URL`. Polling does **not** complete
locally: Apify cannot reach `localhost` to deliver the webhook. Either poll
against the deployment, or tunnel:

```bash
npm run poll:local                 # hot tier, all active accounts
npm run poll:local -- backfill     # one-time history fetch
npm run poll:local -- hot 5        # cap posts per profile, for cost control
```

`poll:local` does the webhook's half of the work itself, so no tunnel is needed.
If you want to test the real webhook path, expose the app and use `npm run poll`:

```bash
npx ngrok http 3000
# set APP_BASE_URL to the ngrok https URL, then:
npm run poll
```

```bash
npm run migrate       # apply schema from the CLI
npm run actorcheck    # 33 assertions on both actor adapters (no DB needed)
npm run sqlcheck      # 44 assertions against your real database
npm run check         # both of the above
```

---

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/posts` | GET | feed; `sort`, `competitorId`, `days`, `type`, `outliersOnly`, `watchlistOnly`, `audioId`, `q`, `limit`, `offset` |
| `/api/competitors` | GET, POST | list / add |
| `/api/competitors/[id]` | PATCH, DELETE | pause-resume / remove |
| `/api/watchlist` | POST | save or update status |
| `/api/watchlist/[shortcode]` | DELETE | unsave |
| `/api/stats` | GET | summary, last run, spend |
| `/api/cron` | GET, POST | trigger a poll *(secret)* |
| `/api/webhooks/apify` | POST | Apify callback *(secret)* |
| `/api/admin/migrate` | POST | apply schema *(secret)* |

Force a specific tier: `/api/cron?secret=...&tier=warm`.

---

## Known limitations

- **Thumbnails expire.** Instagram CDN URLs are signed and die after some days,
  so older cards fall back to a "thumbnail expired" placeholder. The post link
  always works. To fix properly, copy images to Vercel Blob or S3 during ingest.
- **No follower counts.** Neither actor returns them, so that column stays
  null. Add `apify/instagram-profile-scraper` on a daily schedule if you want
  them. Profile pictures do populate on the `lowcost` actor.
- **Outlier scores need history.** The median baseline uses up to 30 recent
  mature reels, so a newly added account gives unreliable scores until its
  backfill lands. Posts under 24 hours old are deliberately left unscored â€”
  scoring them against mature posts would brand every new reel a failure.
- **Views are plays.** `views` is `videoPlayCount`, matching Instagram's UI.
  `reach` is the older `videoViewCount`. They differ by 2â€“3Ã—; do not mix them.
- **Private accounts cannot be tracked.** Public profiles only.
- **The Apify round trip is untested end to end.** The scrape, normalize and
  store steps are each verified in isolation, but cron -> Apify -> webhook ->
  ingest has not been run as one chain (it needs a deployed, publicly reachable
  URL). Expect to debug the webhook callback on first deploy.

## Verified vs. unverified

Checked against reality:

- Apify field names, types and null behaviour, from live `detailedData` runs
  (`normalizePost` passes 17 assertions against verbatim payloads).
- `basicData` genuinely lacks all view fields.
- Handle parsing, including rejecting `/p/` and `/reel/` URLs (11 assertions).
- `npm run build` and `tsc --noEmit` both clean.

Not yet exercised:

- Any SQL, including the migration (no Postgres in the build environment).
- The cron â†’ Apify â†’ webhook â†’ ingest round trip end to end.
- Telegram and email delivery.

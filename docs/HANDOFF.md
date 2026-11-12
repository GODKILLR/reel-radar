# Reel Radar - handoff

Everything a new Claude session (or person) needs that is NOT obvious from the
code. Start with `CLAUDE.md`; this file is the "why" and the "what's next".

## 1. What this is for
Star Labs promotes this tool in its reels as a **free lead magnet**: creators
sign up, connect their own Apify key and track competitors. The business value is
the creator audience (leads for coaching / community / recurring offers), not
tool revenue. Plans are a small paid upsell ($1 / $2) for more tracked accounts.
Brand: Star Labs (coral 5-point star in a white circle, "Star" navy + "Labs"
coral). Theme = the Star Labs mascot-reel look: cream dot-grid, navy outlines with
hard offset shadows, coral accent, orange-red (#fc4718) reserved for outliers,
Bricolage Grotesque + Instrument Serif italic keyword + JetBrains Mono labels.

## 2. How the model got here (so nobody re-litigates it)
1. Started as a single-user private tool (shared password, one Apify account).
2. Turned into a multi-user product. First draft had Free/Pro/Studio plans with
   **points** (add-account cost 10, monthly refill) and our own collection.
3. The owner's strategy: **users bring their own Apify key** (30-second signup,
   ~$5/month free credit) so scraping costs us nothing; points make no sense then.
   Points were removed; plans only cap tracked accounts (10 / 20 / 100).
4. Owner wants collection **"as user request"**, not on a scheduler (the external
   cron-job.org job had been dead ~39 days and new accounts sat on "collecting").
   Built `POST /api/collect` + auto-collect on page open + "Refresh now".
5. Real-key test found an account whose reels all showed 0 views (cheap collector
   returns no view field for some accounts). Added the per-account switch to the
   official collector with automatic re-collection and a schema self-heal.

## 3. Cost model (verified prices at the time)
- Cheap collector: $0.0003/post + $0.005/run. Official post scraper: ~$0.0027/post.
- Per tracked account per month at daily refresh (8 posts) + weekly sweep (60 posts):
  about $0.15. So 10 accounts is well inside Apify's free ~$5/month credit;
  30 accounts roughly fits; 100 accounts (Ultra) is ~$15/month of the USER's own
  credit (they will pay Apify some themselves).
- Accounts switched to the official collector cost ~9x per post (history fetch of
  100 posts ~ $0.27). Only affected accounts pay it.
- OUR costs: Vercel Pro (~$20/mo; Hobby is non-commercial), Neon (usage-based, a
  few $ to ~$20), domain, plus collection for FEATURED accounts only.
- Payment fees on a $1 charge are a large share; check the provider before pricing.
- Apify free-plan credit is reported as $5/month (the old README said $10).
  An extra "post about us for $5 more" bonus could NOT be verified - do not promise it.

## 4. Current live state (as of the last deploy)
- Deployed from `main`; the database schema is migrated through the views change.
- The owner has signed up and connected a real key; collection on request works.
- No account is admin yet and nothing is featured in Discover, so Discover is empty.
  Make an admin with `npm run make-admin -- <email> --claim-legacy` (links the 3
  accounts collected in the single-user days).
- Vercel env var NAMES present: DATABASE_URL, APIFY_TOKEN, CRON_SECRET,
  WEBHOOK_SECRET, KEY_ENCRYPTION_SECRET, APP_BASE_URL, APIFY_ACTOR, HOT_*, WARM_*,
  BACKFILL_* (365 days; the limit is capped at 100 posts in code), OUTLIER_*. `DASHBOARD_PASSWORD` is legacy and
  unused. `ADMIN_EMAILS` is optional (auto-admin on signup).
- `KEY_ENCRYPTION_SECRET` must be backed up by the owner; it was set by the owner
  (automation is not allowed to push secrets).

## 5. Known gaps / backlog (rough priority)
1. **Make the owner admin and feature accounts in Discover** (needs the owner's
   signup email).
2. **Scheduler:** restart the cron-job.org job (`node scripts/setup-cron.mjs <key>`
   or in its dashboard) ONLY for featured accounts; users no longer need it.
3. **Signup abuse:** no email verification or CAPTCHA. Signups cost us nothing now
   (no free collection), but add verification before a big public push.
4. **Payments:** none. Pro/Ultra are switched on by hand. A $1/$2 price loses a lot
   to fixed fees; consider yearly billing or a different price structure.
5. **Marketing consent + onboarding questions** (niche, follower size, goal) at
   signup, for the lead-gen purpose. Needs a privacy policy and an explicit
   marketing opt-in checkbox.
6. **Landing page** for logged-out visitors (today `/` redirects to `/login`).
7. Telegram/email alerts per user, CSV export, "why it worked" breakdown, weekly
   digest email, shareable outlier card (ideas discussed, none built).
8. Warm sweep only runs when a user triggers collection; fine, but a user who
   never opens the app gets no deeper sweep.
9. `users.points`, `points_ledger`, `user_watchlist` limits: points tables are dead
   weight and can be dropped in a future migration.

## 6. Things that bit us (avoid repeating)
- Passing a function that takes an optional 2nd arg straight to `.map()` (index
  became the collector name). Always wrap: `.map((x) => f(x))`.
- Empty env vars are dropped on Windows, so "run with an empty password" tricks
  don't work; use a different config instead.
- A callback URL that contains a global secret leaks it to whoever owns the
  collector account (user-owned keys!). Use single-use nonces.
- "Never let counters go down" (`GREATEST` in the upsert) means bad placeholder
  values must be cleared explicitly (done for hidden likes on switched accounts).
- An account with zero posts never got a "last collected" mark and was re-fetched
  forever; runs now mark all their accounts collected.
- Don't sweep (warm) accounts right after their history fetch.
- The in-app browser pane sometimes stops painting; rely on the e2e tests.

## 7. How verification works
`npx tsc --noEmit`, `npm run authcheck`, `npm run actorcheck`, `npm run build`,
and the end-to-end suites in `scripts/e2e/` (embedded Postgres + a fake collector
that can simulate revoked keys, empty credit, refused runs and reels with no
views). They never touch real services or the live database.

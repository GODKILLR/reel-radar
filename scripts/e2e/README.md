# End-to-end harness

Runs the real app against a **throwaway Postgres** and a **fake collector**
(a stand-in for Apify). Needs no real keys and can never reach the live database
or a real collector: `run.mjs` passes its own environment to the app, and process
env wins over `.env`.

```bash
npm install          # includes the embedded-postgres dev dependency
npm run e2e          # starts everything, runs every suite, tears it down
```

Needs free ports **3000** (app), **4010** (fake collector) and **5433** (Postgres),
and Node 20+. First run downloads the embedded Postgres binary. Takes a few
minutes.

## Suites
| File | What it proves |
|---|---|
| `e2e-plans.mjs` | Signup/login, plans (Free 10 / Pro 20 / Ultra 100), no points anywhere, key required to track, key connect/disconnect, credit and revoked-key handling, scheduler path, isolation between users, admin controls |
| `e2e-ondemand.mjs` | Collection on request with the scheduler never called: instant collect after adding an account, no duplicate runs, cooldown, claim race between two users, out-of-credit/invalid/no-key outcomes, refused runs retried, featured accounts never on a user's key, admin "collect now" |
| `e2e-cleanup.mjs` | Keeping the database small: 100-reel depth, snapshot cap, no stored video links, clean-up only deletes when the database is filling up, orphaned accounts and inactive users, saved ideas and featured accounts protected, last-seen, once-a-day guard |
| `e2e-views.mjs` | Accounts whose reels return no views: detection, switch to the official collector, automatic re-collection on the same key, hidden likes stored as 0, per-collector run splitting, the idempotent schema self-heal, platform accounts |

## The fake collector (`fake-collector.mjs`)
Implements just enough of the collector's REST API: user check, credit limits,
start run, run lookup, dataset items. It records which token every request used
(so tests can prove a user's run used the USER's key) and has control endpoints
under `/__control/` to set a token's validity/credit, refuse run starts, finish
or fail a run (which calls the app's callback), and list recorded runs. Accounts
whose handle starts with `noviews` return reels with no view field on the cheap
collector, which reproduces the real "0 views" problem.

## Running pieces by hand
```bash
node scripts/e2e/pg-start.mjs            # leave running
node scripts/e2e/fake-collector.mjs      # leave running
node --import tsx scripts/e2e/seed.mts    # create schema + demo data (cwd = repo root)
# start the app with DATABASE_URL=postgres://test:test@localhost:5433/rr_test,
# APIFY_API_BASE=http://localhost:4010/v2, APIFY_TOKEN=platform-token-0000000000000,
# KEY_ENCRYPTION_SECRET=<40+ chars>, WEBHOOK_SECRET=<anything>, CRON_SECRET=<anything>
node scripts/e2e/e2e-views.mjs           # run one suite (set CRON_SECRET to match)
```
Add a new suite by copying one of the existing files and listing it in `SUITES`
in `run.mjs`.

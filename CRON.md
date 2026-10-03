# Scheduling the poll

The 2-hour refresh is driven by an **external scheduler**, not by Vercel Cron.

Vercel's Hobby plan caps cron at once per day, and declaring a more frequent
schedule in `vercel.json` makes the deployment itself fail with
`cron_jobs_limits_reached`. So `vercel.json` intentionally declares no crons.

## Current setup: cron-job.org

| Field | Value |
|---|---|
| URL | `https://<deployment>/api/cron` |
| Method | `GET` |
| Schedule | every 2 hours |
| Header | `Authorization: Bearer <CRON_SECRET>` |

The endpoint queues the Apify runs and returns in well under a second, so a
short timeout is fine. Results arrive separately via the Apify webhook.

## If you later upgrade to Vercel Pro

Add this back to `vercel.json` and delete the external job, so there is only
one scheduler:

```json
{
  "crons": [{ "path": "/api/cron", "schedule": "0 */2 * * *" }]
}
```

Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically, which the
endpoint already accepts.

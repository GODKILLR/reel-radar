/**
 * Triggers a poll cycle from the command line. Useful for the first run and
 * for testing, but note the webhook still has to reach APP_BASE_URL, so this
 * only completes end-to-end against a publicly reachable deployment (or a
 * tunnel such as `ngrok http 3000`).
 */
import { runPollCycle } from "../src/lib/poller";
import type { Tier } from "../src/lib/apify";

const tier = process.argv[2] as Tier | undefined;

runPollCycle(tier ? { force: tier } : {})
  .then((runs) => {
    if (runs.length === 0) {
      console.log("Nothing to poll. Add a competitor first.");
    }
    for (const run of runs) {
      console.log(
        `${run.tier}: run ${run.runId} over ${run.usernames.length} account(s), ` +
          `max $${run.estimatedCostUsd.toFixed(4)}`
      );
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Poll failed:", err);
    process.exit(1);
  });

import type { ActorAdapter } from "./types";
import { lowcostAdapter } from "./lowcost";
import { officialAdapter } from "./official";

export const ADAPTERS: Record<string, ActorAdapter> = {
  lowcost: lowcostAdapter,
  official: officialAdapter,
};

/**
 * Picks the adapter named by APIFY_ACTOR. Defaults to the low-cost actor,
 * which costs about a ninth as much per post for the same view counts.
 */
export function getAdapter(key?: string): ActorAdapter {
  const wanted = (key ?? process.env.APIFY_ACTOR ?? "lowcost").trim();
  const adapter = ADAPTERS[wanted];
  if (!adapter) {
    throw new Error(
      `Unknown APIFY_ACTOR "${wanted}". Use one of: ${Object.keys(ADAPTERS).join(
        ", "
      )}`
    );
  }
  return adapter;
}

export * from "./types";

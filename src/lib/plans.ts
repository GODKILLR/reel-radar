/**
 * Plans. Everyone collects on their OWN collector key, so what a plan changes is
 * the one thing that is ours to sell: how many accounts the tool will track for
 * you. There are no points and no usage meters - just that number.
 */

export type PlanId = "free" | "pro" | "ultra" | "admin";

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in USD (display only until payments are connected). */
  priceUsd: number;
  /** Accounts a user can track at the same time. */
  maxAccounts: number;
  blurb: string;
}

/** Same for every plan: how much history we show per account. */
export const REELS_PER_ACCOUNT = 200;
/** Same for every plan: how often each account is refreshed. */
export const REFRESH_HOURS = 24;
/** How many outliers the Discover tab shows. */
export const DISCOVER_LIMIT = 30;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsd: 0,
    maxAccounts: 10,
    blurb: "Connect your key and track up to 10 accounts.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 1,
    maxAccounts: 20,
    blurb: "Twice the accounts, for $1 a month.",
  },
  ultra: {
    id: "ultra",
    name: "Ultra",
    priceUsd: 2,
    maxAccounts: 100,
    blurb: "For heavy research: track up to 100 accounts.",
  },
  // Internal: not listed anywhere, not sellable.
  admin: {
    id: "admin",
    name: "Admin",
    priceUsd: 0,
    maxAccounts: 500,
    blurb: "",
  },
};

/** Plans a user can see and (eventually) buy. */
export const PUBLIC_PLANS: Plan[] = [PLANS.free, PLANS.pro, PLANS.ultra];

/** Featured (Discover) accounts are refreshed at least this often. */
export const CURATED_REFRESH_HOURS = 6;

/**
 * Looks a plan up by id. Unknown ids fall back to Free, and the old "studio"
 * name maps to Ultra so any existing row keeps working.
 */
export function planOf(id: string | null | undefined): Plan {
  if (id === "studio") return PLANS.ultra;
  return PLANS[(id as PlanId) in PLANS ? (id as PlanId) : "free"];
}

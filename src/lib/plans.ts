/**
 * Plans and points. Everything a user can be told about limits lives here, so
 * the UI, the API and the poller all read the same numbers.
 *
 * Users only ever see "points" and plan limits - never what a scrape costs or
 * which vendor does it. Points are what adding an account spends, because that
 * is the one action that triggers a real (paid) history fetch.
 */

/**
 * "connect" is not a plan anyone is *on*: it is the set of limits a Free user
 * gets while they have their own collector key connected (see limitsFor in
 * session.ts). It is never stored in users.plan.
 */
export type PlanId = "free" | "pro" | "studio" | "admin" | "connect";

export interface Plan {
  id: PlanId;
  name: string;
  /** Accounts a user can track at the same time. */
  maxAccounts: number;
  /** Most recent reels (and, separately, other posts) shown per account. */
  reelsPerAccount: number;
  /** How often each tracked account is refreshed, in hours. */
  refreshHours: number;
  /** Reels that can sit on the saved-ideas board. */
  savedLimit: number;
  /** Outliers shown in the Discover tab. */
  discoverLimit: number;
  /** Points the balance resets to each month. */
  monthlyPoints: number;
  blurb: string;
}

const UNLIMITED = 1_000_000;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    maxAccounts: 3,
    reelsPerAccount: 200,
    refreshHours: 24,
    savedLimit: 10,
    discoverLimit: 10,
    monthlyPoints: 50,
    blurb: "A taste of the tool. Track three accounts and see what's working.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    maxAccounts: 15,
    reelsPerAccount: 500,
    refreshHours: 6,
    savedLimit: UNLIMITED,
    discoverLimit: 50,
    monthlyPoints: 300,
    blurb: "For creators and teams who research every week.",
  },
  studio: {
    id: "studio",
    name: "Studio",
    maxAccounts: 50,
    reelsPerAccount: 1000,
    refreshHours: 2,
    savedLimit: UNLIMITED,
    discoverLimit: 100,
    monthlyPoints: 1500,
    blurb: "Agencies and heavy research. Fastest refresh, deepest history.",
  },
  // Free user + their own collector key. They fund their own collection, so
  // the caps are about what one monthly free credit can sustain at a daily
  // refresh (roughly 30 accounts), not about our cost.
  connect: {
    id: "connect",
    name: "Free + own key",
    maxAccounts: 30,
    reelsPerAccount: 200,
    refreshHours: 24,
    savedLimit: UNLIMITED,
    discoverLimit: 25,
    monthlyPoints: 0,
    blurb: "Connect your own collector key for up to 30 accounts.",
  },
  // Internal: not listed anywhere, not sellable.
  admin: {
    id: "admin",
    name: "Admin",
    maxAccounts: 500,
    reelsPerAccount: 1000,
    refreshHours: 2,
    savedLimit: UNLIMITED,
    discoverLimit: 100,
    monthlyPoints: 0,
    blurb: "",
  },
};

/** Plans a user can see and (eventually) buy. */
export const PUBLIC_PLANS: Plan[] = [PLANS.free, PLANS.pro, PLANS.studio];

/** Points spent when a user adds an account to track. */
export const ADD_ACCOUNT_COST = 10;

/** Featured (Discover) accounts are refreshed at least this often. */
export const CURATED_REFRESH_HOURS = 6;

export function planOf(id: string | null | undefined): Plan {
  return PLANS[(id as PlanId) in PLANS ? (id as PlanId) : "free"];
}

export function isUnlimited(n: number): boolean {
  return n >= UNLIMITED;
}

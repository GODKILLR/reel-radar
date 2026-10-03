import { config } from "./config";
import { getAdapter } from "./actors";
import type { NormalizedPost } from "./actors";

export type Tier = "hot" | "warm" | "backfill";
export type { NormalizedPost };

/** Normalizes one raw dataset item using the configured actor's adapter. */
export function normalizePost(
  raw: Record<string, unknown>
): NormalizedPost | null {
  return getAdapter().normalize(raw);
}

interface StartRunOptions {
  usernames: string[];
  windowDays: number;
  limitPerProfile: number;
  /**
   * Where Apify should POST when the run finishes. Omit it to poll for the
   * result instead, which is what the local runner does -- Apify cannot
   * deliver a callback to localhost.
   */
  webhookUrl?: string;
}

export interface ApifyRunStarted {
  runId: string;
  datasetId: string;
}

/**
 * Kicks off one Apify run covering every username at once and returns
 * immediately. Both supported actors accept an array of profiles, so N
 * competitors cost one run rather than N.
 */
export async function startRun(
  opts: StartRunOptions
): Promise<ApifyRunStarted> {
  const adapter = getAdapter();
  const input = adapter.buildInput({
    usernames: opts.usernames,
    windowDays: opts.windowDays,
    limitPerProfile: opts.limitPerProfile,
  });

  let url =
    `https://api.apify.com/v2/acts/${adapter.actorId}/runs` +
    `?token=${encodeURIComponent(config.apify.token)}` +
    `&memory=${adapter.memoryMbytes}`;

  if (opts.webhookUrl) {
    // Ad-hoc webhook: a base64 JSON array on the `webhooks` query param.
    const webhooks = Buffer.from(
      JSON.stringify([
        {
          eventTypes: [
            "ACTOR.RUN.SUCCEEDED",
            "ACTOR.RUN.FAILED",
            "ACTOR.RUN.TIMED_OUT",
            "ACTOR.RUN.ABORTED",
          ],
          requestUrl: opts.webhookUrl,
        },
      ])
    ).toString("base64");
    url += `&webhooks=${encodeURIComponent(webhooks)}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(
      `Apify run start failed (${res.status}): ${await res.text()}`
    );
  }

  const body = (await res.json()) as {
    data?: { id?: string; defaultDatasetId?: string };
  };
  if (!body.data?.id || !body.data?.defaultDatasetId) {
    throw new Error("Apify response missing run id or dataset id");
  }
  return { runId: body.data.id, datasetId: body.data.defaultDatasetId };
}

/** Pages through a finished run's dataset. */
export async function fetchDatasetItems(
  datasetId: string
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const url =
      `https://api.apify.com/v2/datasets/${datasetId}/items` +
      `?token=${encodeURIComponent(config.apify.token)}` +
      `&clean=true&format=json&limit=${pageSize}&offset=${offset}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Apify dataset fetch failed (${res.status}): ${await res.text()}`
      );
    }
    const page = (await res.json()) as Record<string, unknown>[];
    items.push(...page);
    if (page.length < pageSize) break;
  }

  return items;
}

/** Resolves a run id to its dataset id (used when the webhook omits it). */
export async function getRunDataset(runId: string): Promise<string> {
  const res = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(
      config.apify.token
    )}`
  );
  if (!res.ok) throw new Error(`Apify run lookup failed (${res.status})`);
  const body = (await res.json()) as { data?: { defaultDatasetId?: string } };
  if (!body.data?.defaultDatasetId) throw new Error("Run has no dataset");
  return body.data.defaultDatasetId;
}

export interface ApifyRunStatus {
  status: string;
  defaultDatasetId: string;
}

/**
 * Waits for a run to leave the RUNNING/READY state. Only used by the local
 * runner; in production the webhook removes the need to poll at all.
 */
export async function waitForRun(
  runId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<ApifyRunStatus> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const intervalMs = opts.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const res = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(
        config.apify.token
      )}`
    );
    if (!res.ok) throw new Error(`Apify run poll failed (${res.status})`);

    const body = (await res.json()) as {
      data?: { status?: string; defaultDatasetId?: string };
    };
    const status = body.data?.status ?? "UNKNOWN";

    if (status !== "RUNNING" && status !== "READY") {
      return { status, defaultDatasetId: body.data?.defaultDatasetId ?? "" };
    }
    if (Date.now() > deadline) {
      throw new Error(`Run ${runId} still ${status} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Reads the amount Apify actually billed for a finished run. */
export async function getRunCost(runId: string): Promise<number | null> {
  const res = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(
      config.apify.token
    )}`
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { usageTotalUsd?: number } };
  return typeof body.data?.usageTotalUsd === "number"
    ? body.data.usageTotalUsd
    : null;
}

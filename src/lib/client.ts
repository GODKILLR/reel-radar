/**
 * Tiny fetch wrapper for the browser. Sends the user to /login when their
 * session has ended, and turns API error bodies into readable messages.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init);

  if (res.status === 401 && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
    throw new ApiError("Please sign in.", 401);
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    throw new ApiError(
      data.error ?? `Something went wrong (${res.status}).`,
      res.status,
      data.code
    );
  }
  return data as T;
}

export function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  return api<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------- collection on request ----------

export interface CollectResponse {
  outcome:
    | "started"
    | "nothing_due"
    | "in_progress"
    | "cooldown"
    | "no_key"
    | "invalid"
    | "out_of_credit"
    | "unreachable";
  message: string;
  launched: { tier: string; accounts: number }[];
}

/** Ask the server to collect this user's accounts now, on their own key. */
export function collectNow(force = false): Promise<CollectResponse> {
  return postJson<CollectResponse>("/api/collect", { force });
}

/**
 * Quietly checks, at most once per 10 minutes per browser tab session, whether
 * anything is due. Used when a page opens so data stays fresh without a timer.
 */
export async function autoCollect(): Promise<CollectResponse | null> {
  try {
    const key = "rr_collect_at";
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 10 * 60_000) return null;
    sessionStorage.setItem(key, String(Date.now()));
    return await collectNow(false);
  } catch {
    return null;
  }
}

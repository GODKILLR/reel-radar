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

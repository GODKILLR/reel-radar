import { Pool, type QueryResultRow } from "pg";

/**
 * A single pool reused across hot invocations. Point DATABASE_URL at a pooled
 * connection string (Neon/Supabase pgbouncer) so serverless concurrency does
 * not exhaust Postgres connections.
 */
const globalForDb = globalThis as unknown as { __pool?: Pool };

function getPool(): Pool {
  if (!globalForDb.__pool) {
    const connectionString =
      process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    globalForDb.__pool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      // Neon's free tier suspends compute when idle, and waking it can take
      // well over ten seconds. There is no cost to waiting longer, and the
      // alternative is a failed ingest.
      connectionTimeoutMillis: 30_000,
      ssl: connectionString.includes("localhost")
        ? undefined
        : { rejectUnauthorized: false },
    });
  }
  return globalForDb.__pool;
}

/**
 * Connection-level failures worth retrying. Neon's free tier suspends the
 * compute after a few minutes idle, and the first connection afterwards is
 * frequently reset while the endpoint cold-starts. That is transient, so a
 * blind retry is correct -- and without it the first poll after a quiet
 * period simply fails.
 */
const RETRYABLE = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  // DNS, which fails transiently while a suspended endpoint is coming back.
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now, i.e. still starting up
  "08006", // connection_failure
  "08003", // connection_does_not_exist
]);

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code && RETRYABLE.has(code)) return true;
  const message = (err as { message?: string }).message ?? "";
  return /connection terminated|connection reset|socket hang up|timeout expired/i.test(
    message
  );
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  attempt = 0
): Promise<T[]> {
  try {
    const result = await getPool().query<T>(text, params);
    return result.rows;
  } catch (err) {
    if (attempt >= 3 || !isRetryable(err)) throw err;

    // A reset connection may still sit in the pool, so discard it before
    // retrying rather than handing out the same dead socket.
    if (attempt === 0 && globalForDb.__pool) {
      await globalForDb.__pool.end().catch(() => {});
      globalForDb.__pool = undefined;
    }

    // 1s, 3s, 7s. The old 250/750/1750 schedule gave up inside three seconds,
    // which is shorter than a cold start usually takes.
    await new Promise((r) => setTimeout(r, 1000 * (2 ** attempt * 2 - 1)));
    return query<T>(text, params, attempt + 1);
  }
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Runs the statements in schema.sql. Idempotent. */
export async function migrate(): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const sql = await readFile(
    path.join(process.cwd(), "src/lib/schema.sql"),
    "utf8"
  );
  await getPool().query(sql);
}

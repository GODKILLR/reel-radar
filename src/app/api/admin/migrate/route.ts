import { NextResponse, type NextRequest } from "next/server";
import { migrate } from "@/lib/db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One-shot schema setup. Guarded by CRON_SECRET; safe to re-run. */
export async function POST(req: NextRequest) {
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(req.url).searchParams.get("secret") ??
    "";

  if (!config.secrets.cron || provided !== config.secrets.cron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await migrate();
    return NextResponse.json({ ok: true, message: "Schema applied." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

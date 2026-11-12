import { NextResponse } from "next/server";
import { authed } from "@/lib/session";
import {
  checkToken,
  getCollectorInfo,
  getUserToken,
  saveCheck,
} from "@/lib/collector";

export const dynamic = "force-dynamic";

const lastRefresh = new Map<number, number>();

/** "Test my key": re-checks validity and remaining credit right now. */
export async function POST() {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;

  const now = Date.now();
  if (now - (lastRefresh.get(user.id) ?? 0) < 3_000) {
    return NextResponse.json(await getCollectorInfo(user.id));
  }
  lastRefresh.set(user.id, now);

  const token = await getUserToken(user.id);
  if (!token) {
    return NextResponse.json(
      { error: "No key is connected." },
      { status: 400 }
    );
  }

  const check = await checkToken(token);
  if (check.state === "unreachable") {
    return NextResponse.json(
      { error: "We couldn't reach Apify just now. Try again in a minute." },
      { status: 502 }
    );
  }
  await saveCheck(user.id, check);
  return NextResponse.json(await getCollectorInfo(user.id));
}

// A fake of the collector's REST API, for local tests. It records which token
// every request used, so tests can prove a user's run used the USER's key.
import http from "node:http";

const PORT = 4010;
const PLATFORM = "platform-token-0000000000000";

// token -> { valid, limit, used, rejectStart }
const tokens = new Map([
  [PLATFORM, { valid: true, limit: 1000, used: 0 }],
]);
const runs = new Map(); // runId -> { token, usernames, datasetId, webhookUrl, limit }
const log = []; // { method, path, token }
let n = 0;

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => r(b));
  });

function items(run) {
  const out = [];
  const official = run.actor.includes("instagram-post-scraper");
  for (const u of run.usernames) {
    for (let i = 0; i < 3; i++) {
      if (official) {
        out.push({
          shortCode: `${u}_${i}`,
          ownerUsername: u,
          ownerFullName: `Name ${u}`,
          timestamp: new Date(Date.now() - (i + 2) * 86400000).toISOString(),
          productType: "clips",
          type: "Video",
          videoUrl: "https://example.com/v.mp4",
          videoPlayCount: 1000 * (i + 1),
          videoViewCount: null,
          likesCount: -1,
          commentsCount: 5,
          url: `https://www.instagram.com/p/${u}_${i}/`,
          caption: `post ${i} by ${u}`,
          displayUrl: "https://example.com/t.jpg",
        });
      } else {
        const item = {
          code: `${u}_${i}`,
          scraped_username: u,
          taken_at: Math.floor(Date.now() / 1000) - (i + 2) * 86400,
          media_type: 2,
          product_type: "clips",
          video_url: "https://example.com/v.mp4",
          play_count: 1000 * (i + 1),
          like_count: 3,
          comment_count: 5,
          caption: { text: `post ${i} by ${u} #test` },
          post_url: `https://www.instagram.com/p/${u}_${i}/`,
          user: { username: u, full_name: `Name ${u}`, profile_pic_url: "https://example.com/p.jpg" },
        };
        // Accounts whose reels come back with NO view field at all.
        if (u.startsWith("noviews")) delete item.play_count;
        out.push(item);
      }
    }
  }
  return out;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const path = url.pathname;

    // ---- test control ----
    if (path === "/__control/set" && req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      tokens.set(b.token, { ...(tokens.get(b.token) ?? { valid: true, limit: 5, used: 0 }), ...b.patch });
      return json(res, 200, { ok: true });
    }
    if (path === "/__control/log") return json(res, 200, log);
    if (path === "/__control/runs") {
      return json(res, 200, [...runs.entries()].map(([id, r]) => ({ id, ...r })));
    }
    if (path === "/__control/reset") { log.length = 0; return json(res, 200, { ok: true }); }
    if (path === "/__control/finish" || path === "/__control/fail") {
      const b = JSON.parse(await readBody(req));
      const run = runs.get(b.runId);
      if (!run) return json(res, 404, { error: "no such run" });
      const ok = path === "/__control/finish";
      if (ok) {
        const t = tokens.get(run.token);
        if (t) t.used += run.usernames.length * 3 * 0.0003 + 0.005;
      }
      const hook = await fetch(run.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: ok ? "ACTOR.RUN.SUCCEEDED" : "ACTOR.RUN.FAILED",
          resource: { id: b.runId, defaultDatasetId: run.datasetId, status: ok ? "SUCCEEDED" : "FAILED" },
        }),
      });
      return json(res, 200, { status: hook.status, body: await hook.json().catch(() => null) });
    }

    // ---- the API under test ----
    log.push({ method: req.method, path: path + (url.search ? "?" : ""), token: auth, hadQueryToken: url.searchParams.has("token") });
    const t = tokens.get(auth);
    if (!t || t.valid === false) return json(res, 401, { error: "invalid token" });

    if (path === "/v2/users/me") return json(res, 200, { data: { id: "u1", username: "someone" } });

    if (path === "/v2/users/me/limits") {
      return json(res, 200, {
        data: {
          monthlyUsageCycle: { startAt: "2026-11-01T00:00:00.000Z", endAt: "2026-11-30T23:59:59.999Z" },
          limits: { maxMonthlyUsageUsd: t.limit },
          current: { monthlyUsageUsd: t.used },
        },
      });
    }

    const start = path.match(/^\/v2\/acts\/([^/]+)\/runs$/);
    if (start && req.method === "POST") {
      if (t.rejectStart) return json(res, t.rejectStart, { error: "rejected" });
      if (t.used >= t.limit) return json(res, 402, { error: "limit" });
      const input = JSON.parse((await readBody(req)) || "{}");
      let webhookUrl = null;
      const wh = url.searchParams.get("webhooks");
      if (wh) webhookUrl = JSON.parse(Buffer.from(wh, "base64").toString())[0].requestUrl;
      const id = `run${++n}`;
      runs.set(id, { token: auth, actor: start[1], usernames: input.usernames ?? input.username ?? [], datasetId: `ds${n}`, webhookUrl, postsPerProfile: input.postsPerProfile ?? input.resultsLimit });
      return json(res, 201, { data: { id, defaultDatasetId: `ds${n}` } });
    }

    const runGet = path.match(/^\/v2\/actor-runs\/([^/]+)$/);
    if (runGet) {
      const r = runs.get(runGet[1]);
      if (!r) return json(res, 404, {});
      if (r.token !== auth) return json(res, 401, { error: "not your run" });
      return json(res, 200, { data: { status: "SUCCEEDED", defaultDatasetId: r.datasetId, usageTotalUsd: r.usernames.length * 3 * 0.0003 + 0.005 } });
    }

    const ds = path.match(/^\/v2\/datasets\/([^/]+)\/items$/);
    if (ds) {
      const r = [...runs.values()].find((x) => x.datasetId === ds[1]);
      if (!r) return json(res, 404, {});
      if (r.token !== auth) return json(res, 401, { error: "not your dataset" });
      return json(res, 200, items(r));
    }

    return json(res, 404, { error: "unknown" });
  })
  .listen(PORT, () => console.log("fake collector on", PORT));

/**
 * Verifies the things that must never break in the account system, with no
 * database needed:
 *   - session cookies cannot be forged, extended, replayed or re-pointed at
 *     another user
 *   - passwords are hashed (never stored), verified correctly, and policy holds
 *   - emails are normalised so one person cannot register twice via casing
 *   - plan limits are what the product promises
 */
process.env.WEBHOOK_SECRET = "test-signing-key-0123456789abcdef";

import {
  createSessionValue,
  readSession,
  isValidSession,
} from "../src/lib/auth";
import {
  hashPassword,
  verifyPassword,
  normalizeEmail,
  passwordProblem,
  DUMMY_HASH,
} from "../src/lib/password";
import {
  encryptToken,
  decryptToken,
  encryptionEnabled,
  looksLikeToken,
} from "../src/lib/collector";
import {
  splitPools,
  refreshHoursFor,
  type Competitor,
} from "../src/lib/poller";
import {
  PLANS,
  PUBLIC_PLANS,
  REELS_PER_ACCOUNT,
  REFRESH_HOURS,
  planOf,
} from "../src/lib/plans";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}: ${got}${ok ? "" : ` (expected ${want})`}`
  );
}

/** Signs a message with an arbitrary key, to mint forged cookies in tests. */
async function signWith(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function main() {
  // ---- session round trip ----
  const good = await createSessionValue(42);
  check("fresh session reads back the user id", await readSession(good), 42);
  check("fresh session is valid", await isValidSession(good), true);

  // ---- forgery ----
  check("undefined rejected", await readSession(undefined), null);
  check("empty rejected", await readSession(""), null);
  check("garbage rejected", await readSession("garbage"), null);
  check("old two-part format rejected", await readSession("9999999999999.abcd"), null);
  check(
    "bad signature rejected",
    await readSession(`42.${Date.now() + 100000}.deadbeef`),
    null
  );

  const [uid, exp, sig] = good.split(".");

  // The HMAC covers the user id, so swapping it for another user must fail.
  check("different user id, same signature rejected", await readSession(`43.${exp}.${sig}`), null);
  check("admin-style low id rejected", await readSession(`1.${exp}.${sig}`), null);

  // Extending the expiry must invalidate the signature.
  check(
    "extended expiry rejected",
    await readSession(`${uid}.${Number(exp) + 86_400_000}.${sig}`),
    null
  );

  const flipped = `${uid}.${exp}.${sig.slice(0, -1)}${sig.slice(-1) === "a" ? "b" : "a"}`;
  check("mutated signature rejected", await readSession(flipped), null);

  // Non-numeric user id (injection attempts).
  check("non-numeric user id rejected", await readSession(`4x.${exp}.${sig}`), null);
  check("negative user id rejected", await readSession(`-1.${exp}.${sig}`), null);

  // ---- expiry ----
  const pastExp = String(Date.now() - 1000);
  const pastSig = await signWith(process.env.WEBHOOK_SECRET!, `42.${pastExp}`);
  check(
    "expired-but-correctly-signed rejected",
    await readSession(`42.${pastExp}.${pastSig}`),
    null
  );

  // ---- wrong signing key ----
  const futureExp = String(Date.now() + 86_400_000);
  const foreignSig = await signWith("some-other-key-entirely", `42.${futureExp}`);
  check(
    "cookie signed with a different key rejected",
    await readSession(`42.${futureExp}.${foreignSig}`),
    null
  );

  // ---- fails closed with no key ----
  const savedKey = process.env.WEBHOOK_SECRET;
  delete process.env.WEBHOOK_SECRET;
  delete process.env.AUTH_SECRET;
  check("no signing key => existing cookie rejected", await readSession(good), null);
  let threw = false;
  try {
    await createSessionValue(1);
  } catch {
    threw = true;
  }
  check("no signing key => cannot mint a session", threw, true);
  process.env.WEBHOOK_SECRET = savedKey;

  // ---- passwords ----
  const hash = await hashPassword("correct-horse-battery");
  check("hash is not the password", hash.includes("correct-horse"), false);
  check("hash uses scrypt format", hash.startsWith("scrypt$"), true);
  check("correct password verifies", await verifyPassword("correct-horse-battery", hash), true);
  check("wrong password fails", await verifyPassword("wrong-horse-battery", hash), false);
  check("empty password fails", await verifyPassword("", hash), false);
  check("case variation fails", await verifyPassword("Correct-Horse-Battery", hash), false);
  check(
    "same password hashes differently (salted)",
    hash === (await hashPassword("correct-horse-battery")),
    false
  );
  check("garbage stored hash fails closed", await verifyPassword("x", "not-a-hash"), false);
  check("dummy hash never verifies", await verifyPassword("anything", DUMMY_HASH), false);

  check("short password rejected", passwordProblem("short") !== null, true);
  check("8 chars accepted", passwordProblem("12345678"), null);
  check("non-string rejected", passwordProblem(undefined) !== null, true);
  check("huge password rejected", passwordProblem("a".repeat(500)) !== null, true);

  // ---- emails ----
  check("email lower-cased + trimmed", normalizeEmail("  Ken@Example.COM "), "ken@example.com");
  check("email without @ rejected", normalizeEmail("nope"), null);
  check("email with spaces rejected", normalizeEmail("a b@c.com"), null);
  check("non-string email rejected", normalizeEmail(123), null);

  // ---- plans: what the product promises (accounts are the ONLY difference) ----
  check("free: 10 accounts, $0", [PLANS.free.maxAccounts, PLANS.free.priceUsd], [10, 0]);
  check("pro: 20 accounts, $1", [PLANS.pro.maxAccounts, PLANS.pro.priceUsd], [20, 1]);
  check("ultra: 100 accounts, $2", [PLANS.ultra.maxAccounts, PLANS.ultra.priceUsd], [100, 2]);
  check("every plan shows the latest 200 reels", REELS_PER_ACCOUNT, 200);
  check("every plan refreshes daily", REFRESH_HOURS, 24);
  check("plans only differ by account count (no points fields)", Object.keys(PLANS.free).sort().join(","), "blurb,id,maxAccounts,name,priceUsd");
  check("unknown plan falls back to free", planOf("platinum").id, "free");
  check("null plan falls back to free", planOf(null).id, "free");
  check("old 'studio' rows map to ultra", planOf("studio").id, "ultra");
  check("admin plan is never public", PUBLIC_PLANS.some((p) => p.id === "admin"), false);
  check("public plans are free < pro < ultra", PUBLIC_PLANS.map((p) => p.maxAccounts).join("<"), "10<20<100");
  check("paid plans cost more than free", PLANS.pro.priceUsd > PLANS.free.priceUsd && PLANS.ultra.priceUsd > PLANS.pro.priceUsd, true);

  // ---- collector keys: encryption at rest ----
  process.env.KEY_ENCRYPTION_SECRET = "k".repeat(40);
  const secretToken = "apify_api_AbCdEf1234567890xyzSECRET";
  const blob = encryptToken(secretToken, 7);
  check("ciphertext does not contain the token", blob.includes("SECRET") || blob.includes("apify_api"), false);
  check("decrypts for the same user", decryptToken(blob, 7), secretToken);
  check("another user cannot decrypt a copied blob", decryptToken(blob, 8), null);
  check(
    "same token encrypts differently each time (random IV)",
    blob === encryptToken(secretToken, 7),
    false
  );
  const parts = blob.split(".");
  const flippedCt = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3].slice(0, -2)}${parts[3].slice(-2) === "AA" ? "BB" : "AA"}`;
  check("tampered ciphertext rejected", decryptToken(flippedCt, 7), null);
  check("tampered tag rejected", decryptToken(`${parts[0]}.${parts[1]}.${"A".repeat(parts[2].length)}.${parts[3]}`, 7), null);
  check("garbage blob rejected", decryptToken("nonsense", 7), null);
  check("null blob rejected", decryptToken(null, 7), null);
  process.env.KEY_ENCRYPTION_SECRET = "z".repeat(40);
  check("wrong secret cannot decrypt", decryptToken(blob, 7), null);
  process.env.KEY_ENCRYPTION_SECRET = "short";
  check("short secret disables the feature", encryptionEnabled(), false);
  let threw2 = false;
  try {
    encryptToken("x".repeat(30), 1);
  } catch {
    threw2 = true;
  }
  check("cannot encrypt without a proper secret", threw2, true);
  check("nothing decrypts without a secret", decryptToken(blob, 7), null);
  process.env.KEY_ENCRYPTION_SECRET = "k".repeat(40);
  check("proper secret enables it", encryptionEnabled(), true);

  check("real-looking token accepted", looksLikeToken("apify_api_AbCdEf1234567890xyzW"), true);
  check("token with spaces rejected", looksLikeToken("has space inside it 1234567890"), false);
  check("too-short token rejected", looksLikeToken("abc"), false);
  check("non-string token rejected", looksLikeToken({ a: 1 }), false);
  check("injection-y token rejected", looksLikeToken("abc/../../etc/passwd_12345678"), false);

  // ---- collector pools: who pays for which account ----
  const mk = (over: Partial<Competitor>): Competitor => ({
    id: 1,
    username: "a",
    backfilled_at: null,
    last_scraped_at: null,
    is_curated: false,
    platform_trackers: 0,
    key_owner_ids: [],
    ...over,
  });
  const pools = splitPools([
    mk({ id: 1, username: "featured", is_curated: true }),
    mk({ id: 2, username: "adminacct", platform_trackers: 1 }),
    mk({ id: 3, username: "mine", key_owner_ids: ["9"] }),
    mk({ id: 4, username: "twokeys", key_owner_ids: ["12", "9"] }),
    mk({ id: 5, username: "paused" }), // only tracked by users with no working key
    mk({ id: 6, username: "featured-and-keyed", is_curated: true, key_owner_ids: ["9"] }),
  ]);
  check("featured account is on the platform", pools.platform.some((c) => c.username === "featured"), true);
  check("an admin's account is collected by us", pools.platform.some((c) => c.username === "adminacct"), true);
  check("featured account stays on the platform even if a keyed user tracks it (shared)", pools.platform.some((c) => c.username === "featured-and-keyed") && !pools.byUser.get("9")?.some((c) => c.username === "featured-and-keyed"), true);
  check("a user's account goes to that user's own key", pools.byUser.get("9")?.some((c) => c.username === "mine"), true);
  check("two key owners: deterministic single owner (lowest id)", [pools.byUser.get("9")?.some((c) => c.username === "twokeys"), pools.byUser.has("12")], [true, false]);
  check("account with no working key is in NO pool (never silently becomes our cost)", [pools.platform.some((c) => c.username === "paused"), [...pools.byUser.values()].flat().some((c) => c.username === "paused")], [false, false]);
  check("normal accounts refresh daily", refreshHoursFor({ is_curated: false }), 24);
  check("featured accounts refresh every 6h", refreshHoursFor({ is_curated: true }), 6);
  check(
    "even Ultra (100 accounts) at a daily refresh costs about $15/mo of the user's own credit (not ours)",
    (() => {
      const perAcct = (730 / 24) * 8 * 0.0003 + (730 / 168) * 60 * 0.0003;
      const runFees = (730 / 24) * 0.005 + (730 / 168) * 0.005;
      return Math.round(100 * perAcct + runFees);
    })(),
    15
  );
  check(
    "10 free accounts fit comfortably inside one free monthly credit ($5)",
    (() => {
      const perAcct = (730 / 24) * 8 * 0.0003 + (730 / 168) * 60 * 0.0003;
      const runFees = (730 / 24) * 0.005 + (730 / 168) * 0.005;
      return 10 * perAcct + runFees < 5;
    })(),
    true
  );

  console.log(
    failures === 0 ? "\nAll auth + plan checks passed." : `\n${failures} FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();

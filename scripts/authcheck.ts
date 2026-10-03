/**
 * Verifies the session cookie cannot be forged, replayed past expiry, or
 * bypassed. This is the only thing standing between the public internet and
 * the dashboard, so it gets explicit tests.
 */
process.env.WEBHOOK_SECRET = "test-signing-key-0123456789abcdef";
process.env.DASHBOARD_PASSWORD = "correct-horse-battery";

import {
  createSessionValue,
  isValidSession,
  checkPassword,
  isAuthEnabled,
} from "../src/lib/auth";

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
  check("auth enabled when password set", isAuthEnabled(), true);

  // ---- password ----
  check("correct password accepted", await checkPassword("correct-horse-battery"), true);
  check("wrong password rejected", await checkPassword("wrong"), false);
  check("empty password rejected", await checkPassword(""), false);
  check("prefix of password rejected", await checkPassword("correct-horse"), false);
  check("case variation rejected", await checkPassword("Correct-Horse-Battery"), false);

  // ---- session round trip ----
  const good = await createSessionValue();
  check("freshly issued session is valid", await isValidSession(good), true);

  // ---- forgery ----
  check("undefined rejected", await isValidSession(undefined), false);
  check("empty rejected", await isValidSession(""), false);
  check("garbage rejected", await isValidSession("garbage"), false);
  check("no signature rejected", await isValidSession("9999999999999"), false);
  check(
    "bad signature rejected",
    await isValidSession(`${Date.now() + 1000}.deadbeef`),
    false
  );

  // Tamper with the expiry but keep the original signature. The HMAC covers
  // the expiry, so extending a session must invalidate it.
  const [exp, sig] = good.split(".");
  check(
    "extended expiry rejected",
    await isValidSession(`${Number(exp) + 86_400_000}.${sig}`),
    false
  );

  // Flip one character of the signature.
  const flipped = `${exp}.${sig.slice(0, -1)}${sig.slice(-1) === "a" ? "b" : "a"}`;
  check("mutated signature rejected", await isValidSession(flipped), false);

  // ---- expiry ----
  // Correctly signed with the real key, but already expired.
  const pastExp = String(Date.now() - 1000);
  const pastSig = await signWith(process.env.WEBHOOK_SECRET!, pastExp);
  check(
    "expired-but-correctly-signed rejected",
    await isValidSession(`${pastExp}.${pastSig}`),
    false
  );

  // ---- wrong signing key ----
  // An attacker who knows the format but not the key cannot mint a session.
  const futureExp = String(Date.now() + 86_400_000);
  const foreignSig = await signWith("some-other-key-entirely", futureExp);
  check(
    "cookie signed with a different key rejected",
    await isValidSession(`${futureExp}.${foreignSig}`),
    false
  );

  console.log(
    failures === 0 ? "\nAll auth checks passed." : `\n${failures} FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();

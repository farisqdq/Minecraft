import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminPushKeys,
  base64UrlToBytes,
  checkCompose,
  checkPushLink,
  describeDevice,
  parsePushTarget,
  pushFailureMessage,
  pushIsGone,
  pushServiceName,
  sameApplicationServerKey,
  selectTargets,
  sendTally,
  MAX_PUSH_BROADCASTS_PER_ADMIN,
  MAX_PUSH_SENDS_PER_ADMIN,
} from "../lib/push-rules.ts";
import { describeAction, ADMIN_ACTIONS } from "../lib/admin.ts";

// A real P-256 public key as `web-push generate-vapid-keys` prints it, and another.
const KEY_A = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const KEY_B = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

/** A standalone ArrayBuffer holding these bytes, as PushSubscriptionOptions gives. */
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const ANDROID_SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const WIN_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0";

test("a subscription made with the current key matches, byte for byte", () => {
  const bytes = base64UrlToBytes(KEY_A);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4, "an uncompressed P-256 point starts with 0x04");
  assert.equal(sameApplicationServerKey(buf(bytes), KEY_A), true);
  assert.equal(sameApplicationServerKey(bytes, KEY_A), true, "a typed array works as well as a buffer");
  // A pasted env value with a trailing newline or padding is the same key.
  assert.equal(sameApplicationServerKey(buf(bytes), `${KEY_A}\n`), true);
});

test("a subscription made with another key, or with none recorded, doesn't match — so it's made again", () => {
  const a = base64UrlToBytes(KEY_A);
  assert.equal(sameApplicationServerKey(buf(a), KEY_B), false);
  assert.equal(sameApplicationServerKey(null, KEY_A), false);
  assert.equal(sameApplicationServerKey(undefined, KEY_A), false);
  assert.equal(sameApplicationServerKey(new ArrayBuffer(0), KEY_A), false);
  assert.equal(sameApplicationServerKey(buf(a), ""), false);
  assert.equal(sameApplicationServerKey(buf(a), "%%%not base64%%%"), false);
  // One byte different is different.
  const tweaked = a.slice();
  tweaked[64] ^= 1;
  assert.equal(sameApplicationServerKey(tweaked, KEY_A), false);
  // A view onto part of a larger buffer compares only its own bytes.
  const big = new Uint8Array(70);
  big.set(a, 3);
  assert.equal(sameApplicationServerKey(new Uint8Array(big.buffer, 3, 65), KEY_A), true);
});

test("devices are named by system and browser", () => {
  assert.equal(describeDevice(ANDROID_CHROME), "Android · Chrome");
  assert.equal(describeDevice(ANDROID_SAMSUNG), "Android · Samsung Internet");
  assert.equal(describeDevice(ANDROID_FIREFOX), "Android · Firefox");
  assert.equal(describeDevice(IPHONE_SAFARI), "iPhone · Safari");
  assert.equal(describeDevice(MAC_CHROME), "Mac · Chrome");
  assert.equal(describeDevice(WIN_EDGE), "Windows · Edge");
  assert.equal(describeDevice(IPHONE_SAFARI, { installed: true }), "iPhone · Safari (installed app)");
  assert.equal(describeDevice(`${ANDROID_CHROME} [installed]`), "Android · Chrome (installed app)");
  assert.equal(describeDevice(""), "Unknown device");
  assert.equal(describeDevice(null), "Unknown device");
  assert.equal(describeDevice("curl/8.0"), "Unknown device");
});

test("push services are named from the endpoint", () => {
  assert.equal(pushServiceName("https://fcm.googleapis.com/fcm/send/abc"), "Google (FCM)");
  assert.equal(pushServiceName("https://web.push.apple.com/QG..."), "Apple");
  assert.equal(pushServiceName("https://updates.push.services.mozilla.com/wpush/v2/x"), "Mozilla");
  assert.equal(pushServiceName("https://localhost:9443/push/1"), "localhost");
  assert.equal(pushServiceName("not a url"), "unknown push service");
});

test("links: a path on this site or an https address, nothing else", () => {
  assert.deepEqual(checkPushLink(""), { ok: true, link: "" });
  assert.deepEqual(checkPushLink("  /dashboard/reminders "), { ok: true, link: "/dashboard/reminders" });
  assert.deepEqual(checkPushLink("https://example.com/a?b=1"), { ok: true, link: "https://example.com/a?b=1" });
  for (const bad of ["//evil.example/x", "/\\evil.example", "http://example.com", "javascript:alert(1)", "dashboard", "data:text/html,hi", "/a b"]) {
    assert.equal(checkPushLink(bad).ok, false, bad);
  }
  assert.equal(checkPushLink(`/${"a".repeat(600)}`).ok, false);
});

test("compose: title and message required, within limits, trimmed", () => {
  assert.deepEqual(checkCompose({ title: " Hi ", body: " There ", link: "/portal" }), { ok: true, title: "Hi", body: "There", link: "/portal" });
  assert.equal(checkCompose({ title: "", body: "x" }).ok, false);
  assert.equal(checkCompose({ title: "x", body: "   " }).ok, false);
  assert.equal(checkCompose({ title: "x".repeat(81), body: "x" }).ok, false);
  assert.equal(checkCompose({ title: "x", body: "x".repeat(301) }).ok, false);
  assert.equal(checkCompose({ title: "x", body: "y", link: "http://insecure.example" }).ok, false);
  assert.equal(checkCompose({ title: 5, body: {} } as never).ok, false);
});

test("a refusal's message carries the status code and says what to do", () => {
  const stale = pushFailureMessage(403, "the key in the authorization header does not correspond to the sender ID used to subscribe to this push message");
  assert.match(stale, /^403 — /);
  assert.match(stale, /old key/);
  assert.match(stale, /off and on again/);
  assert.match(stale, /does not correspond/);
  assert.match(pushFailureMessage(403, '{"reason":"BadJwtToken"}'), /VAPID_SUBJECT/);
  assert.match(pushFailureMessage(410, ""), /^410 — .*removed/);
  assert.match(pushFailureMessage(404), /^404 — /);
  assert.match(pushFailureMessage(429), /^429 — too many|^429 — the push service says too many/);
  assert.match(pushFailureMessage(502, "bad gateway"), /^502 — .*problem.*bad gateway/);
  assert.match(pushFailureMessage(418), /^418 — the push service refused it/);
  assert.match(pushFailureMessage(undefined, "Vapid subject is not an https: or mailto: URL. me@x.com"), /^Not sent: Vapid subject/);
  assert.match(pushFailureMessage(undefined), /couldn't be reached/);
  // A long reply is cut to a snippet.
  assert.ok(pushFailureMessage(400, "x".repeat(5000)).length < 260);
});

test("only 404 and 410 mean the device is gone for good", () => {
  assert.equal(pushIsGone(404), true);
  assert.equal(pushIsGone(410), true);
  assert.equal(pushIsGone(403), false, "a 403 can be the site's own keys; removing on it would wipe every device");
  assert.equal(pushIsGone(500), false);
  assert.equal(pushIsGone(undefined), false);
});

const DEVICES = [
  { id: "d1", owner: "user:u1" },
  { id: "d2", owner: "user:u1" },
  { id: "d3", owner: "tenant:t1" },
];

test("targets: one device, one person's devices, or everyone", () => {
  assert.deepEqual(selectTargets(DEVICES, { kind: "everyone" }).map((d) => d.id), ["d1", "d2", "d3"]);
  assert.deepEqual(selectTargets(DEVICES, { kind: "device", id: "d2" }).map((d) => d.id), ["d2"]);
  assert.deepEqual(selectTargets(DEVICES, { kind: "person", owner: "user:u1" }).map((d) => d.id), ["d1", "d2"]);
  assert.deepEqual(selectTargets(DEVICES, { kind: "person", owner: "tenant:t1" }).map((d) => d.id), ["d3"]);
  assert.deepEqual(selectTargets(DEVICES, { kind: "device", id: "nope" }), []);
});

test("targets are read strictly from a request", () => {
  assert.deepEqual(parsePushTarget({ kind: "everyone" }), { kind: "everyone" });
  assert.deepEqual(parsePushTarget({ kind: "device", id: "d1" }), { kind: "device", id: "d1" });
  assert.deepEqual(parsePushTarget({ kind: "person", owner: "tenant:t1" }), { kind: "person", owner: "tenant:t1" });
  assert.equal(parsePushTarget({ kind: "person", owner: "t1" }), null);
  assert.equal(parsePushTarget({ kind: "device" }), null);
  assert.equal(parsePushTarget(null), null);
  assert.equal(parsePushTarget("everyone"), null);
});

test("sends are rate-limited per admin, broadcasts more tightly", () => {
  assert.deepEqual(adminPushKeys("a1", { kind: "device", id: "d1" }), [{ key: "admin-push:by:a1", max: MAX_PUSH_SENDS_PER_ADMIN }]);
  assert.deepEqual(adminPushKeys("a1", { kind: "everyone" }), [
    { key: "admin-push:by:a1", max: MAX_PUSH_SENDS_PER_ADMIN },
    { key: "admin-push:all:a1", max: MAX_PUSH_BROADCASTS_PER_ADMIN },
  ]);
});

test("the tally and the audit sentences", () => {
  assert.deepEqual(sendTally([{ sent: true }, { sent: false }, { sent: true }]), { sent: 2, failed: 1, text: "2 sent, 1 failed" });
  assert.ok(ADMIN_ACTIONS.includes("push.send"));
  assert.ok(ADMIN_ACTIONS.includes("push.device.remove"));
  assert.equal(
    describeAction({ action: "push.send", target: "everyone (3 devices)", detail: '"Rent due" — 2 sent, 1 failed' }),
    'Sent a notification to everyone (3 devices) — "Rent due" — 2 sent, 1 failed'
  );
  assert.equal(
    describeAction({ action: "push.device.remove", target: "Dad", detail: "Android · Chrome" }),
    "Removed a notification device of Dad — Android · Chrome"
  );
});

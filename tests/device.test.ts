import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceFromUserAgent, snoozed } from "../lib/device.ts";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const ANDROID_SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

test("iPhones are told apart from Chrome-on-iPhone, and iPads from Macs by their touch screen", () => {
  assert.deepEqual(deviceFromUserAgent(IPHONE_SAFARI), { kind: "ios", browser: "safari" });
  assert.deepEqual(deviceFromUserAgent(IPHONE_CHROME), { kind: "ios", browser: "other" });
  assert.deepEqual(deviceFromUserAgent(IPAD_DESKTOP, { touchPoints: 5 }), { kind: "ios", browser: "safari" });
  assert.equal(deviceFromUserAgent(IPAD_DESKTOP, { touchPoints: 0 }).kind, "desktop");
});

test("Android Chrome gets the one-tap install; other Android browsers the menu steps", () => {
  assert.deepEqual(deviceFromUserAgent(ANDROID_CHROME), { kind: "android", browser: "chrome" });
  assert.deepEqual(deviceFromUserAgent(ANDROID_SAMSUNG), { kind: "android", browser: "other" });
  assert.equal(deviceFromUserAgent(MAC_CHROME).kind, "desktop");
  assert.equal(deviceFromUserAgent("").kind, "desktop");
});

test("a dismissed banner stays away for a month, then comes back", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  assert.equal(snoozed(String(now - 5 * 86_400_000), now), true);
  assert.equal(snoozed(String(now - 31 * 86_400_000), now), false);
  assert.equal(snoozed(null, now), false);
  assert.equal(snoozed("garbage", now), false);
});

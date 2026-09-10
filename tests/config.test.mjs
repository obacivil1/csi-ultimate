import test from "node:test";
import assert from "node:assert/strict";
import { env } from "../config/env.mjs";
import { rateLimit, siteDelay, scoring } from "../config/index.mjs";

test("env: loads defaults in development", () => {
  assert.equal(env.NODE_ENV, "development");
  assert.ok(env.PORT > 0);
  assert.ok(env.SMTP.FROM_EMAIL.length > 0);
  assert.equal(env.TZ, "Asia/Riyadh");
});

test("env: validate() does not throw in development with default secrets", () => {
  assert.doesNotThrow(() => env.validate());
});

test("config: rateLimit defaults match production expectations", () => {
  assert.equal(rateLimit.minDelayMs, 800);
  assert.equal(rateLimit.maxDelayMs, 8000);
  assert.equal(rateLimit.maxRetries, 3);
  assert.equal(rateLimit.requestsPerMinute, 15);
});

test("config: siteDelay.etimadMs is not zero", () => {
  assert.ok(siteDelay.etimadMs >= 1000);
});

test("config: scoring thresholds are sane", () => {
  assert.ok(scoring.emailScoreMin >= 0 && scoring.emailScoreMin <= 100);
  assert.ok(scoring.leadScoreThreshold >= 0 && scoring.leadScoreThreshold <= 100);
});
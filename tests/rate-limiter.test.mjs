import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// better-sqlite3 is CJS; load via require to avoid ESM interop issues in tests
const tmp = path.join(os.tmpdir(), `csi-rl-test-${process.pid}`);
fs.mkdirSync(tmp, { recursive: true });

test("rate-limiter: detectBan flags HTTP 429/403/503", async () => {
  const { detectBan } = await import("../core/rate-limiter.mjs");
  assert.equal(detectBan(429).banned, true);
  assert.equal(detectBan(403).banned, true);
  assert.equal(detectBan(503).banned, true);
  assert.equal(detectBan(200, "just a moment...").banned, true);
  assert.equal(detectBan(200, "normal page").banned, false);
});

test("rate-limiter: AdaptiveRateLimiter respects min/max and backoff", async () => {
  const { AdaptiveRateLimiter } = await import("../core/rate-limiter.mjs");
  const lim = new AdaptiveRateLimiter({ minDelay: 10, maxDelay: 200, baseDelay: 50, backoffFactor: 2, recoveryFactor: 0.5 });
  for (let i = 0; i < 5; i++) lim.onError(true);
  assert.ok(lim.stats().currentDelay <= 200);
  assert.ok(lim.stats().currentDelay > 50);
  for (let i = 0; i < 3; i++) lim.onSuccess();
  assert.ok(lim.stats().currentDelay >= 10);
});

test("rate-limiter: RetryHandler retries and returns last result", async () => {
  const { RetryHandler } = await import("../core/rate-limiter.mjs");
  const rh = new RetryHandler({ maxRetries: 3, baseDelay: 1, maxDelay: 5 });
  let calls = 0;
  const out = await rh.run(async () => {
    calls++;
    if (calls < 3) throw new Error("flaky");
    return "done";
  }, "test");
  assert.equal(out, "done");
  assert.equal(calls, 3);
});

test("rate-limiter: RequestThrottle paces requests per domain", async () => {
  const { RequestThrottle } = await import("../core/rate-limiter.mjs");
  const t = new RequestThrottle(60); // 1 req/s
  const t0 = Date.now();
  await t.waitFor("https://example.com/a");
  await t.waitFor("https://example.com/b");
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 900, `expected >=900ms, got ${elapsed}`);
});
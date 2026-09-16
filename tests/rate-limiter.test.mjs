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

test("circuit-breaker: قفل بعد عتبة الحجب ثم نصف-مفتوح بعد التهدئة", async () => {
  const { CircuitBreaker } = await import("../core/rate-limiter.mjs");
  const cb = new CircuitBreaker({ tripThreshold: 3, windowMs: 50, cooldownMs: 30, halfOpenProbeLimit: 2 });
  const host = "x.com";
  cb.onFailure(host, "cf_challenge");
  cb.onFailure(host, "cf_challenge");
  assert.equal(cb.status(host), "closed");
  cb.onFailure(host, "cf_challenge");
  assert.equal(cb.status(host), "open");
  assert.equal(cb.canRequestNow(host), false, "مفتوح — محجوب خلال التهدئة");
  // بعد انتهاء التهدئة → half-open مع حصة استكشاف محدودة
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(cb.status(host), "half_open");
  assert.equal(cb.canRequestNow(host), true, "أول مساحة استكشاف");
  assert.equal(cb.canRequestNow(host), true, "ثاني مساحة استكشاف");
  assert.equal(cb.canRequestNow(host), false, "استُنفدت الحصة");
});

test("circuit-breaker: نجاح يشفّي المضيف فوراً", async () => {
  const { CircuitBreaker } = await import("../core/rate-limiter.mjs");
  const cb = new CircuitBreaker({ tripThreshold: 2, cooldownMs: 100000 });
  cb.onFailure("good.com");
  cb.onFailure("good.com");
  assert.equal(cb.status("good.com"), "open");
  cb.onSuccess("good.com");
  assert.equal(cb.status("good.com"), "closed");
  assert.equal(cb.canRequestNow("good.com"), true);
});

test("circuit-breaker: فشل أثناء نصف-مفتوح يعيد القفل مباشرة", async () => {
  const { CircuitBreaker } = await import("../core/rate-limiter.mjs");
  const cb = new CircuitBreaker({ tripThreshold: 2, cooldownMs: 10 });
  cb.onFailure("flaky.com");
  cb.onFailure("flaky.com");
  await new Promise((r) => setTimeout(r, 12));
  assert.equal(cb.status("flaky.com"), "half_open");
  cb.onFailure("flaky.com", "captcha");
  assert.equal(cb.status("flaky.com"), "open", "فشل الاستكشاف يعيد القفل");
});

test("circuit-breaker: عزل المضيفات — حجب مضيف لا يوقف غيره", async () => {
  const { CircuitBreaker } = await import("../core/rate-limiter.mjs");
  const cb = new CircuitBreaker({ tripThreshold: 2, cooldownMs: 5000 });
  cb.onFailure("bad.com");
  cb.onFailure("bad.com");
  assert.equal(cb.status("bad.com"), "open");
  assert.equal(cb.canRequestNow("bad.com"), false);
  assert.equal(cb.status("ok.com"), "closed");
  assert.equal(cb.canRequestNow("ok.com"), true, "المضيف السليم لا يتأثر");
});

test("rate-limiter: محدِّد معزول لكل مضيف (Bulkhead)", async () => {
  const { getHostLimiter, waitForHost, reportHostResult } = await import("../core/rate-limiter.mjs");
  const a = getHostLimiter("alpha.com");
  const b = getHostLimiter("beta.com");
  assert.notEqual(a, b, "مثالان منفصلان");
  assert.equal(getHostLimiter("alpha.com"), a, "نفس المضيف = نفس المثيل");
  // إشارة حظر كثيفة على alpha لا تمس beta
  for (let i = 0; i < 5; i++) a.onError(true);
  assert.equal(a.stats().currentDelay > b.stats().currentDelay, true);
  assert.equal(b.stats().currentDelay, 1500, "beta لم يتأثر بالتأخير العالمي");
  await waitForHost("gamma.com");
  reportHostResult("delta.com", false, "captcha");
  reportHostResult("delta.com", true);
});
import test from "node:test";
import assert from "node:assert/strict";
import { classifyBan, detectBan, THRESHOLD } from "../core/ban-detector.mjs";

test("ban-detector: أكواد HTTP الصريحة تُصنّف حجباً", () => {
  for (const code of [403, 429, 503]) {
    const r = classifyBan({ statusCode: code });
    assert.equal(r.banned, true, `expect ${code} banned`);
    assert.ok(r.kind.startsWith("http_"));
    assert.ok(r.confidence >= 90, `confidence>=90 for ${code}`);
  }
  assert.equal(classifyBan({ statusCode: 429 }).confidence, 100);
  assert.equal(classifyBan({ statusCode: 403 }).confidence, 100);
  assert.equal(classifyBan({ statusCode: 503 }).confidence, 90, "503 مرجّح أخف (قد يكون عطلاً لا حظراً)");
});

test("ban-detector: تحدّي Cloudflare يُكتشف من النص", () => {
  const r = classifyBan({ statusCode: 200, bodyText: "Checking your browser before accessing..." });
  assert.equal(r.banned, true);
  assert.equal(r.kind, "cf_challenge");
});

test("ban-detector: صفحة CAPTCHA تُصنّف", () => {
  const r = classifyBan({ html: "<h1>Are you a robot? Complete the captcha</h1>" });
  assert.equal(r.banned, true);
  assert.equal(r.kind, "captcha");
});

test("ban-detector: حجب ناعم (200 + محتوى شبه فارغ) يُعلّم قليلاً فقط", () => {
  const r = classifyBan({ statusCode: 200, html: "<html><head></head><body></body></html>" });
  assert.equal(r.confidence, 35);
  assert.equal(r.banned, false, "لا نُطلق عليها حجباً صريحاً لوحدها");
  assert.ok(r.evidence.some((e) => e.kind === "soft_block"));
});

test("ban-detector: حجب ناعم + إشارة 'blocked' = حجب حقيقي", () => {
  const r = classifyBan({ statusCode: 200, html: "<body>Your request has been blocked</body>" });
  assert.equal(r.banned, true);
});

test("ban-detector: لا false-positive من كلمة 'blocked' على صفحة كبيرة سليمة", () => {
  const body = "blocked".padEnd(20000, " legit content here with lots of words and numbers 123 ");
  const r = classifyBan({ statusCode: 200, bodyText: body });
  assert.equal(r.banned, false, "كلمة عامة وحيدة لا تكفي فوق عتبة الجسم");
  assert.ok(r.confidence < THRESHOLD);
});

test("ban-detector: صفحة سليمة تماماً لا أدلة", () => {
  const r = classifyBan({ statusCode: 200, title: "Gumtree UK", bodyText: "Fresh start 2000. ad 42".repeat(300) });
  assert.equal(r.banned, false);
  assert.equal(r.reason, "");
  assert.equal(r.action, "continue");
});

test("ban-detector: تعيين action حسب النوع", () => {
  assert.equal(classifyBan({ statusCode: 429 }).action, "retry_proxy");
  assert.equal(classifyBan({ bodyText: "just a moment" }).action, "rotate_fingerprint");
  assert.equal(classifyBan({ bodyText: "verify you are human to continue captcha below" }).action, "wait_backoff");
});

test("ban-detector: detectBan (الواجهة التوافقية القديمة) تحافظ على السلوك", () => {
  assert.equal(detectBan(429).banned, true);
  assert.equal(detectBan(403).banned, true);
  assert.equal(detectBan(503).banned, true);
  assert.equal(detectBan(200, "just a moment...").banned, true);
  assert.equal(detectBan(200, "normal page").banned, false);
});
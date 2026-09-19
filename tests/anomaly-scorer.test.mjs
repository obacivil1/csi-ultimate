import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreResponse,
  scoreSignals,
  decide,
  toText,
} from "../core/anomaly-scorer.mjs";

test("anomaly-scorer: صفحة نظيفة 200 = شذوذ منخفض وقرار allow", () => {
  const r = scoreResponse({ status: 200, kind: null, confidence: 0, elapsed: 400 });
  assert.equal(r.fallback, false);
  assert.ok(r.score >= 0 && r.score <= 1);
  assert.ok(r.score < 0.3, `score=${r.score}`);
  assert.equal(r.decision, "allow");
  assert.ok(Array.isArray(r.explanation));
});

test("anomaly-scorer: 429 عالي القوة يشعل شذوذاً عالياً ويعطي تفسيراً", () => {
  const r = scoreResponse({ status: 429, kind: "http_429", confidence: 100, evidence: [{ kind: "http_429", signal: "HTTP 429", score: 100 }], elapsed: 200 });
  assert.ok(r.score > 0.6, `score=${r.score}`);
  assert.equal(r.decision, "deny");
  assert.ok(r.explanation[0].feature.includes("status_429"), `top=${r.explanation[0].feature}`);
  const txt = toText(r.explanation);
  assert.ok(txt.includes("status_429"));
});

test("anomaly-scorer: 403 مع captcha وصل 200 — اقتراح step_up/deny بتفسير", () => {
  const r = scoreResponse({ status: 403, kind: "waf_block", confidence: 80, evidence: [{ kind: "waf_block", signal: "access denied", score: 70 }], elapsed: 300 });
  assert.ok(r.score > 0.5, `score=${r.score}`);
  assert.ok(["step_up", "deny"].includes(r.decision));
});

test("anomaly-scorer: حجب ناعم (200 جسم فارغ) يرفع النتيجة", () => {
  const r = scoreResponse({ status: 200, kind: "soft_block", confidence: 35, evidence: [{ kind: "soft_block", signal: "content 120B", score: 35 }], elapsed: 200 });
  assert.ok(r.score > 0.3, `score=${r.score}`);
});

test("anomaly-scorer: تأخير غير طبيعي يضيف إشارة high_latency", () => {
  const r = scoreResponse({ status: 200, kind: null, elapsed: 20000, latencyHighMs: 8000 });
  assert.ok(r.signals.some((s) => s.name === "high_latency"));
});

test("anomaly-scorer: fallback على مدخلات مكسورة — لا يرمي", () => {
  const r = scoreResponse(null);
  assert.equal(r.fallback, true);
  assert.equal(r.decision, "allow");
  const r2 = scoreResponse({ status: NaN, kind: undefined, confidence: "x", evidence: null, elapsed: null });
  assert.ok(["allow", "step_up", "deny"].includes(r2.decision));
});

test("anomaly-scorer: الحتمية — نفس الإدخال يعطي نفس النتيجة", () => {
  const a = scoreResponse({ status: 403, kind: "cf_challenge", confidence: 90, elapsed: 500 });
  const b = scoreResponse({ status: 403, kind: "cf_challenge", confidence: 90, elapsed: 500 });
  assert.equal(a.score, b.score);
  assert.deepEqual(a.explanation, b.explanation);
});

test("anomaly-scorer: decide عتبات منطقية", () => {
  assert.equal(decide(0.1), "allow");
  assert.equal(decide(0.45), "step_up");
  assert.equal(decide(0.9), "deny");
});

test("anomaly-scorer: scoreSignals يفسّر كل إشارة بمساهمة", () => {
  const r = scoreSignals([
    { name: "a", weight: 3.0 },
    { name: "b", weight: 1.0 },
  ]);
  assert.ok(r.score > 0.5);
  assert.equal(r.explanation.length, 2);
  // الإشارة الأقوى تتصدر
  assert.equal(r.explanation[0].feature, "a");
  assert.ok(Math.abs(r.explanation[0].contribution) > Math.abs(r.explanation[1].contribution));
});

test("anomaly-scorer: toText نص مقروء", () => {
  const r = scoreResponse({ status: 429, kind: "http_429", confidence: 100, elapsed: 200 });
  const t = toText(r.explanation);
  assert.ok(t.includes("رفع") || t.includes("خفض"));
});
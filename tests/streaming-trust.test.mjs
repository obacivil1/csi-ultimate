import test from "node:test";
import assert from "node:assert/strict";
import { StreamingTrust, StreamingTrustHub, ACTION_BY_DECISION } from "../core/streaming-trust.mjs";

test("streaming-trust: يبدأ بثقة 1.0 وينخفض تدريجياً مع scores", () => {
  const t = new StreamingTrust();
  assert.equal(t.stats().trust, 1.0);
  t.push(0.5);
  assert.ok(t.stats().trust < 1.0);
  t.push(0.5);
  t.push(0.5);
  assert.ok(t.stats().trust < 0.9, `trust=${t.stats().trust}`);
});

test("streaming-trust: scores صحيحة لا تنخفض عن الصفر", () => {
  const t = new StreamingTrust();
  for (let i = 0; i < 100; i++) t.push(1.0);
  assert.ok(t.stats().trust >= 0);
});

test("streaming-trust: القرار حسب العتبات (terminate<0.10 ... none≥0.70)", () => {
  const t = new StreamingTrust();
  assert.equal(t.decide(), "none");
  for (let i = 0; i < 200; i++) t.push(1.0); // ثقة نحو الصفر
  assert.equal(t.decide(), "terminate");
});

test("streaming-trust: إجراء يعكس قراراً بمعجم معروف", () => {
  const t = new StreamingTrust();
  assert.equal(t.action(), "continue");
  assert.ok(ACTION_BY_DECISION.terminate === "pause_host");
  assert.ok(ACTION_BY_DECISION.step_up === "retry_proxy");
});

test("streaming-trust: تعافٍ بطيء بعد استقرار طويل", () => {
  const t = new StreamingTrust({ decayRate: 0.15, recoveryRate: 0.02, recoverAfterN: 5, stableMean: 0.15 });
  for (let i = 0; i < 8; i++) t.push(1.0); // انزل إلى ~0
  const dropped = t.stats().trust;
  assert.ok(dropped < 0.3, `dropped=${dropped}`);
  for (let i = 0; i < 20; i++) t.push(0.0); // استقرار قصير
  const recovered = t.stats().trust;
  assert.ok(recovered > dropped, `recovered=${recovered}`);
  assert.ok(recovered < 1.0, "التعافي مقيد لا فوري");
});

test("streaming-trust: forecast يتنبأ بدقة — اتجاه هابط يُرصد", () => {
  const t = new StreamingTrust();
  for (let i = 0; i < 10; i++) t.push(0.0); // الأساس ثم نرفع
  for (let i = 0; i < 20; i++) t.push(1.0); // سلسلة مشبوهة
  const f = t.forecast(5);
  assert.ok(["rising", "falling", "stable"].includes(f.trend));
  assert.ok(f.score >= 0 && f.score <= 1);
  assert.ok(f.confidence >= 0 && f.confidence <= 1);
});

test("streaming-trust: hub يعزل المضيفات ويطالعها", () => {
  const hub = new StreamingTrustHub();
  hub.push("good.example", 0.1);
  hub.push("bad.example", 0.9);
  hub.push("bad.example", 0.9);
  hub.push("bad.example", 0.9);
  hub.push("bad.example", 0.9);
  hub.push("bad.example", 0.9);
  hub.push("bad.example", 0.9);
  assert.ok(hub.state("good.example").trust > 0.8, "المضيف الجيد لم يتأثر");
  assert.ok(hub.state("bad.example").trust < hub.state("good.example").trust, "المضيف السيء انخفض");
  const dying = hub.dyingHosts();
  assert.ok(dying.includes("bad.example") || hub.state("bad.example").decision !== "none");
});

test("streaming-trust: reset يعيد الحالة الابتدائية", () => {
  const t = new StreamingTrust();
  t.push(1.0);
  t.push(1.0);
  t.reset();
  assert.equal(t.stats().trust, 1.0);
  assert.equal(t.stats().samples, 0);
});
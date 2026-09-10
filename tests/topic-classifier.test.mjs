import test from "node:test";
import assert from "node:assert/strict";
import { classifyText, TAXONOMY } from "../core/topic-classifier.mjs";

test("التصنيفات المعرَّفة موجودة وقابلة للاستخدام", () => {
  const keys = Object.keys(TAXONOMY);
  assert.ok(keys.length >= 8);
  assert.ok(keys.includes("jobs"));
  assert.ok(keys.includes("sports"));
  assert.ok(keys.includes("tech"));
});

test("تصنيف نص إخباري عربي -> أخبار", () => {
  const res = classifyText("أخبار عاجلة: مراسلنا في الرياض يقدّم تقريراً عن آخر المستجدات اليوم عبر وكالة الأنباء الرسمية");
  assert.ok(res.scored, "scored expected");
  assert.equal(res.dominant.topic, "news");
  assert.ok(res.dominant.pct >= 50);
});

test("تصنيف نص رياضي عربي -> رياضة", () => {
  const res = classifyText("انتهت مباراة الدوري اليوم بهدف وحيد، حسم نادي الهدف في كرة القدم اللقب أمام جمهور الملعب");
  assert.equal(res.dominant.topic, "sports");
  assert.ok(res.dominant.pct >= 50);
});

test("تصنيف نص تقني -> تقنية", () => {
  const res = classifyText("تطبيق جديد يعتمد تقنيات الذكاء الاصطناعي والبرمجيات السحابية لأمن البيانات والشبكات");
  assert.equal(res.dominant.topic, "tech");
  assert.ok(res.dominant.pct >= 50);
});

test("تصنيف نص إعلان وظيفة -> وظائف", () => {
  const res = classifyText("وظيفة شاغرة للتوظيف: مطلوب مهندس، راتب مجزٍ، يرجى إرسال سيرة ذاتية لتحديد موعد المقابلة");
  assert.equal(res.dominant.topic, "jobs");
});

test("نص بلا كلمات دالة -> عام بدون نتيجة", () => {
  const res = classifyText("xyz qwerty lorem ipsum uncategorized gibberish text content here alone");
  assert.equal(res.scored, false);
  assert.equal(res.dominant.topic, "general");
  assert.equal(res.dominant.pct, 100);
});

test("النسب المئوية الناتجة تُرَتَّب تنازلياً ومجموعها يقارب 100", () => {
  const res = classifyText("مباراة الدوري اليوم وفتحت الجولة الذهبية عبر وكالة الأنباء أخبار عاجلة عن الرياضة وإعلان عن وظيفة شاغرة");
  assert.ok(res.topics.length >= 3);
  for (let i = 1; i < res.topics.length; i++) {
    assert.ok(res.topics[i - 1].pct >= res.topics[i].pct, "topics sorted desc");
  }
  const total = res.topics.reduce((a, t) => a + t.pct, 0);
  assert.ok(Math.abs(total - 100) < 5, `sum ~100 (got ${total})`);
});

test("المصنف يتقبل نصاً فارغاً بأمان", () => {
  const res = classifyText("");
  assert.equal(res.dominant.topic, "general");
  assert.equal(res.scored, false);
});
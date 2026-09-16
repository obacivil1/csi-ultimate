import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument, completenessReport, SCHEMAS } from "../core/validate-document.mjs";

test("validate-document: وثيقة صحيحة تعبر", () => {
  const doc = {
    id: "1100213344", title: "مشروع تطوير البنية التحتية",
    entity: "أمانة الرياض", value: "2500000", currency: "SAR",
    status: "جاري", deadline: "2026-12-01", activity: "بنية تحتية",
    url: "https://etimad.sa/tender/1100213344", source: "etimad", scraped_at: "2026-09-16T10:00:00Z",
  };
  const r = validateDocument(doc, "tender");
  assert.equal(r.valid, true);
  assert.equal(r.score, 100);
  assert.deepEqual(r.errors, []);
});

test("validate-document: حقل مطلوب ناقص → باطل مع خفض الدرجة", () => {
  const r = validateDocument({ id: "1100213344", source: "etimad" }, "tender");
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("title")));
  assert.equal(r.score, 67); // 2/3 من الحقول المطلوبة
});

test("validate-document: تحذير لا فشل لحقل قيمي شاذ", () => {
  const r = validateDocument({ id: "1100213344", name: "صب حفر", source: "etimad", url: "ftp://bad", phone: "abc" }, "contractor");
  assert.equal(r.valid, true, "العيوب الثانوية لا تفشل الوثيقة");
  assert.ok(r.warnings >= 1, "تسجل كتحذير");
});

test("validate-document: تعبيرات أنماط تعمل", () => {
  const ok = validateDocument({ id: "7001234567", name: "مقاول الشرق", source: "muqawil", email: "a@b.co", phone: "+966 55 123 4567" }, "contractor");
  const bad = validateDocument({ id: "7001234567", name: "مقاول الشرق", source: "muqawil", email: "not-an-email", phone: "x" }, "contractor");
  assert.equal(ok.valid, true);
  assert.equal(bad.valid, true);
  assert.ok(bad.warnings >= 2, "بريد وهاتف فاسدان = تحذيران");
});

test("validate-document: نموذج مجهول يُرمى", () => {
  assert.throws(() => validateDocument({}, "nope"));
});

test("completeness-report: إحصاءات الامتلاء والأسوأ", () => {
  const rows = [
    { id: "1", title: "مشروع أ", source: "etimad", value: "10" },
    { id: "2", source: "etimad" },
  ];
  const rep = completenessReport(rows, "tender");
  assert.equal(rep.count, 2);
  assert.equal(rep.fields.find((f) => f.field === "value").filled, 1);
  assert.equal(rep.fields.find((f) => f.field === "value").fillRate, 50);
  assert.equal(rep.worst[0].id, "2", "الأقل امتلاء أولاً");
  assert.equal(rep.worst[0].score, 67);
});

test("completeness-report: مخططات محددة لكل النماذج", () => {
  for (const m of ["tender", "contractor", "award", "project", "document"]) {
    assert.ok(SCHEMAS[m].required.length >= 2, m);
  }
});
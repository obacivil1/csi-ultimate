import test from "node:test";
import assert from "node:assert/strict";
import { selectAlerts, parseDeadline } from "../core/tender-alerts.mjs";

const NOW = "2026-09-16T12:00:00Z";
const mk = (id, deadline, extra = {}) => ({ id: String(id), title: `T${id}`, deadline, ...extra });

test("tender-alerts: يصنف قريبة الانتهاء والمنتهية حديثاً ويسقط البعيد", () => {
  const rows = [
    mk(1, "2026-09-20T09:00:00Z"),   // بعد 4 أيام → قريبة
    mk(2, "2026-09-16T18:00:00Z"),   // اليوم → قريبة
    mk(3, "2026-09-10T00:00:00Z"),   // قبل 6 أيام → منتهية حديثاً
    mk(4, "2026-09-07T00:00:00Z"),   // قبل 9 أيام → خارج النافذة
    mk(5, "2027-01-01T00:00:00Z"),   // بعيدة
    mk(6, ""),                       // بلا موعد
    mk(7, "garbage"),                // غير قابل للقراءة
  ];
  const out = selectAlerts(rows, { now: NOW, expiringDays: 14, expiredGraceDays: 7 });
  assert.equal(out.expiringCount, 2);
  assert.deepEqual(out.expiring.map((r) => Number(r.id)).sort(), [1, 2]);
  assert.equal(out.recentlyExpiredCount, 1);
  assert.equal(out.recentlyExpired[0].id, "3");
  assert.equal(out.recentlyExpired[0].daysAgo, 7);
  assert.equal(out.expiring[0].daysLeft, 0, "الأقرب أولاً");
});

test("tender-alerts: ترتيب تصاعدي للأقرب للمواعيد", () => {
  const rows = [
    mk(5, "2026-09-17T00:00:00Z"),
    mk(1, "2026-09-16T18:00:00Z"),
    mk(3, "2026-09-30T00:00:00Z"),
  ];
  const out = selectAlerts(rows, { now: NOW });
  assert.deepEqual(out.expiring.map((r) => r.id), ["1", "5", "3"]);
});

test("tender-alerts: parseDeadline يقبل ISO ويتجاهل الفراغ", () => {
  assert.ok(parseDeadline("2026-09-20T09:00:00Z"));
  assert.equal(parseDeadline(""), null);
  assert.equal(parseDeadline("xyz"), null);
  assert.equal(parseDeadline(null), null);
});

test("tender-alerts: نافذة قابلة للضبط (5 أيام فقط)", () => {
  const rows = [
    mk(1, "2026-09-19T00:00:00Z"), // 3 أيام
    mk(2, "2026-09-28T00:00:00Z"), // 12 يوم → خارج نافذة 5
  ];
  const out = selectAlerts(rows, { now: NOW, expiringDays: 5 });
  assert.equal(out.expiringCount, 1);
  assert.equal(out.expiring[0].id, "1");
});
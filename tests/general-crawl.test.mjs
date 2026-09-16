import test from "node:test";
import assert from "node:assert/strict";
import { parseHtmlDocument, normalizeUrl, internalLink, summarizeDocuments } from "../core/general-crawl.mjs";
import { classifyText } from "../core/topic-classifier.mjs";

const BASE = "https://example-news.test/section/index.html";

function makeArticleHtml() {
  return `<!DOCTYPE html><html><head>
    <title>أخبار الرياضة | تحديث مباشر</title>
    <meta name="description" content="ملف رياضي شامل عن مباريات الدوري">
  </head><body>
    <h1>نادي الفتح يقصى من الملعب</h1>
    <p>انتهت مباراة الدوري بهدف في وقت متأخر.</p>
    <a href="/section/other.html">مقال ثانٍ</a>
    <a href="https://external-news.example/breaking">خارجي</a>
    <img src="/assets/photo.jpg" alt="صورة">
    <table><tr><th>الفرقة</th><th>الأهداف</th></tr><tr><td>الفتح</td><td>2</td></tr></table>
  </body></html>`;
}

test("parseHtmlDocument يستخرج وثيقة منظمة من HTML", () => {
  const doc = parseHtmlDocument(makeArticleHtml(), BASE);
  assert.equal(doc.host, "example-news.test");
  assert.ok(doc.title.includes("أخبار الرياضة"));
  assert.equal(doc.metaDescription, "ملف رياضي شامل عن مباريات الدوري");
  assert.deepEqual(doc.headings, ["نادي الفتح يقصى من الملعب"]);
  assert.ok(doc.text.length > 30);
  assert.ok(doc.text.includes("مباراة الدوري"));
});

test("التمييز بين الروابط الداخلية والخارجية", () => {
  const doc = parseHtmlDocument(makeArticleHtml(), BASE);
  const internal = doc.links.filter((l) => l.internal);
  const external = doc.links.filter((l) => !l.internal);
  assert.equal(internal.length, 1);
  assert.equal(internal[0].url, "https://example-news.test/section/other.html");
  assert.equal(external.length, 1);
  assert.equal(external[0].url, "https://external-news.example/breaking");
});

test("استخراج الصور والجداول", () => {
  const doc = parseHtmlDocument(makeArticleHtml(), BASE);
  assert.equal(doc.images, 1);
  assert.equal(doc.tables.length, 1);
  assert.equal(doc.tableRows, 2);
  assert.equal(doc.tables[0].rows[1][0], "الفتح");
});

test("normalizeUrl يتجاهل البروتوكولات غير الصالحة ويحلّ المسارات النسبية", () => {
  assert.equal(normalizeUrl("/path", BASE), "https://example-news.test/path");
  assert.equal(normalizeUrl("javascript:alert(1)", BASE), null);
  assert.equal(normalizeUrl("mailto:x@y.z", BASE), null);
  assert.equal(internalLink("https://example-news.test/a", "example-news.test"), true);
  assert.equal(internalLink("https://elsewhere.test/a", "example-news.test"), false);
});

test("parseHtmlDocument يستخرج جهات تماس من HTML", () => {
  const html = `<!DOCTYPE html><html><head><title>متجر الحاج</title></head><body>
    <p>تواصل معنا على sales@haaj-shop.ae أو 0551112233</p>
    <a href="https://wa.me/971501234567">واتساب</a>
    <a href="https://www.linkedin.com/company/haaj-shop">لينكدإن</a>
  </body></html>`;
  const doc = parseHtmlDocument(html, "https://haaj-shop.ae/page/1");
  assert.equal(doc.contacts.hasAny, true);
  assert.ok(doc.contacts.emails.includes("sales@haaj-shop.ae"));
  assert.ok(doc.contacts.phones.includes("0551112233"));
  assert.ok(doc.contacts.whatsapp.includes("971501234567"));
  assert.equal(doc.contacts.social.length, 1);
});

test("extractText يمنع الالتصاق بين عناصر متجاورة (Silent Data Corruption)", () => {
  const glued = parseHtmlDocument(`<p>Contact us at muhammedahmedkk@gmail.com</p><span>talent needed</span>`, "https://t.io/1");
  assert.ok(!glued.text.includes("gmail.comtalent"), `التصاق! text="${glued.text}"`);
  assert.ok(glued.contacts.emails.includes("muhammedahmedkk@gmail.com"), "الإيميل المعزول يُستخرج سليماً");
  const mixed = parseHtmlDocument(`<div>Hello <b>world</b></div><p>Second paragraph</p>`, "https://t.io/2").text;
  assert.ok(mixed.includes("Hello"), "نص مباشر قبل عنصر متداخل لا يضيع");
  assert.ok(mixed.includes("world"));
  assert.ok(mixed.includes("Second paragraph"));
  assert.ok(!mixed.includes("Hello<b>"), "لا حدود خام داخل النص");
});

test("رسائل الرفض والمشاركة لا تُعدّ جهات تماس كاذبة", () => {
  const html = `<html><body>
    <p>لا اتصال هنا، سنة 2026، معرف 9999.</p>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">شارك</a>
  </body></html>`;
  const doc = parseHtmlDocument(html, "https://quiet.test/");
  assert.equal(doc.contacts.hasAny, false);
  assert.equal(doc.contacts.social.length, 0);
});

test("summarizeDocuments يحسب توزيع المواضيع والتجميعات", () => {
  const newsDoc = parseHtmlDocument(`<html><body><h1>أخبار عاجلة رياضية</h1><p>تقرير عن مباراة الدوري والجمهور وكرة القدم والملعب.</p></body></html>`, "https://a.test/n");
  const techDoc = parseHtmlDocument(`<html><body><h1>تقنية</h1><p>تطبيق بالذكاء الاصطناعي لأمن البيانات السحابية.</p><table><tr><td>1</td></tr></table></body></html>`, "https://b.test/t");

  const summary = summarizeDocuments([newsDoc, techDoc], classifyText);
  assert.equal(summary.totalDocs, 2);
  assert.equal(summary.hosts.length, 2);
  assert.equal(summary.totals.tableRows, 1);
  const topics = summary.topicDistribution.map((t) => t.topic);
  // كل وثيقة تُنسب لتصنيف واحد غالب
  assert.equal(summary.topicDistribution.length, 2);
  assert.equal(topics.reduce((a, b) => a + b, "") === "", false);
});
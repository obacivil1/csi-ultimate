import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { parseHtmlDocument } from "../core/general-crawl.mjs";
import { classifyText } from "../core/topic-classifier.mjs";
import { buildReport, renderHtmlReport, renderHtmlDeck, writeReportFiles, flattenDocs } from "../core/report-factory.mjs";

function sampleDocs() {
  return [
    parseHtmlDocument(`<html><body><h1>تقرير حصري عن مباراة الدوري</h1><p>كرة القدم والملعب والأهداف والجمهور لتقرير رياضي.</p></body></html>`, "https://news-x.test/match"),
    parseHtmlDocument(`<html><body><h1>تطبيق بالتقنية</h1><p>الذكاء الاصطناعي والبرمجيات السحابية لأمن البيانات.</p></body></html>`, "https://tech-x.test/app"),
  ];
}

test("buildReport يجمّع الإحصائيات والمواضيع والمضيفين", () => {
  const docs = sampleDocs();
  const report = buildReport({ title: "تقرير تجريبي", docs, classify: classifyText, sources: ["https://news-x.test"] });
  assert.equal(report.meta.format, "general-report-v1");
  assert.equal(report.stats.pages, 2);
  assert.equal(report.stats.hosts, 2);
  assert.ok(report.stats.chars > 30);
  assert.equal(report.hosts.length, 2);
  assert.equal(report.topics.length, 2);
  const t = report.topics[0];
  assert.ok(["sports", "tech"].includes(t.topic));
  assert.equal(t.count + report.topics[1].count, 2);
  assert.ok(report.docs.length === 2);
  assert.ok(report.docs.every((d) => typeof d.dominantTopic === "string" && d.dominantTopic !== ""));
});

test("flattenDocs يعمل على وثائق فارغة", () => {
  assert.deepEqual(flattenDocs([]), []);
});

test("renderHtmlReport يولّد صفحة تحتوي العنوان والبطاقات والجدول", () => {
  const report = buildReport({ title: "تقرير تجريبي", docs: sampleDocs(), classify: classifyText });
  const html = renderHtmlReport(report);
  assert.ok(html.includes("تقرير تجريبي"));
  assert.ok(html.includes("توزيع المواضيع"));
  assert.ok(html.includes("المضيفون"));
  assert.ok(html.includes("news-x.test"));
});

test("renderHtmlDeck يولّد شرائح (عرض تقديمي)", () => {
  const report = buildReport({ title: "عرض", docs: sampleDocs(), classify: classifyText });
  const deck = renderHtmlDeck(report);
  const slideCount = (deck.match(/class="slide/g) || []).length;
  assert.ok(slideCount >= 3, `cover+topics+hosts slides (got ${slideCount})`);
  assert.ok(deck.includes("class=\"slide cover\""));
});

test("writeReportFiles يكتب الصيغ الخمس", () => {
  const tmp = path.join(os.tmpdir(), "opencode", `report-test-${Date.now()}`);
  const report = buildReport({ title: "تقرير تجريبي", docs: sampleDocs(), classify: classifyText });
  const files = writeReportFiles(report, tmp);
  for (const k of ["json", "html", "deck", "csv", "xlsx"]) {
    assert.ok(fs.existsSync(files[k]), `${k} missing: ${files[k]}`);
  }
  const csv = fs.readFileSync(files.csv, "utf8");
  assert.ok(csv.split("\n")[0].includes("url"));
  const parsed = JSON.parse(fs.readFileSync(files.json, "utf8"));
  assert.equal(parsed.meta.title, "تقرير تجريبي");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("CSV يهرب القيم الحاوية على فواصل وعلامات اقتباس", () => {
  const docs = [parseHtmlDocument(`<html><head><meta name="description" content="نص, يحتوي فواصل و&quot;اقتباسات&quot;"></head><body><p>body</p></body></html>`, "https://q.test/a")];
  const report = buildReport({ title: "esc", docs });
  const tmp = path.join(os.tmpdir(), "opencode", `report-esc-${Date.now()}`);
  const files = writeReportFiles(report, tmp);
  const csv = fs.readFileSync(files.csv, "utf8");
  assert.ok(csv.includes('"نص, يحتوي فواصل و""اقتباسات"""'), "quoted+escaped cell expected");
  fs.rmSync(tmp, { recursive: true, force: true });
});
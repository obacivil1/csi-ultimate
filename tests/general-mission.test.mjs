import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { parseHtmlDocument } from "../core/general-crawl.mjs";
import { runMission } from "../core/general-mission.mjs";

function offlineDocs() {
  return [
    parseHtmlDocument(`<html><body><h1>أخبار اليوم</h1><p>تقرير وكالة عن مستجدات مراسلي الرياضة والمباريات.</p></body></html>`, "https://n.test/1"),
    parseHtmlDocument(`<html><body><h1>تقنية</h1><p>تطبيق ذكاء اصطناعي لأمن البيانات في السحابة.</p></body></html>`, "https://t.test/2"),
  ];
}

test("رحلة بدون شبكة تنتج تقريراً وملفات", async () => {
  const tmp = path.join(os.tmpdir(), "opencode", `mission-test-${Date.now()}`);
  const result = await runMission({
    _docs: offlineDocs(), urls: ["https://n.test", "https://t.test"],
    title: "رحلة تجريبية", outputDir: tmp, persist: false,
  });
  assert.equal(result.docs.length, 2);
  assert.equal(result.summary.hosts.length, 2);
  assert.equal(result.report.meta.title, "رحلة تجريبية");
  assert.ok(fs.existsSync(result.files.html));
  assert.ok(fs.existsSync(result.files.csv));
  assert.ok(fs.existsSync(result.files.xlsx));
  for (const base of Object.values(result.files)) { assert.ok(fs.existsSync(base), `missing ${base}`); }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("فلترة الرحلة بالمواضيع المطلوبة", async () => {
  const tmp = path.join(os.tmpdir(), "opencode", `mission-topic-${Date.now()}`);
  const result = await runMission({
    _docs: offlineDocs(), urls: ["https://n.test", "https://t.test"],
    topics: ["tech"], title: "تقنية فقط", outputDir: tmp, persist: false,
  });
  assert.equal(result.docs.length, 1);
  assert.equal(result.report.docs.length, 1);
  assert.equal(result.report.docs[0].host, "t.test");
  assert.equal(result.report.topics[0].topic, "tech");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("persist:true يكتب الدفعة إلى C4 مع run_id وdoc_type المحقونين", async () => {
  const tmp = path.join(os.tmpdir(), "opencode", `mission-persist-${Date.now()}`);
  const dbPath = path.join(tmp, "csi-persist.db");
  const { default: openDb } = await import("../core/db.mjs");
  const result = await runMission({
    _docs: offlineDocs(), urls: ["https://n.test", "https://t.test"],
    title: "رحلة مع كتابة", outputDir: tmp, persist: true,
    run_id: "test-run-abc", docType: "classified", dbPath,
  });
  assert.equal(result.persisted.inserted, 2);
  assert.equal(result.persisted.updated, 0);
  const db = openDb(dbPath);
  const rows = db.queryDocuments({ run_id: "test-run-abc" });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.doc_type === "classified"));
  assert.ok(rows.every((r) => r.canonical_json && typeof r.canonical_json.title === "string"));
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
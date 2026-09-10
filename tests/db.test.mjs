import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import open from "../core/db.mjs";

const tmp = path.join(os.tmpdir(), `csi-test-${process.pid}-${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });

test("db: insert and query tenders", async () => {
  const db = open(path.join(tmp, "test.db"));
  await db.importMany("tenders", [
    { id: "T1", title: "مشروع بناء", entity: "بلدية الرياض", value: 1000, status: "نشطة", deadline: "2026-12-01", source: "etimad" },
    { id: "T2", title: "صيانة طرق", entity: "وزارة النقل", value: 500, status: "منتهية", deadline: "2026-01-01", source: "etimad" },
  ]);
  assert.equal(db.count("tenders"), 2);
  const rows = db.query("tenders", { limit: 10 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "T1");
  db.close();
});

test("db: upsert does not duplicate on same id", async () => {
  const db = open(path.join(tmp, "test.db"));
  await db.importMany("tenders", [{ id: "T1", title: "محدث", entity: "X" }]);
  await db.importMany("tenders", [{ id: "T1", title: "محدث مرة أخرى", entity: "X" }]);
  assert.equal(db.count("tenders"), 2);
  const rows = db.query("tenders", { limit: 10, where: "id = ?", params: ["T1"] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "محدث مرة أخرى");
  db.close();
});

test("db: filters by status", async () => {
  const db = open(path.join(tmp, "test.db"));
  const rows = db.query("tenders", { limit: 10, where: "status = ?", params: ["منتهية"] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "T2");
  db.close();
});

test("db: stats aggregates", async () => {
  const db = open(path.join(tmp, "test.db"));
  const s = db.stats();
  assert.ok(s.tenders >= 2);
  assert.ok(s.contractors >= 0);
  db.close();
});
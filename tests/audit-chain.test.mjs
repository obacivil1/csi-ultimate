import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  eventLeaf,
  merkleRoot,
  merkleProof,
  verifyMerkleProof,
  buildChain,
  exportAudit,
  verifyAuditFile,
  stripChain,
  sha256Hex,
  signFiles,
  verifySignedFiles,
  sha256File,
} from "../core/audit-chain.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
}

test("audit-chain: canonicalJson حتمي (مفاتيح مرتبة)", () => {
  const a = canonicalJson({ b: 1, a: { y: 2, x: 1 }, arr: [3, 1, 2] });
  const b = canonicalJson({ a: { x: 1, y: 2 }, b: 1, arr: [3, 1, 2] });
  assert.equal(a, b);
  assert.ok(a.includes('"a"'));
  assert.equal(JSON.stringify({}), "{}");
});

test("audit-chain: merkleRoot ثابت لنفس الأحداث، ومستقل عن ترتيب مفاتيح الكائن", () => {
  const events = [
    { id: 1, name: "شركة أ", phones: ["0512345678"] },
    { id: 2, name: "شركة ب", phones: [] },
  ];
  // نفس المفاتيح لكن بترتيب إدراج مختلف — canonical يسوّيها
  const shuffled = events.map((e) => JSON.parse(JSON.stringify({ phones: e.phones, name: e.name, id: e.id })));
  assert.equal(merkleRoot(events), merkleRoot(shuffled));
  assert.ok(merkleRoot(events).length === 64, "جذر hex بطول 64");
});

test("audit-chain: merkleRoot فارغ يعيد سلسلة فارغة دون انهيار", () => {
  assert.equal(merkleRoot([]), "");
});

test("audit-chain: merkleProof + verifyMerkleProof صحيحان لكل عنصر", () => {
  const events = Array.from({ length: 7 }, (_, i) => ({ i, label: `e${i}` }));
  const { root, proof } = merkleProof(events, 3);
  assert.equal(root, merkleRoot(events));
  const leaf = eventLeaf(events[3]);
  assert.equal(verifyMerkleProof(leaf, proof, root), true);
  // إثبات خاطئ (ورقة من حدث آخر) يجب أن يفشل
  const badLeaf = eventLeaf(events[5]);
  assert.equal(verifyMerkleProof(badLeaf, proof, root), false);
});

test("audit-chain: buildChain يربط كل سطر بهاش السابق", () => {
  const events = [{ a: 1 }, { a: 2 }, { a: 3 }];
  const chain = buildChain(events);
  assert.equal(chain.length, 3);
  chain.forEach((ev, i) => assert.equal(ev._seq, i));
  // بصمة كل سطر مختلفة
  const hashes = new Set(chain.map((c) => c._hash));
  assert.equal(hashes.size, 3);
});

test("audit-chain: exportAudit + verifyAuditFile (NDJSON) — سليمة ثم تُكشف عند التلاعب", () => {
  const dir = tmpDir();
  const events = [
    { id: 1, company: "الشركة الأولى", city: "الرياض" },
    { id: 2, company: "الشركة الثانية", city: "جدة" },
    { id: 3, company: "الشركة الثالثة", city: "الدمام" },
  ];
  const target = path.join(dir, "report");
  const meta = exportAudit(events, target, { format: "ndjson", label: "harvest" });
  assert.equal(meta.count, 3);
  assert.equal(meta.root.length, 64);
  assert.ok(fs.existsSync(meta.file));
  assert.ok(fs.existsSync(meta.metaFile));

  const v = verifyAuditFile(meta.file);
  assert.equal(v.ok, true, `issues: ${v.issues.join("; ")}`);
  assert.equal(v.root, meta.root);

  // التلاعب: تعديل حقل في سطر → يفشل التحقق
  const lines = fs.readFileSync(meta.file, "utf8").trim().split("\n");
  const bad = JSON.parse(lines[1]);
  bad.city = "مكة المكرمة"; // تعديل غير مصرّح
  lines[1] = JSON.stringify(bad);
  fs.writeFileSync(meta.file, lines.join("\n") + "\n", "utf8");
  const v2 = verifyAuditFile(meta.file);
  assert.equal(v2.ok, false);
  assert.ok(v2.issues.some((i) => i.includes("hash mismatch")), "يكشف تعديل السطر");
});

test("audit-chain: exportAudit بصيغة JSON + تحقق", () => {
  const dir = tmpDir();
  const events = [{ id: 1, name: "x" }, { id: 2, name: "y" }];
  const meta = exportAudit(events, path.join(dir, "j"), { format: "json" });
  const v = verifyAuditFile(meta.file);
  assert.equal(v.ok, true);
  assert.equal(v.count, 2);
});

test("audit-chain: events فارغ يعمل بهدوء ويعيد ok صحيح", () => {
  const dir = tmpDir();
  const meta = exportAudit([], path.join(dir, "empty"), { format: "ndjson" });
  assert.equal(meta.count, 0);
  const v = verifyAuditFile(meta.file);
  assert.equal(v.ok, true);
});

test("audit-chain: stripChain يزيل حقول السلسلة ويعيد الأصل", () => {
  const chain = buildChain([{ id: 1 }, { id: 2 }]);
  const stripped = stripChain(chain);
  assert.deepEqual(stripped, [{ id: 1 }, { id: 2 }]);
  assert.ok(!("_hash" in stripped[0]));
});

test("audit-chain: sha256Hex متوافق مع node crypto", () => {
  const known = createHash("sha256").update("csi", "utf8").digest("hex");
  assert.equal(sha256Hex("csi"), known);
});

test("audit-chain: signFiles توقع ملفات + verifySignedFiles يتحقق ويرصد التلاعب", () => {
  const dir = tmpDir();
  const a = path.join(dir, "a.json");
  const b = path.join(dir, "b.html");
  fs.writeFileSync(a, '{"x":1}', "utf8");
  fs.writeFileSync(b, "<h1>تقرير</h1>", "utf8");

  const certPath = path.join(dir, "bundle.audit.json");
  const res = signFiles([a, b], certPath, { label: "test-report" });
  assert.equal(res.count, 2);
  assert.equal(res.root.length, 64);
  assert.ok(fs.existsSync(certPath));
  assert.equal(res.cert.files.length, 2);

  const v = verifySignedFiles(certPath);
  assert.equal(v.ok, true, `issues: ${v.issues.join("; ")}`);
  assert.deepEqual(v.checked, ["a.json", "b.html"]);

  // تعديل ملف بعد التوقيع → يكتشف
  fs.writeFileSync(a, '{"x":2}', "utf8");
  const v2 = verifySignedFiles(certPath);
  assert.equal(v2.ok, false);
  assert.ok(v2.issues.some((i) => i.includes("tampered")), "يرصد التلاعب");
});

test("audit-chain: verifySignedFiles تعامل أخطاء القراءة والتحويل", () => {
  const missing = path.join(tmpDir(), "nope.audit.json");
  const r = verifySignedFiles(missing);
  assert.equal(r.ok, false);
  assert.ok(r.issues.length > 0);

  const dir = tmpDir();
  const bad = path.join(dir, "bad.audit.json");
  fs.writeFileSync(bad, "{not-json", "utf8");
  const r2 = verifySignedFiles(bad);
  assert.equal(r2.ok, false);
});

test("audit-chain: sha256File يقرأ الملف مباشرة", () => {
  const dir = tmpDir();
  const f = path.join(dir, "x.txt");
  fs.writeFileSync(f, "abc", "utf8");
  assert.equal(sha256File(f), createHash("sha256").update("abc", "utf8").digest("hex"));
});
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GENESIS_HASH,
  createLedger,
  appendBlock,
  verifyLedgerFile,
  latestBlock,
  anchorCertificate,
  anchorLedgerPath,
  anchorCheckpointPath,
  writeCheckpoint,
  loadCheckpoint,
} from "../core/anchor-ledger.mjs";
import { signFiles } from "../core/audit-chain.mjs";

function tmpLedger() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-")), "ledger.jsonl");
}

test("anchor-ledger: كتلة أولى ترتبط بـ GENESIS و blockHash واضح", () => {
  const f = tmpLedger();
  const ledger = createLedger(f);
  const b1 = appendBlock(ledger, { merkleRoot: "a".repeat(64), label: "run1" });
  assert.equal(b1.height, 1);
  assert.equal(b1.prevHash, GENESIS_HASH);
  assert.equal(b1.blockHash.length, 64);
  const v = verifyLedgerFile(f);
  assert.equal(v.ok, true, v.issues.join("; "));
  assert.equal(v.height, 1);
  assert.equal(v.tailHash, b1.blockHash);
});

test("anchor-ledger: سلسلة متعددة — كل كتلة ترتبط بالسابقة", () => {
  const f = tmpLedger();
  const ledger = createLedger(f);
  const roots = ["b".repeat(64), "c".repeat(64), "d".repeat(64)];
  const blocks = roots.map((r) => appendBlock(ledger, { merkleRoot: r, label: `run-${r[0]}` }));
  assert.equal(blocks[1].prevHash, blocks[0].blockHash);
  assert.equal(blocks[2].prevHash, blocks[1].blockHash);
  const v = verifyLedgerFile(f);
  assert.equal(v.ok, true, v.issues.join("; "));
  assert.equal(v.height, 3);
});

test("anchor-ledger: كتلة مدسوسة تُكشف بالتحقق", () => {
  const f = tmpLedger();
  const ledger = createLedger(f);
  appendBlock(ledger, { merkleRoot: "e".repeat(64), label: "x" });
  appendBlock(ledger, { merkleRoot: "f".repeat(64), label: "y" });
  // أدخل كتلة دخيلة بجذر مختلف
  appendBlock(ledger, { merkleRoot: "9".repeat(63) + "0", label: "evil" });
  const v = verifyLedgerFile(f);
  assert.equal(v.ok, true, "سلسلة سليمة قبل التلاعب");
  // حذف الكتلة الوسطى → سلاسل مكسورة
  const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(f, [lines[0], lines[2]].join("\n") + "\n", "utf8");
  const v2 = verifyLedgerFile(f);
  assert.equal(v2.ok, false);
  assert.ok(v2.issues.length > 0, "يكشف الحذف");
});

test("anchor-ledger: إعادة ترتيب السطرين بكشف", () => {
  const f = tmpLedger();
  const ledger = createLedger(f);
  appendBlock(ledger, { merkleRoot: "0".repeat(64), label: "a" });
  appendBlock(ledger, { merkleRoot: "1".repeat(64), label: "b" });
  const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(f, [lines[1], lines[0]].join("\n") + "\n", "utf8");
  const v = verifyLedgerFile(f);
  assert.equal(v.ok, false);
});

test("anchor-ledger: سجل فارغ/غير موجود سليم, حتمية بلا انهيار", () => {
  const f = tmpLedger();
  const v = verifyLedgerFile(f);
  assert.equal(v.ok, true);
  assert.equal(v.height, 0);
  assert.equal(latestBlock(f), null);
  const missing = path.join(os.tmpdir(), "nope-ledger.jsonl");
  fs.rmSync(missing, { force: true });
  const v2 = verifyLedgerFile(missing);
  assert.equal(v2.ok, true, "سجل بكر = سليم");
  assert.equal(v2.height, 0);
});

test("anchor-ledger: anchorCertificate يثبّت جذر شهادة حقيقية في السجل", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cert-"));
  const a = path.join(dir, "a.txt");
  fs.writeFileSync(a, "data", "utf8");
  const cert = signFiles([a], path.join(dir, "bundle.audit.json"), { label: "test" });
  const { block, ledgerPath } = anchorCertificate(cert.path, { label: "test-cert" });
  assert.equal(block.merkleRoot, cert.root);
  assert.ok(fs.existsSync(ledgerPath));
  const v = verifyLedgerFile(ledgerPath);
  assert.equal(v.ok, true, v.issues.join("; "));
  fs.rmSync(ledgerPath, { force: true });
});

test("anchor-ledger: appendBlock يرفض جذراً غير صالح", () => {
  const ledger = createLedger(tmpLedger());
  assert.throws(() => appendBlock(ledger, { merkleRoot: "short" }));
  assert.throws(() => appendBlock(ledger, { merkleRoot: "Z".repeat(64) })); // ليس hex
});

test("anchor-ledger: الحتمية — نفس الجذر يعطي نفس الـ blockHash", () => {
  const f1 = tmpLedger();
  const f2 = tmpLedger();
  const h1 = appendBlock(createLedger(f1), { merkleRoot: "7".repeat(64), label: "z" }).blockHash;
  const h2 = appendBlock(createLedger(f2), { merkleRoot: "7".repeat(64), label: "z" }).blockHash;
  assert.equal(h1, h2);
});

test("anchor-ledger: anchorLedgerPath مؤكد وقابل للكتابة", () => {
  const p = anchorLedgerPath();
  assert.ok(p.endsWith("anchor_ledger.jsonl"));
});

function tmpCheckpoint() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ckpt-")), "anchor-checkpoint.json");
}

function buildLedger(f, roots) {
  const ledger = createLedger(f);
  roots.forEach((r, i) => appendBlock(ledger, { merkleRoot: r, label: `run${i}` }));
  return ledger;
}

test("anchor-ledger: writeCheckpoint يثبّت الذيل المعلوم خارجياً", () => {
  const f = tmpLedger();
  buildLedger(f, ["a".repeat(64), "b".repeat(64)]);
  const ckptFile = tmpCheckpoint();
  const ckpt = writeCheckpoint(ckptFile, f);
  assert.equal(ckpt.height, 2);
  assert.equal(ckpt.tailHash, latestBlock(f).blockHash);
  const loaded = loadCheckpoint(ckptFile);
  assert.ok(loaded, "تُقرأ من الملف");
  assert.equal(loaded.tailHash, ckpt.tailHash);
  assert.ok(!anchorCheckpointPath().includes(`state${path.sep}`), "التفتيش خارج state/");
});

test("anchor-ledger: قلب الذيل (حذف آخر كتلة) يُكشف بمقارنة التفتيش", () => {
  const f = tmpLedger();
  buildLedger(f, ["a".repeat(64), "b".repeat(64), "c".repeat(64)]);
  const ckptFile = tmpCheckpoint();
  writeCheckpoint(ckptFile, f);
  // المسرّب يحذف الكتلة الأخيرة فقط من state/ — التفتيش الخارجي لم يُمس
  const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(f, lines.slice(0, 2).join("\n") + "\n", "utf8");
  const v = verifyLedgerFile(f, ckptFile);
  assert.equal(v.ok, false, "القلب يُكشف الآن");
  const hit = v.issues.find((x) => x.includes("قلب ذيل"));
  assert.ok(hit, v.issues.join("; "));
  // بدون تفتيش خارجي كان القلب صامتاً — نثبت فجوة الإمساك التي تُغلق
  const vNoCkpt = verifyLedgerFile(f);
  assert.equal(vNoCkpt.ok, true, "بدون التفتيش كان القلب سيمر");
});

test("anchor-ledger: تفتيش مطابق يعطي تحققاً سليماً", () => {
  const f = tmpLedger();
  buildLedger(f, ["a".repeat(64), "b".repeat(64), "c".repeat(64)]);
  const ckptFile = tmpCheckpoint();
  writeCheckpoint(ckptFile, f);
  const v = verifyLedgerFile(f, ckptFile);
  assert.equal(v.ok, true, v.issues.join("; "));
});

test("anchor-ledger: تفتيش مولّف (tailHash معدّل بلا prefixHash) يُكشف", () => {
  const f = tmpLedger();
  buildLedger(f, ["a".repeat(64), "b".repeat(64)]);
  const ckptFile = tmpCheckpoint();
  writeCheckpoint(ckptFile, f);
  const ckpt = JSON.parse(fs.readFileSync(ckptFile, "utf8"));
  ckpt.tailHash = "f".repeat(64); // عُدّل بلا تحديث prefixHash
  fs.writeFileSync(ckptFile, JSON.stringify(ckpt, null, 2) + "\n", "utf8");
  const v = verifyLedgerFile(f, ckptFile);
  assert.equal(v.ok, false);
  assert.ok(v.issues.find((x) => x.includes("تالف")));
});

test("anchor-ledger: سجل ممتد بعد التفتيش = تحقق جزئي ينبّه لتحديث التفتيش", () => {
  const f = tmpLedger();
  buildLedger(f, ["a".repeat(64), "b".repeat(64)]);
  const ckptFile = tmpCheckpoint();
  writeCheckpoint(ckptFile, f); // يُثبّت عند height=2
  buildLedger(f, ["d".repeat(64)]); // امتداد لاحق إلى 3
  const v = verifyLedgerFile(f, ckptFile);
  assert.equal(v.ok, false, "التفتيش قديم ويجب تحديثه بمراجعة سليمة");
  assert.ok(v.issues.find((x) => x.includes("يمتد أبعد")));
});


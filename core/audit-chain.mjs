/**
 * audit-chain.mjs — سلسلة أدلة مشفّرة مقاومة للتلاعب (مستوحاة من N0VA Unified Audit v3.12)
 * ────────────────────────────────────────────────────────────────────────────
 * أي ناتج قابل للتصدير (تقارير، حصاد، بيانات إثراء) يُغلَّف بجذر Merkle +
 * سلسلة هاش متصلة، فيمكن إثبات أن الملف لم يُعدَّل بعد صدوره.
 *
 * الميزات:
 *   - canonicalJson: تسلسل حتمي (مفاتيح مرتبة) — نفس الإدخال → نفس البصمة دائمًا
 *   - merkleRoot: جذر Merkle فوق sha256(الحدث) — مستقل عن الصيغة
 *   - buildChain: سلسلة هاش مترابطة (كل سطر يشمل هاش السابق) = مقاومة للتلاعب
 *   - verifyFile: إعادة تحقق كاملة من ملف NDJSON/JSON + إثبات لكل حدث
 *   - تصدير NDJSON/JSON بأرقام تسلسلية موثقة
 *
 * الاستخدام (مثال):
 *   import { buildChain, merkleRoot } from "./audit-chain.mjs";
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

// ── أدوات هاش ───────────────────────────────────────────────

/**
 * signMode — أنماط التوقيع المتاحة.
 * classical_only: sha256 فقط (معيار الاعتياد).
 * dual_sign: sha256 + sha384 معاً (هجرة تدريجية — يراعى في verifySignedFiles).
 */
export const signMode = { CLASSICAL: "classical_only", DUAL: "dual_sign" };

/**
 * sha256Hex — هاش نص على شكل hex.
 * @param {string} str
 * @returns {string}
 */
export function sha256Hex(str) {
  return createHash("sha256").update(String(str), "utf8").digest("hex");
}

/**
 * sha384Hex — هاش sha384 للنص نفسه (للتوقيع الهجين).
 * @param {string} str
 * @returns {string}
 */
export function sha384Hex(str) {
  return createHash("sha384").update(String(str), "utf8").digest("hex");
}

/**
 * dualSha256_384 — هاشان (sha256 + sha384) في آن واحد.
 * يُستخدم في وضع التوقيع الهجين dual_sign.
 * @param {string} str
 * @returns {{sha256:string, sha384:string}}
 */
export function dualSha256_384(str) {
  const h256 = createHash("sha256").update(String(str), "utf8").digest("hex");
  const h384 = createHash("sha384").update(String(str), "utf8").digest("hex");
  return { sha256: h256, sha384: h384 };
}

/**
 * canonicalJson — تسلسل JSON حتمي: مفاتيح مرتبة، لا مسافات زائدة،
 * BigInt → نص. نفس المحتوى يعطي دائمًا نفس السلسلة.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return serialize(value);
}

function serialize(value) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number" || t === "boolean") return String(value);
  if (t === "bigint") return `"${value.toString()}"`;
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }
  if (t === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(value[k])}`).join(",")}}`;
  }
  return "null";
}

/**
 * eventLeaf — بصمة حدث واحد ضمن Merkle.
 * @param {object} ev
 * @returns {string}
 */
export function eventLeaf(ev) {
  return sha256Hex(canonicalJson(ev));
}

/**
 * merkleRoot — جذر Merkle فوق قائمة أحداث (ثنائي، يكرر الورقة الأخيرة عند الفرد).
 * مستقل عن الصيغة: أي صيغة تصدير لنفس الأحداث تعطى نفس الجذر.
 * @param {object[]} events
 * @returns {string}
 */
export function merkleRoot(events) {
  if (!Array.isArray(events) || events.length === 0) return "";
  let level = events.map(eventLeaf);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : a;
      next.push(sha256Hex(a + b));
    }
    level = next;
  }
  return level[0];
}

/**
 * merkleProof — إثبات اندراج حدث ضمن الجذر (قائمة أشقاء تصاعديًا).
 * Lexicographic tree لكل مستوى؛ الترتيب يحسب من موضع الحدث الأصلي.
 * @param {object[]} events
 * @param {number} index
 * @returns {{root:string, proof:Array<{hash:string,side:"left"|"right"}|null>}|null}
 */
export function merkleProof(events, index) {
  if (!Array.isArray(events) || index < 0 || index >= events.length) return null;
  let level = events.map(eventLeaf);
  let idx = index;
  const proof = [];
  while (level.length > 1) {
    const next = [];
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (siblingIdx < level.length) {
      proof.push({
        hash: level[siblingIdx],
        side: idx % 2 === 0 ? "right" : "left",
      });
    }
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : a;
      next.push(sha256Hex(a + b));
    }
    idx = idx >> 1;
    level = next;
  }
  return { root: level[0], proof };
}

/**
 * verifyMerkleProof — تطبيق الإثبات على ورقة والتحقق من الجذر.
 * @param {string} leaf
 * @param {Array<{hash:string,side:"left"|"right"}>} proof
 * @param {string} root
 * @returns {boolean}
 */
export function verifyMerkleProof(leaf, proof, root) {
  let h = leaf;
  for (const step of proof) {
    h = step.side === "left" ? sha256Hex(step.hash + h) : sha256Hex(h + step.hash);
  }
  return h === root;
}

// ── سلسلة هاش مترابطة (Chain) ───────────────────────────────

/**
 * buildChain — بناء سلسلة هاش: كل سطر يحمل هاش السابق + بصمته.
 * الناتج: مصفوفة أحداث مع حقول _seq (تسلسلي) و _hash (بصمة السطر كاملاً).
 * @param {object[]} events
 * @returns {object[]}
 */
export function buildChain(events) {
  let prevHash = "";
  return events.map((ev, i) => {
    const body = canonicalJson(ev);
    const chainHash = sha256Hex(prevHash + body);
    prevHash = chainHash;
    return { ...ev, _seq: i, _hash: chainHash };
  });
}

// ── تصدير ───────────────────────────────────────────────────

/**
 * exportAudit — تصدير أحداث بصيغة NDJSON أو JSON مع سلسلة الأدلة،
 * ويُكتب بجانبه ملف `.meta.json` يضم الجذر والمجموع والبصمات (شهادة).
 * @param {object[]} events
 * @param {string} outputPath - مسار الملف النهائي بدون الامتداد
 * @param {object} [opts]
 * @param {"ndjson"|"json"} [opts.format="ndjson"]
 * @param {string} [opts.label="audit"]
 * @returns {{file:string, metaFile:string, root:string, count:number}}
 */
export function exportAudit(events, outputPath, opts = {}) {
  const { format = "ndjson", label = "audit" } = opts;
  const chained = buildChain(events);
  const root = merkleRoot(events);
  const count = chained.length;

  const dir = path.dirname(outputPath);
  mkdirSync(dir, { recursive: true });
  const file = format === "json" ? `${outputPath}.json` : `${outputPath}.ndjson`;

  if (format === "json") {
    const doc = { schema: "csi-audit/1", label, exportedAt: new Date().toISOString(), root, count, events: chained };
    writeFileSync(file, JSON.stringify(doc, null, 2), "utf8");
  } else {
    const lines = chained.map((ev) => JSON.stringify(ev));
    writeFileSync(file, lines.join("\n") + "\n", "utf8");
  }

  const meta = { schema: "csi-audit/1", label, exportedAt: new Date().toISOString(), root, count, format };
  const metaFile = `${outputPath}.meta.json`;
  writeFileSync(metaFile, JSON.stringify(meta, null, 2), "utf8");

  return { file, metaFile, root, count };
}

// ── تحقق ────────────────────────────────────────────────────

/**
 * verifyAuditFile — إعادة تحقق من ملف مصدَّر: يتحقق من سلسلة الـ hash
 * (التسلسل والبصمات) ويتأكد أن الجذر يطابق شهادة meta إن وُجدت.
 * @param {string} filePath - مسار ملف ndjson/إخطار json المصدر
 * @param {object} [opts]
 * @param {boolean} [opts.checkMeta=true] - مقارنة الجذر بملف meta المجاور
 * @returns {{ok:boolean, count:number, root:string, issues:string[]}}
 */
export function verifyAuditFile(filePath, opts = {}) {
  const { checkMeta = true } = opts;
  const issues = [];
  const ext = path.extname(filePath).toLowerCase();
  let events = [];
  let root = "";

  try {
    const raw = readFileSync(filePath, "utf8");
    const isJsonDoc = ext === ".json" || (ext !== ".ndjson" && !raw.startsWith("[") && raw.trimStart().startsWith("{") && !raw.includes("\n"));
    if (isJsonDoc) {
      const doc = JSON.parse(raw);
      events = doc.events ?? [];
      root = doc.root ?? "";
    } else {
      events = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      root = merkleRoot(stripChain(events));
    }
  } catch (e) {
    return { ok: false, count: 0, root: "", issues: [`cannot read file: ${e.message}`] };
  }

  if (events.length === 0 && checkMeta) {
    try {
      const metaFile = filePath.replace(/(\.json|\.ndjson)$/, ".meta.json");
      const meta = JSON.parse(readFileSync(metaFile, "utf8"));
      if (meta.count !== undefined && meta.count > 0) issues.push("no events found");
    } catch {
      issues.push("no events found");
    }
  }

  // إعادة بناء السلسلة والتحقق من التسلسل + البصمات
  let prevHash = "";
  events.forEach((ev, i) => {
    const body = canonicalJson(stripChain([ev])[0]);
    const expected = sha256Hex(prevHash + body);
    prevHash = expected;
    if (ev._hash !== expected) {
      issues.push(`event[${i}] chain hash mismatch`);
    }
    if (ev._seq !== i) {
      issues.push(`event[${i}] _seq=${ev._seq} expected ${i}`);
    }
  });

  if (checkMeta) {
    const metaFile = filePath.replace(/(\.json|\.ndjson)$/, ".meta.json");
    try {
      const meta = JSON.parse(readFileSync(metaFile, "utf8"));
      if (meta.root && meta.root !== root) {
        issues.push(`root mismatch: meta=${meta.root} computed=${root}`);
      }
      if (meta.count !== undefined && meta.count !== events.length) {
        issues.push(`count mismatch: meta=${meta.count} actual=${events.length}`);
      }
    } catch {
      issues.push("meta file missing — root not cross-checked");
    }
  }

  return { ok: issues.length === 0, count: events.length, root, issues };
}

/**
 * stripChain — إزالة حقول السلسلة (_seq, _hash) لإرجاع الحدث الأصلي.
 * @param {object[]} events
 * @returns {object[]}
 */
export function stripChain(events) {
  return events.map((ev) => {
    const { _seq, _hash, ...rest } = ev;
    return rest;
  });
}

// ──signMode helpers ──────────────────────────────────────────

function _entrySha(filePath, mode) {
  const buf = readFileSync(filePath);
  const base = { file: path.basename(filePath), size: buf.length };
  if (mode === signMode.DUAL) {
    const { sha256, sha384 } = dualSha256_384(buf);
    return { ...base, sha256, sha384 };
  }
  return { ...base, sha256: sha256Hex(buf) };
}

function _eventFromEntry(ev, mode) {
  if (mode === signMode.DUAL) {
    return { file: ev.file, sha256: ev.sha256, sha384: ev.sha384, size: ev.size };
  }
  return { file: ev.file, sha256: ev.sha256, size: ev.size };
}

// ── توقيع ملفات (شهادة أدلة) ────────────────────────────────

/**
 * signFiles — يُنتج شهادة أدلة لمجموعة ملفات (تقارير/نتائج حصاد...):
 * كل ملف يُبصَّم (sha256) ثم تُبنى سلسلة هاش مترابطة + جذر Merkle،
 * وتُكتب شهادة `.audit.json` تحفظ كل البصمات. أي تعديل لاحق لأي ملف
 * يكشفه التحقق.
 *
 * @param {string[]} files - مسارات مطلقة/نسبية للملفات الموقعة
 * @param {string} certPath - مسار شهادة الأدلة (ملف JSON يُكتب)
 * @param {object} [opts]
 * @param {string} [opts.label="evidence"]
 * @returns {{cert:object, path:string, root:string, count:number}}
 */
export function signFiles(files, certPath, opts = {}) {
  const { label = "evidence", signMode: mode = signMode.CLASSICAL } = opts;
  // always build entries with sha256 + optional sha384
  const entries = (files || []).filter(Boolean).map((f) => _entrySha(f, mode));
  // chain & merkle root use the LEAN event (file+sha256+size) for determinism
  const leanEvents = entries.map((e) => ({ file: e.file, sha256: e.sha256, size: e.size }));
  const root = merkleRoot(leanEvents);
  const chain = buildChain(leanEvents);

  // cert.files: keep _seq/_hash for verification + original data + sha384 in dual mode
  const certFiles = chain.map((c, i) => ({
    file: leanEvents[i].file,
    sha256: leanEvents[i].sha256,
    size: leanEvents[i].size,
    _seq: c._seq,
    _hash: c._hash,
    ...(mode === signMode.DUAL ? { sha384: entries[i].sha384 } : {})
  }));

  const cert = {
    schema: "csi-evidence/1",
    label,
    generatedAt: new Date().toISOString(),
    root,
    count: chain.length,
    signMode: mode,
    files: certFiles,
  };

  mkdirSync(path.dirname(certPath), { recursive: true });
  writeFileSync(certPath, JSON.stringify(cert, null, 2), "utf8");
  return { cert, path: certPath, root, count: chain.length };
}

/**
 * sha256File — هاش sha256 لمحتوى ملف (سلسلة Buffer أصيلة).
 * @param {string} filePath
 * @returns {string}
 */
export function sha256File(filePath) {
  return sha256Hex(readFileSync(filePath));
}

/**
 * verifySignedFiles — تحقق شهادة أدلة: يقرأ كل ملف موقّع من القرص،
 * يعيد حساب بصمته، ويتأكد تطابق البصمات + سلامة السلسلة + الجذر.
 *
 * @param {string} certPath - مسار `.audit.json`
 * @returns {{ok:boolean, issues:string[], count:number, root:string, checked:string[]}}
 */
export function verifySignedFiles(certPath) {
  const issues = [];
  const dir = path.dirname(certPath);

  let cert;
  try {
    cert = JSON.parse(readFileSync(certPath, "utf8"));
  } catch (e) {
    return { ok: false, issues: [`cannot read certificate: ${e.message}`], count: 0, root: "", checked: [] };
  }

  const files = cert.files || [];
  const checked = [];

  // 1) كل ملف موجود وبصمته مطابقة
  for (const ev of files) {
    const full = path.resolve(dir, ev.file);
    checked.push(ev.file);
    if (!existsSync(full)) {
      issues.push(`missing file: ${ev.file}`);
      continue;
    }
    const actual = sha256File(full);
    // verify sha256
    if (actual !== ev.sha256) {
      issues.push(`tampered file: ${ev.file} (${actual.slice(0, 12)} ≠ ${ev.sha256.slice(0, 12)})`);
    }
    // في وضع التوقيع اله dual_sign: التحقق من sha384 كذلك
    if (cert.signMode === signMode.DUAL && actual !== ev.sha384) {
      issues.push(`tampered (sha384): ${ev.file} (sha384 mismatch)`);
    }
  }

  // 2) سلسلة الهاش مترابطة ومطابقة للجذر
  let prevHash = "";
  files.forEach((ev, i) => {
    const body = canonicalJson({ file: ev.file, sha256: ev.sha256, size: ev.size });
    const expected = sha256Hex(prevHash + body);
    prevHash = expected;
    if (ev._hash !== expected) issues.push(`chain[${i}] hash mismatch`);
    if (ev._seq !== i) issues.push(`chain[${i}] _seq=${ev._seq}`);
  });

  const computedRoot = merkleRoot(files.map((ev) => ({ file: ev.file, sha256: ev.sha256, size: ev.size })));
  if (computedRoot !== cert.root) issues.push(`root mismatch: cert=${cert.root} computed=${computedRoot}`);

  return { ok: issues.length === 0, issues, count: files.length, root: cert.root, checked };
}
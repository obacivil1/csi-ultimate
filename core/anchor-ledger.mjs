/**
 * anchor-ledger.mjs — سجل Anchors متسلسل (مستوحى من N0VA v3.22 Distributed Consensus)
 * ────────────────────────────────────────────────────────────────────────────
 * فكرة v3.22 المنقولة: بدل "بنك تحالف أو Bitcoin" (لا يخص سكرابراً مستقلاً)،
 * نُنشئ سجلّ Anchors تراكمياً: كل شهادة أدلة (`.audit.json`) تُربط كـ"كتلة"
 * بسلسلة هاش — الكتلة t تحمل blockHash = sha256(prevHash + المحتوى).
 * النتيجة: تاريخ واحد غير قابل للكسر لكل ما صدّقناه؛ أي حذف/إعادة ترتيب/
 * تغيير للكتلة الماضية يُكشف فوراً بالتحقق. (هذا هو "External Anchor" المحلي:
 * لا نقطة فشل واحدة — إعادة بناء من أي نسخة احتياطية تكشف التلاعب.)
 *
 * البنية:
 *   state/anchor_ledger.jsonl   - سطر JSON لكل كتلة {height, prevHash, blockHash,
 *                                 merkleRoot, label, ref, producedAt}
 *   GENESIS_HASH                - ثابت حتمي؛ أول كتلة ترتبط به.
 *
 * الاستخدام:
 *   const { anchorCertificate, verifyLedgerFile } = await import("./anchor-ledger.mjs");
 *   anchorCertificate("output/x.audit.json", { label: "leadgen" });
 *   verifyLedgerFile(anchorLedgerPath());   // → {ok, issues, height, tailHash}
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GENESIS_HASH = createHash("sha256").update("csi-ultimate-anchor-genesis-v1", "utf8").digest("hex");

/** الموقع الافتراضي لسجل الأنكرس */
export function anchorLedgerPath() {
  return path.resolve(__dirname, "..", "state", "anchor_ledger.jsonl");
}

/**
 * موقع نقطة التفتيش الخارجية (خارج state/ عمداً):
 * أي مسرّب يحذف/يقلّم state/anchor_ledger.jsonl وحده لن يصيب هذا الملف،
 * وملف التفتيش يفضح القلب (الحذف من الذيل).
 */
export function anchorCheckpointPath() {
  return path.resolve(__dirname, "..", "checkpoints", "anchor-checkpoint.json");
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** تسلسل حتمي لمحتوى الكتلة (بدون blockHash نفسه) */
function canonicalBlock({ height, merkleRoot, label, ref }) {
  return JSON.stringify({ height, merkleRoot, label: label ?? "", ref: ref ?? null });
}

/**
 * createLedger — يحمّل كتلاً محفوظة (إن وُجد الملف) أو يبدأ فارغاً.
 * أي خلل في تحليل الملف → خطأ صريح (لا نبدأ دفتراً جديداً فوق تاريخ مكسور).
 * @param {string} [filePath] - افتراضياً anchorLedgerPath()
 * @returns {{file:string, blocks:object[], height:number}}
 */
export function createLedger(filePath = anchorLedgerPath()) {
  const blocks = [];
  if (fs.existsSync(filePath)) {
    let text = fs.readFileSync(filePath, "utf8");
    // وسّع بعض الأدوات (PowerShell قديم) BOM عند الكتابة — نتجاهلها بلا مشاكل
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
      try {
        blocks.push(JSON.parse(line));
      } catch (e) {
        throw new Error(`anchor-ledger: سطر ${i + 1} تالف (${e.message}) — لا نستأنف فوقه`);
      }
    }
  }
  return { file: filePath, blocks, height: blocks.length };
}

/**
 * appendBlock — يضيف كتلة مرتبطة بالكتلة السابقة (سطر JSONL) ويعيد الكتلة.
 * @param {object} ledger
 * @param {object} opts
 * @param {string} opts.merkleRoot
 * @param {string} [opts.label]
 * @param {string|number|null} [opts.ref]
 * @returns {object}
 */
export function appendBlock(ledger, opts = {}) {
  const { merkleRoot, label, ref } = opts;
  if (!merkleRoot || !/^[0-9a-f]{64}$/i.test(String(merkleRoot))) {
    throw new Error(`anchor-ledger: merkleRoot غير صالح: ${merkleRoot}`);
  }
  const height = ledger.height + 1;
  const prevHash = height === 1 ? GENESIS_HASH : ledger.blocks[ledger.height - 1].blockHash;
  const block = {
    height,
    prevHash,
    blockHash: sha256Hex(prevHash + "|" + canonicalBlock({ height, merkleRoot, label, ref })),
    merkleRoot: String(merkleRoot),
    label: label ?? "",
    ref: ref ?? null,
    producedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(ledger.file), { recursive: true });
  fs.appendFileSync(ledger.file, JSON.stringify(block) + "\n", "utf8");
  ledger.blocks.push(block);
  ledger.height = height;
  return block;
}

/**
 * loadCheckpoint — يقرأ نقطة تفتيش خارجية إن وُجدت وحللتها.
 * @param {string} [filePath] - افتراضياً anchorCheckpointPath()
 * @returns {object|null}
 */
export function loadCheckpoint(filePath = anchorCheckpointPath()) {
  try {
    const c = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (c && Number.isInteger(c.height) && typeof c.tailHash === "string") return c;
    return null;
  } catch {
    return null;
  }
}

/**
 * writeCheckpoint — يكتب نقطة تفتيش خارجية بأنصع ذيل معلوم.
 * الهدف نمط v3.22 "External Anchor": المحتوى الكامل يُحفظ داخل السجل،
 * والنقطة المرجعية (height + tailHash) تُحفظ في ملف آخر خارج state/.
 * قلّم شخصُ الذيل في state/ وحده → height سيقصر عن checkpoint → يُكشف.
 * @param {string} [filePath] - افتراضياً anchorCheckpointPath()
 * @param {string} [ledgerPath] - السجل المنسوخ منه (افتراضياً anchorLedgerPath())
 * @returns {{schema:string, height:number, tailHash:string, prefixHash:string, updatedAt:string}}
 */
export function writeCheckpoint(filePath = anchorCheckpointPath(), ledgerPath = anchorLedgerPath()) {
  const ledger = createLedger(ledgerPath);
  const tailHash = ledger.height === 0 ? GENESIS_HASH : ledger.blocks[ledger.height - 1].blockHash;
  const ckpt = {
    schema: "csi-anchor-checkpoint/1",
    height: ledger.height,
    tailHash,
    prefixHash: sha256Hex(`ckpt:${ledger.height}:${tailHash}`),
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(ckpt, null, 2) + "\n", "utf8");
  return ckpt;
}

/**
 * verifyLedgerFile — يعيد بناء السلسلة كاملة ويُطابق كل كتلة.
 * يكشف: حذفاً، إعادة ترتيب، تعديلاً لأي حقل، أو إدخال كتلة دخيلة.
 * @param {string} filePath
 * @param {string|null} [checkpointPath] - نقطة تفتيش خارجية للكشف عن الحذف من الذيل (يعمل حتى لو السجل فارغ/مفقود)
 * @returns {{ok:boolean, issues:string[], height:number, tailHash:string}}
 */
export function verifyLedgerFile(filePath = anchorLedgerPath(), checkpointPath = null) {
  const issues = [];

  let blocks = [];
  if (fs.existsSync(filePath)) {
    try {
      blocks = createLedger(filePath).blocks;
    } catch (e) {
      return { ok: false, issues: [e.message], height: 0, tailHash: "" };
    }
  }

  let prevHash = GENESIS_HASH;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.height !== i + 1) issues.push(`block[${i}] height=${b.height} ≠ ${i + 1}`);
    if (b.prevHash !== prevHash) issues.push(`block[${i}] prevHash مكسور`);
    const expected = sha256Hex(b.prevHash + "|" + canonicalBlock(b));
    if (b.blockHash !== expected) issues.push(`block[${i}] blockHash لا يطابق المحتوى`);
    prevHash = b.blockHash;
  }

  // تحقق خارجي (نمط N0VA v3.22 External Anchor): الذيل المعلوم خارج state/
  if (checkpointPath) {
    const ckpt = loadCheckpoint(checkpointPath);
    if (!ckpt) {
      issues.push(`نقطة التفتيش غير قابلة للقراءة أو مفقودة: ${checkpointPath}`);
    } else {
      const prefixOk = createHash("sha256").update(`ckpt:${ckpt.height}:${ckpt.tailHash}`, "utf8").digest("hex") === ckpt.prefixHash;
      if (!prefixOk) {
        issues.push("ملف التفتيش تالفٌ داخلياً (prefixHash لا يطابق height/tailHash)");
      }
      if (blocks.length < ckpt.height) {
        issues.push(
          `قلب ذيل: السجل height=${blocks.length} أقصر من نقطة التفتيش height=${ckpt.height}`,
        );
      } else if (ckpt.height >= 1) {
        const pinned = blocks[ckpt.height - 1];
        if (!pinned || pinned.blockHash !== ckpt.tailHash) {
          issues.push("نقطة التفتيش غير موجودة في السلسلة (تلاعب أو سجل مختلف)");
        } else if (blocks.length > ckpt.height) {
          issues.push(
            `تحقق جزئي: السجل (height=${blocks.length}) يمتد أبعد من التفتيش (height=${ckpt.height}) ` +
              `والذيل الحالي ${prevHash.slice(0, 12)}… — حدّث نقطة التفتيش بعد مراجعة سليمة`,
          );
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    height: blocks.length,
    tailHash: prevHash,
  };
}

/**
 * latestBlock — آخر كتلة (أو null إذا السجل فارغ).
 */
export function latestBlock(filePath = anchorLedgerPath()) {
  const { blocks } = createLedger(filePath);
  return blocks.length ? blocks[blocks.length - 1] : null;
}

/**
 * anchorCertificate — يربط جذر شهادة أدلة في السجل الافتراضي ويعيد الكتلة،
 * ويحدّث نقطة التفتيش الخارجية تلقائياً.
 *   شهادة `.audit.json` تحمل حقلاً root → هذا الجذر هو ما يُثبَّت.
 * @param {string} certPath - مسار `.audit.json`
 * @param {object} [opts]
 * @param {string} [opts.label]
 * @param {string|number|null} [opts.ref]
 * @param {string|false} [opts.checkpoint] - نقطة تفتيش تُحدَّث بعد الإضافة (افتراضياً auto)
 * @returns {{block:object, ledgerPath:string, checkpoint:object}}
 */
export function anchorCertificate(certPath, opts = {}) {
  const cert = JSON.parse(fs.readFileSync(certPath, "utf8"));
  const merkleRoot = cert.root;
  if (!merkleRoot) throw new Error(`anchor-ledger: ${certPath} لا يحمل جذر root`);
  const ledgerPath = anchorLedgerPath();
  const ledger = createLedger(ledgerPath);
  const block = appendBlock(ledger, { merkleRoot, label: opts.label ?? cert.label ?? "", ref: opts.ref });
  let checkpoint = null;
  if (opts.checkpoint !== false) checkpoint = writeCheckpoint(opts.checkpoint || anchorCheckpointPath(), ledgerPath);
  return { block, ledgerPath, checkpoint };
}

export default {
  GENESIS_HASH, anchorLedgerPath, anchorCheckpointPath,
  createLedger, appendBlock, verifyLedgerFile, latestBlock, anchorCertificate,
  writeCheckpoint, loadCheckpoint,
};
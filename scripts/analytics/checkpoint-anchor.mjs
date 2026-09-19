/**
 * checkpoint-anchor.mjs — تحديث نقطة التفتيش الخارجية لسجل الأنكرس (نمط v3.22 External Anchor)
 * ────────────────────────────────────────────────────────────────────────────
 *  يكتب `checkpoints/anchor-checkpoint.json` (خارج state/) بنسخة من الذيل المعلوم
 *  (height + tailHash). بعدها أي قلب/حذف لكتلة من السجل يُكشف بمقارنة التفتيش.
 *  يرفض الكتابة فوق سجل مكسور — لا "نقطة تفتيش كاذبة".
 *
 *  الاستعمال:
 *    npm run checkpoint:anchor
 *    node scripts/analytics/checkpoint-anchor.mjs
 */
import fs from "fs";
import path from "path";
import { anchorLedgerPath, anchorCheckpointPath, verifyLedgerFile, writeCheckpoint } from "../../core/anchor-ledger.mjs";

const ledgerPath = anchorLedgerPath();
const v = verifyLedgerFile(ledgerPath);
if (!v.ok) {
  console.error(`✗ ${path.relative(".", ledgerPath)} — سلسلة مكسورة (${v.height} كتلة)`);
  for (const issue of v.issues) console.error(`    • ${issue}`);
  console.error("السجل مكسور — لا أنشئ نقطة تفتيش فوقه. صحّح التلاعب أو استعد من نسخة احتياطية ثم أعد المحاولة.");
  process.exit(1);
}

const ckptFile = anchorCheckpointPath();
const ckpt = writeCheckpoint(ckptFile, ledgerPath);
console.log(`✓ تفتيش خارجي مكتوب: ${path.relative(".", ckptFile)}`);
console.log(`    height=${ckpt.height}  الذيل ${ckpt.tailHash.slice(0, 12)}…  ${ckpt.updatedAt}`);
console.log("الآن النقطة المرجعية تحرس السجل: قلب أي كتلة سابقة (بما فيها قلب الذيل) يُكشف بالتحقق.");
/**
 * verify-audit.mjs — تحقق شهادات الأدلة (`.audit.json`) للتقارير والنتائج
 * ────────────────────────────────────────────────────────────────────────────
 *  ملف بسيط يتحقق من سلامة أي مجموعة ملفات موقعة بالتوقيع المشفّر
 *  (سلسلة هاش + جذر Merkle). يعيد خروجاً 0 عند النجاح، 1 عند أي تلاعب.
 *
 *  الاستعمال:
 *    node scripts/analytics/verify-audit.mjs <ملف|مجلد...>        (مسار واحد أو أكثر)
 *    node scripts/analytics/verify-audit.mjs ./output/reports     (كل الشهادات فيه)
 *    node scripts/analytics/verify-audit.mjs ./output/reports/x.audit.json
 *
 *  مثال حي:
 *    node scripts/analytics/verify-audit.mjs ./output/leadgen
 */
import fs from "fs";
import path from "path";
import { verifySignedFiles } from "../../core/audit-chain.mjs";
import { verifyLedgerFile, anchorLedgerPath, anchorCheckpointPath, loadCheckpoint } from "../../core/anchor-ledger.mjs";

function findCerts(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) return { path: p, error: "غير موجود" };
  const stats = fs.statSync(abs);
  if (stats.isFile()) return abs.endsWith(".audit.json") ? [{ path: abs }] : [];
  if (stats.isDirectory()) {
    const found = [];
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith(".audit.json")) found.push({ path: path.join(abs, f) });
    }
    return found;
  }
  return [];
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("الاستعمال: node scripts/analytics/verify-audit.mjs <ملف|مجلد...>");
  process.exit(2);
}

let total = 0, ok = 0, bad = 0;

for (const t of targets) {
  const abs = path.resolve(t);
  // سجل أنكرس (‎.jsonl) → تحقق سلسلة الكتل + نقطة التفتيش الخارجية إن وُجدت
  if (fs.existsSync(abs) && fs.statSync(abs).isFile() && abs.endsWith(".jsonl")) {
    total++;
    const isDefaultLedger = path.resolve(abs) === path.resolve(anchorLedgerPath());
    const ckptFile = isDefaultLedger && fs.existsSync(anchorCheckpointPath())
      ? anchorCheckpointPath()
      : null;
    const r = verifyLedgerFile(abs, ckptFile);
    if (r.ok) {
      ok++;
      const ck = ckptFile ? loadCheckpoint(ckptFile) : null;
      const ckInfo = ck ? ` | تفتيش خارجي height=${ck.height} ✓` : (isDefaultLedger ? " | (لا تفتيش خارجي بعد — شغّل npm run checkpoint:anchor)" : "");
      console.log(`✓ ${path.relative(".", abs)} — ${r.height} كتلة موثّقة، الذيل ${r.tailHash.slice(0, 12)}…${ckInfo}`);
    } else {
      bad++;
      console.log(`✗ ${path.relative(".", abs)} — سلسلة مكسورة: (${r.height} كتلة)`);
      for (const issue of r.issues) console.log(`    • ${issue}`);
    }
    continue;
  }

  const certs = findCerts(t);
  if (!certs.length) { console.log(`(${t}) لا شهادات هنا`); continue; }
  for (const c of certs) {
    total++;
    const r = verifySignedFiles(c.path);
    if (r.ok) {
      ok++;
      console.log(`✓ ${path.relative(".", c.path)} — ${r.count} ملف موقّع، الجذر ${r.root.slice(0, 12)}…`);
    } else {
      bad++;
      console.log(`✗ ${path.relative(".", c.path)} — تلاعب مشتبه: (${r.count} ملف موقّع)`);
      for (const issue of r.issues) console.log(`    • ${issue}`);
    }
  }
}

console.log(`\n== خلاصة: ${total} شهادة | ${ok} سليمة | ${bad} تلاعب`);
process.exit(bad ? 1 : 0);
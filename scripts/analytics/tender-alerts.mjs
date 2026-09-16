/**
 * tender-alerts.mjs — تنبيهات مواعيد المنادايات (قراءة فقط)
 * ──────────────────────────────────────────────────────────
 *  يقرأ tenders من csi.db ويستخرج: المنادايات النشطة التي تنتهي خلال
 *  الجدول الزمني (افتراضياً 14 يوماً) والمنتهية حديثاً (7 أيام)، يكتب
 *  JSON + CSV بصيغة UTC-8 ليتيع بشكل صحيح في Excel.
 *
 *  التشغيل:
 *    node scripts/analytics/tender-alerts.mjs                 (الافتراضيات)
 *    node scripts/analytics/tender-alerts.mjs --days 7 --grace 3
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { selectAlerts } from "../../core/tender-alerts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", "..", "data", "csi.db");
const OUT_DIR = path.resolve(__dirname, "..", "..", "state", "alerts");

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
};
const days = flag("--days", 14);
const grace = flag("--grace", 7);

const db = new Database(DB_PATH, { readonly: true });
const rows = db.prepare(
  `SELECT id, title, entity, status, deadline, url, value, currency FROM tenders WHERE deadline IS NOT NULL AND deadline <> ''`,
).all();
db.close();

const out = selectAlerts(rows, { expiringDays: days, expiredGraceDays: grace });

fs.mkdirSync(OUT_DIR, { recursive: true });
const date = out.generatedAt.slice(0, 10);
const jsonPath = path.join(OUT_DIR, `tenders-${date}.json`);
const csvPath = path.join(OUT_DIR, `tenders-${date}.csv`);
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), "utf8");

// CSV للعربي مع BOM
function esc(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const header = "id,title,entity,status,deadline,url,value,currency,daysLeft,alertType\n";
const lines = [
  ...out.expiring.map((r) => [r.id, r.title, r.entity, r.status, r.deadline, r.url, r.value, r.currency, r.daysLeft, "قريبة الانتهاء"]),
  ...out.recentlyExpired.map((r) => [r.id, r.title, r.entity, r.status, r.deadline, r.url, r.value, r.currency, -r.daysAgo, "انتهت حديثاً"]),
].map((r) => r.map(esc).join(",") + "\n");
fs.writeFileSync(csvPath, "\uFEFF" + header + lines.join(""), "utf8");

console.log(`\n⏰ تنبيهات ${date} — منادايات قريبة الانتهاء (${days} يوم): ${out.expiringCount} | انتهت حديثاً (${grace} أيام): ${out.recentlyExpiredCount}`);

const bands = {};
for (const r of out.expiring) bands[r.daysLeft] = (bands[r.daysLeft] || 0) + 1;
console.log("   توزيع الأيام المتبقية:", Object.entries(bands).sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}ي=${n}`).join(", "));

if (out.expiring.length) {
  console.log("\n   أقرب 3 منادايات:");
  for (const r of out.expiring.slice(0, 3)) {
    console.log(`   - [${r.daysLeft} يوم] ${String(r.title).slice(0, 60)} (${r.entity})`);
  }
}
console.log(`\n✓ مكتوب: ${jsonPath}`);
console.log(`✓ مكتوب: ${csvPath}`);
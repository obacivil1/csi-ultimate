/**
 * field-completeness.mjs — تقرير اكتمال الحقول عبر csi.db (قراءة فقط)
 * ──────────────────────────────────────────────────────────────────
 *  قراءة بيانات البيانات الحية (تندرات/مقاولات/جوائز/مشاريع) وحساب نسبة
 *  امتلاء كل عمود + درجة الاكتمال الناتجة، مع أسوأ السجلات جودةً.
 *  لا يكتب إلى قاعدة البيانات أبداً — المخرجات في state/analytics/.
 *
 *  التشغيل:  node scripts/analytics/field-completeness.mjs
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SCHEMAS, completenessReport } from "../../core/validate-document.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", "..", "data", "csi.db");
const OUT_DIR = path.resolve(__dirname, "..", "..", "state", "analytics");

const TABLE_TO_MODEL = { tenders: "tender", contractors: "contractor", awards: "award", projects: "project", documents: "document" };

if (!fs.existsSync(DB_PATH)) {
  console.error(`✗ لا توجد قاعدة بيانات: ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
const report = { generatedAt: new Date().toISOString(), tables: [] };

for (const [table, model] of Object.entries(TABLE_TO_MODEL)) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) continue;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const schemaFields = Object.keys(SCHEMAS[model].fields).concat(
    SCHEMAS[model].required.filter((f) => !(f in SCHEMAS[model].fields)),
  );
  const usableCur = schemaFields.filter((f) => cols.includes(f));
  const select = usableCur.length ? `SELECT ${usableCur.join(",")}, id FROM ${table}` : `SELECT id FROM ${table}`;
  const rows = db.prepare(select).all();
  const cr = completenessReport(rows, model);
  const coverage = schemaFields.length ? Math.round((usableCur.length / schemaFields.length) * 100) : 0;
  report.tables.push({ table, model, ...cr, coveredColumns: usableCur, schemaCoveragePct: coverage, columnsInTable: cols.length });

  console.log(`\n== ${table} (${model}) — ${cr.count} سجل — درجة: ${cr.overallScore}% ==`);
  for (const f of cr.fields) {
    const missing = cr.count - f.filled;
    const flag = f.fillRate < 100 ? (f.fillRate < 60 ? "  ▲ ناقص كثيراً" : "  ○ ناقص") : "  ✓";
    console.log(`  ${f.field.padEnd(10)} ${String(f.fillRate).padStart(3)}%  (ناقص ${missing})${flag}`);
  }
  if (cr.worst.length) {
    console.log("  أسوأ السجلات:");
    for (const w of cr.worst) console.log(`    - id=${w.id}  صحة مطلوبة=${w.score}%`);
  }
}

db.close();

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, "field-completeness.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
console.log(`\n✓ تقرير مكتوب: ${out}`);
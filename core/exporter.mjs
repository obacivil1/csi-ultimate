/**
 * ============================================================
 *  CSI-Ultimate — Multi-Format Exporter
 *  Stage 4: تصدير متعدد الصيغ (Excel + JSON + CSV)
 *  core/exporter.mjs
 * ============================================================
 */

import { writeFileSync, mkdirSync } from "fs";
import * as XLSX from "xlsx";

// ============================================================
//  الأعمدة الثابتة
// ============================================================

const HEADERS_AR = [
  "رقم الإعلان", "العنوان",     "الوصف",
  "الهواتف",     "الإيميلات",  "واتساب",
  "الموقع",      "السعر/الراتب","الشركة",
  "الفئة",       "تاريخ النشر", "الرابط",
];

const HEADERS_EN = [
  "adId", "title",    "description",
  "phones","emails",  "whatsapp",
  "location","price", "company",
  "category","postedDate","url",
];

// ============================================================
//  مساعد: اسم الملف
// ============================================================

function buildFilename(label, ext, outputDir = "./output") {
  mkdirSync(outputDir, { recursive: true });
  const safeName  = label.replace(/[^\w\u0600-\u06FF]/g, "_").slice(0, 30);
  const timestamp = new Date().toISOString().slice(0, 16).replace("T","_").replace(":","");
  return `${outputDir}/${safeName}_${timestamp}.${ext}`;
}

// ============================================================
//  exportExcel
// ============================================================

/**
 * @param {object[]} records
 * @param {string}   label
 * @param {object}   [opts]
 * @param {boolean}  [opts.freeze]   - تجميد الصف الأول (افتراضي: true)
 * @param {boolean}  [opts.autofilter] - فلتر تلقائي (افتراضي: true)
 * @returns {string} filepath
 */
export function exportExcel(records, label, opts = {}) {
  const { freeze = true, autofilter = true, outputDir, language = "en" } = opts;
  const filepath = buildFilename(label, "xlsx", outputDir);
  const headers  = language === "ar" ? HEADERS_AR : HEADERS_EN;

  const rows = records.map(r => HEADERS_EN.map(k => r[k] ?? ""));
  const ws   = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // عرض الأعمدة
  ws["!cols"] = [
    {wch:12},{wch:45},{wch:70},
    {wch:30},{wch:35},{wch:35},
    {wch:20},{wch:18},{wch:28},
    {wch:25},{wch:18},{wch:55},
  ];

  // تجميد الصف الأول
  if (freeze) {
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  }

  // فلتر تلقائي
  if (autofilter) {
    ws["!autofilter"] = { ref: ws["!ref"] };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ads");
  XLSX.writeFile(wb, filepath);

  return filepath;
}

// ============================================================
//  exportJSON
// ============================================================

/**
 * @param {object[]} records
 * @param {string}   label
 * @param {object}   [opts]
 * @param {boolean}  [opts.pretty] - تنسيق جميل (افتراضي: true)
 * @returns {string} filepath
 */
export function exportJSON(records, label, opts = {}) {
  const { pretty = true, outputDir } = opts;
  const filepath = buildFilename(label, "json", outputDir);

  const data = {
    exportedAt: new Date().toISOString(),
    label,
    total: records.length,
    records,
  };

  writeFileSync(filepath, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), "utf8");
  return filepath;
}

// ============================================================
//  exportCSV
// ============================================================

/**
 * @param {object[]} records
 * @param {string}   label
 * @returns {string} filepath
 */
export function exportCSV(records, label, outputDir) {
  const filepath = buildFilename(label, "csv", outputDir);

  const escape = (val) => {
    if (val === null || val === undefined) return "";
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [
    HEADERS_EN.join(","),
    ...records.map(r => HEADERS_EN.map(k => escape(r[k] ?? "")).join(",")),
  ];

  writeFileSync(filepath, "\uFEFF" + lines.join("\n"), "utf8"); // BOM لدعم العربية في Excel
  return filepath;
}

// ============================================================
//  exportIntegrityCheck — التحقق من سلامة التصدير
// ============================================================

export function exportIntegrityCheck(records) {
  const issues = [];

  if (records.length === 0) {
    issues.push("No records to export");
    return { ok: false, issues };
  }

  const requiredFields = ["title", "url"];
  for (const field of requiredFields) {
    const missing = records.filter(r => !r[field]);
    if (missing.length > 0) {
      issues.push(`${missing.length} records missing "${field}"`);
    }
  }

  const emptyDescs = records.filter(r => !r.description || r.description.length < 10);
  if (emptyDescs.length > records.length * 0.5) {
    issues.push(`${emptyDescs.length}/${records.length} records have no description`);
  }

  const emptyPrices = records.filter(r => !r.price);
  if (emptyPrices.length > records.length * 0.5) {
    issues.push(`${emptyPrices.length}/${records.length} records have no price`);
  }

  return { ok: issues.length === 0, issues };
}

// ============================================================
//  exportAll — تصدير بكل الصيغ دفعة واحدة
// ============================================================

/**
 * @param {object[]} records
 * @param {string}   label
 * @param {object}   [opts]
 * @param {boolean}  [opts.excel]  (افتراضي: true)
 * @param {boolean}  [opts.json]   (افتراضي: false)
 * @param {boolean}  [opts.csv]    (افتراضي: false)
 * @returns {{excel?:string, json?:string, csv?:string}}
 */
export function exportAll(records, label, opts = {}) {
  const {
    excel = true,
    json  = false,
    csv   = false,
    outputDir,
    language,
  } = opts;

  const files = {};

  if (excel && records.length > 0) {
    files.excel = exportExcel(records, label, { outputDir, language });
  }
  if (json && records.length > 0) {
    files.json = exportJSON(records, label, { outputDir });
  }
  if (csv && records.length > 0) {
    files.csv = exportCSV(records, label, outputDir);
  }

  return files;
}

// ============================================================
//  printSummary — ملخص موحّد قابل لإعادة الاستخدام
// ============================================================

/**
 * @param {object[]} records
 * @param {string}   label
 * @param {object}   [files]    - من exportAll()
 * @param {object}   [poolStats]
 */
export function printSummary(records, label, files = {}, poolStats = null) {
  const withPhone = records.filter(r => r.phones).length;
  const withEmail = records.filter(r => r.emails).length;
  const withWa    = records.filter(r => r.whatsapp).length;
  const withDesc  = records.filter(r => (r.description?.length || 0) > 10).length;
  const fromCache = records.filter(r => r._fromCache).length;
  const skipped   = records.filter(r => r._skipped).length;

  console.log("\n" + "═".repeat(58));
  console.log(`  📊 النتيجة — ${label}`);
  console.log("═".repeat(58));
  console.log(`  إجمالي مُستخرج : ${records.length}`);
  if (fromCache > 0) console.log(`  💾 من cache    : ${fromCache}`);
  if (skipped  > 0) console.log(`  ♻️  مكرر محذوف : ${skipped}`);
  console.log(`  📞 بأرقام      : ${withPhone}`);
  console.log(`  📧 بإيميل      : ${withEmail}`);
  console.log(`  💬 بواتساب     : ${withWa}`);
  console.log(`  📝 بوصف        : ${withDesc}`);
  if (poolStats?.recycled != null)
    console.log(`  🔄 Pool        : ${poolStats.recycled} context جُدِّد`);
  if (files.excel) console.log(`  📁 Excel       : ${files.excel}`);
  if (files.json)  console.log(`  📋 JSON        : ${files.json}`);
  if (files.csv)   console.log(`  📄 CSV         : ${files.csv}`);
  console.log("═".repeat(58) + "\n");
}

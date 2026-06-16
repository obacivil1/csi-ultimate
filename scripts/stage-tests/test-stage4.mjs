/**
 * ============================================================
 *  CSI-Ultimate — Stage 4 Test Suite
 *  اختبار: Smart Search + Multi-Export + Scheduler
 *
 *  تشغيل: node test-stage4.mjs
 * ============================================================
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

mkdirSync("./output", { recursive: true });
mkdirSync("./state",  { recursive: true });

// ============================================================
//  Test framework
// ============================================================

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    results.push({ ok: true, label });
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    results.push({ ok: false, label });
    console.log(`  ❌ ${label}`);
  }
}

function section(title) {
  console.log(`\n${"═".repeat(58)}`);
  console.log(`  🔷 ${title}`);
  console.log("═".repeat(58));
}

// ============================================================
//  Mock data
// ============================================================

const MOCK_RECORDS = [
  {
    adId: "1001", title: "سائق خاص", description: "مطلوب سائق خاص",
    phones: "+966501234567", emails: "driver@example.com", whatsapp: "",
    location: "الرياض", price: "3000 SAR", company: "شركة النقل",
    category: "وظائف › سائقين", postedDate: "2025-06-01",
    url: "https://www.expatriates.com/cls/1001.html",
  },
  {
    adId: "1002", title: "عاملة منزل", description: "مطلوبة عاملة منزل",
    phones: "+966509876543", emails: "", whatsapp: "https://wa.me/966509876543",
    location: "جدة", price: "1500 SAR", company: "",
    category: "وظائف › خدم", postedDate: "2025-06-02",
    url: "https://www.expatriates.com/cls/1002.html",
  },
  {
    adId: "1003", title: "محاسب", description: "مطلوب محاسب",
    phones: "", emails: "acc@example.com", whatsapp: "",
    location: "الدمام", price: "5000 SAR", company: "شركة المال",
    category: "وظائف › محاسبة", postedDate: "2025-06-03",
    url: "https://www.expatriates.com/cls/1003.html",
  },
];

// ============================================================
//  Section 1: exporter.mjs
// ============================================================

section("1 — exporter.mjs");

// اختبار import
let exporterOk = false;
let exportExcel, exportJSON, exportCSV, exportAll, printSummary;
try {
  const mod = await import("./core/exporter.mjs");
  exportExcel   = mod.exportExcel;
  exportJSON    = mod.exportJSON;
  exportCSV     = mod.exportCSV;
  exportAll     = mod.exportAll;
  printSummary  = mod.printSummary;
  exporterOk    = true;
} catch (e) {
  console.error("  ⚠️  import exporter.mjs:", e.message);
}
assert(exporterOk, "exporter.mjs: import ناجح");

if (exporterOk) {
  // Excel
  let excelFile;
  try {
    excelFile = exportExcel(MOCK_RECORDS, "test_excel");
    assert(existsSync(excelFile), `exportExcel: الملف موجود (${excelFile})`);
    assert(excelFile.endsWith(".xlsx"), "exportExcel: امتداد .xlsx");
  } catch (e) {
    assert(false, `exportExcel: ${e.message}`);
  }

  // JSON
  let jsonFile;
  try {
    jsonFile = exportJSON(MOCK_RECORDS, "test_json");
    assert(existsSync(jsonFile), `exportJSON: الملف موجود`);
    assert(jsonFile.endsWith(".json"), "exportJSON: امتداد .json");

    const content = JSON.parse(
      await import("fs").then(fs => fs.readFileSync(jsonFile, "utf8"))
    );
    assert(content.total === 3, "exportJSON: total = 3");
    assert(Array.isArray(content.records), "exportJSON: records مصفوفة");
  } catch (e) {
    assert(false, `exportJSON: ${e.message}`);
  }

  // CSV
  let csvFile;
  try {
    csvFile = exportCSV(MOCK_RECORDS, "test_csv");
    assert(existsSync(csvFile), "exportCSV: الملف موجود");
    assert(csvFile.endsWith(".csv"), "exportCSV: امتداد .csv");
  } catch (e) {
    assert(false, `exportCSV: ${e.message}`);
  }

  // exportAll
  try {
    const files = exportAll(MOCK_RECORDS, "test_all", { excel: true, json: true, csv: true });
    assert(files.excel && existsSync(files.excel), "exportAll: Excel ✓");
    assert(files.json  && existsSync(files.json),  "exportAll: JSON ✓");
    assert(files.csv   && existsSync(files.csv),   "exportAll: CSV ✓");
  } catch (e) {
    assert(false, `exportAll: ${e.message}`);
  }

  // printSummary لا يرمي خطأ
  try {
    printSummary(MOCK_RECORDS, "اختبار", {}, { recycled: 2 });
    assert(true, "printSummary: لا أخطاء");
  } catch (e) {
    assert(false, `printSummary: ${e.message}`);
  }
}

// ============================================================
//  Section 2: scheduler.mjs
// ============================================================

section("2 — scheduler.mjs");

let schedulerOk = false;
let CrawlScheduler, parseInterval, scheduler;
try {
  const mod = await import("./core/scheduler.mjs");
  CrawlScheduler = mod.CrawlScheduler;
  parseInterval  = mod.parseInterval;
  scheduler      = mod.scheduler;
  schedulerOk    = true;
} catch (e) {
  console.error("  ⚠️  import scheduler.mjs:", e.message);
}
assert(schedulerOk, "scheduler.mjs: import ناجح");

if (schedulerOk) {
  // parseInterval
  try {
    assert(parseInterval("30m")  === 1_800_000,  "parseInterval: 30m = 1800000");
    assert(parseInterval("2h")   === 7_200_000,  "parseInterval: 2h = 7200000");
    assert(parseInterval("1d")   === 86_400_000, "parseInterval: 1d = 86400000");
    assert(parseInterval("60s")  === 60_000,     "parseInterval: 60s = 60000");
  } catch (e) {
    assert(false, `parseInterval: ${e.message}`);
  }

  // CrawlScheduler instance
  const sched = new CrawlScheduler();

  // reset قبل الاختبار
  sched.reset();
  assert(sched.list().length === 0, "Scheduler: reset → list فارغ");

  // إضافة job
  let job;
  try {
    job = sched.add({
      id: "test-job-1",
      type: "category",
      target: "https://www.expatriates.com/cls/jobs.html",
      intervalMs: parseInterval("1h"),
    });
    assert(job.id === "test-job-1",    "Scheduler: add → id صحيح");
    assert(job.type === "category",    "Scheduler: add → type صحيح");
    assert(job.enabled === true,       "Scheduler: add → enabled=true");
    assert(job.runCount === 0,         "Scheduler: add → runCount=0");
    assert(job.nextRunAt <= Date.now() + 100, "Scheduler: add → nextRunAt = الآن");
  } catch (e) {
    assert(false, `Scheduler.add: ${e.message}`);
  }

  // list
  assert(sched.list().length === 1, "Scheduler: list().length = 1");

  // dueJobs — يجب أن يكون job واحد مستحق
  assert(sched.dueJobs().length === 1, "Scheduler: dueJobs = 1");

  // update
  sched.update("test-job-1", { enabled: false });
  assert(sched.list()[0].enabled === false, "Scheduler: update → enabled=false");
  assert(sched.dueJobs().length === 0,      "Scheduler: disabled job لا يظهر في dueJobs");

  // toggle
  sched.toggle("test-job-1");
  assert(sched.list()[0].enabled === true, "Scheduler: toggle → enabled=true مرة أخرى");

  // إضافة job ثان + keyword
  sched.add({
    id: "test-job-2",
    type: "keyword",
    target: "driver",
    intervalMs: parseInterval("30m"),
  });
  assert(sched.list().length === 2, "Scheduler: list().length = 2 بعد إضافة ثانٍ");

  // stats
  const s = sched.stats();
  assert(s.total   === 2, "Scheduler: stats.total = 2");
  assert(s.enabled === 2, "Scheduler: stats.enabled = 2");
  assert(s.due     === 2, "Scheduler: stats.due = 2");

  // runNow (mock runner)
  let ranJobId = null;
  try {
    await sched.runNow("test-job-1", async (job) => { ranJobId = job.id; });
    assert(ranJobId === "test-job-1",          "Scheduler: runNow → runner استُدعي");
    assert(sched.list()[0].runCount === 1,     "Scheduler: runNow → runCount = 1");
    assert(sched.list()[0].nextRunAt > Date.now(), "Scheduler: runNow → nextRunAt مستقبلي");
  } catch (e) {
    assert(false, `Scheduler.runNow: ${e.message}`);
  }

  // remove
  sched.remove("test-job-2");
  assert(sched.list().length === 1, "Scheduler: remove → list().length = 1");

  // state persistence
  const sched2 = new CrawlScheduler();
  assert(sched2.list().length >= 1, "Scheduler: state persistence → يُحمَّل من الملف");

  // reset
  sched.reset();
  assert(sched.list().length === 0, "Scheduler: reset → فارغ");
}

// ============================================================
//  Section 3: smart-search.mjs (unit tests فقط — لا browser)
// ============================================================

section("3 — smart-search.mjs");

let smartSearchOk = false;
let filterCategoriesByKeyword;
try {
  const mod = await import("./core/smart-search.mjs");
  filterCategoriesByKeyword = mod.filterCategoriesByKeyword;
  smartSearchOk = true;
} catch (e) {
  console.error("  ⚠️  import smart-search.mjs:", e.message);
}
assert(smartSearchOk, "smart-search.mjs: import ناجح");

if (smartSearchOk) {
  const cats = [
    { name: "Jobs - Drivers",   url: "https://expatriates.com/cls/driver-jobs.html" },
    { name: "Housemaid Jobs",   url: "https://expatriates.com/cls/housemaid.html" },
    { name: "Accounting Jobs",  url: "https://expatriates.com/cls/accounting.html" },
    { name: "Real Estate",      url: "https://expatriates.com/cls/realestate.html" },
  ];

  // فلترة بكلمة بسيطة
  const r1 = filterCategoriesByKeyword(cats, "driver");
  assert(r1.length >= 1,          "filterCategoriesByKeyword: 'driver' ← نتيجة واحدة أو أكثر");
  assert(r1[0].name.toLowerCase().includes("driver"), "filterCategoriesByKeyword: النتيجة تحتوي 'driver'");

  // فلترة بكلمة غير موجودة
  const r2 = filterCategoriesByKeyword(cats, "xyzabc123");
  assert(r2.length === 0, "filterCategoriesByKeyword: كلمة غير موجودة → 0 نتيجة");

  // فلترة بكلمتين
  const r3 = filterCategoriesByKeyword(cats, "accounting jobs");
  assert(r3.length >= 1, "filterCategoriesByKeyword: 'accounting jobs' ← نتيجة");

  // exports الصحيح للدالة
  const { smartSearch, discoverSearchForm, searchMultipleKeywords } = await import("./core/smart-search.mjs");
  assert(typeof smartSearch          === "function", "smart-search: smartSearch مُصدَّرة");
  assert(typeof discoverSearchForm   === "function", "smart-search: discoverSearchForm مُصدَّرة");
  assert(typeof searchMultipleKeywords === "function", "smart-search: searchMultipleKeywords مُصدَّرة");
}

// ============================================================
//  Section 4: تكامل الـ Crawler (مع BrowserPool)
// ============================================================

section("4 — تكامل BrowserPool + crawler-core");

let poolOk = false;
let createPool, adCache, dedupe, collectAdLinks, runCrawl;
try {
  createPool     = (await import("./core/browser-pool.mjs")).createPool;
  adCache        = (await import("./core/cache.mjs")).adCache;
  dedupe         = (await import("./core/dedupe.mjs")).dedupe;
  const core     = await import("./core/crawler-core.mjs");
  collectAdLinks = core.collectAdLinks;
  runCrawl       = core.runCrawl;
  poolOk         = true;
} catch (e) {
  console.error("  ⚠️  import core modules:", e.message);
}
assert(poolOk, "core modules: import ناجح");

if (poolOk) {
  console.log("\n  ⏳ تهيئة BrowserPool...");
  const { browser, pool } = await createPool({ size: 2, maxUses: 50 });

  try {
    // ── اكتشاف الفئات (buildCategoryTree) ──
    const { buildCategoryTree } = await import("./core/category-walker.mjs");
    console.log("  🌐 اكتشاف الفئات من expatriates.com...");
    const cats = await buildCategoryTree(pool, "https://www.expatriates.com");
    assert(cats.length > 0,      "buildCategoryTree: اكتشف فئات");
    assert(cats[0].name.length > 0, "buildCategoryTree: أسماء الفئات غير فارغة");
    assert(cats[0].url.startsWith("http"), "buildCategoryTree: URLs كاملة");

    // ── Smart Search: discoverSearchForm ──
    console.log("  🔍 اكتشاف نموذج البحث...");
    const { discoverSearchForm } = await import("./core/smart-search.mjs");
    const formInfo = await discoverSearchForm(pool, "https://www.expatriates.com");
    // قد يكون null أو object — كلاهما مقبول
    assert(formInfo === null || typeof formInfo === "object", "discoverSearchForm: يرجع object أو null");

    // ── Smart Search: URL patterns ──
    console.log("  🔍 بحث ذكي بكلمة 'driver'...");
    const { smartSearch } = await import("./core/smart-search.mjs");
    const searchResult = await smartSearch(pool, "https://www.expatriates.com", "driver", {
      PAGE_DELAY: 1000,
    }, cats);
    assert(
      ["form", "url_pattern", "category_filter", "none"].includes(searchResult.strategy),
      `smartSearch: strategy صالح (${searchResult.strategy})`
    );
    assert(Array.isArray(searchResult.links), "smartSearch: links مصفوفة");

    // ── collectAdLinks على أول فئة حقيقية ──
    const jobCat = cats.find(c =>
      /job|work|employ|عمل|وظيف/i.test(c.name + " " + c.url)
    ) || cats[0];

    console.log(`\n  📋 جمع روابط من: ${jobCat.name}`);
    const links = await collectAdLinks(pool, jobCat.url, {
      BASE_URL: "https://www.expatriates.com",
      MAX_PAGES: 2,
      MAX_ADS: 8,
      PAGE_DELAY: 1000,
    });
    assert(links.length >= 0, "collectAdLinks: لا يرمي خطأ");
    console.log(`    → وجد ${links.length} رابط`);

    if (links.length > 0) {
      // ── runCrawl على 2 إعلانات فقط ──
      console.log(`\n  🚀 استخراج أول 2 إعلان...`);
      const records = await runCrawl(pool, links.slice(0, 2), {
        CONCURRENCY: 1,
        AD_DELAY: 800,
      });
      assert(records.length >= 0,        "runCrawl: لا يرمي خطأ");
      if (records.length > 0) {
        assert(records[0].adId?.length > 0, "runCrawl: record[0].adId غير فارغ");
        assert(records[0].url?.length > 0,  "runCrawl: record[0].url غير فارغ");
      }

      // ── exportAll على النتائج الحقيقية ──
      if (records.length > 0) {
        const files = exportAll(records, "stage4_test_real", { excel: true, json: true });
        assert(files.excel && existsSync(files.excel), "exportAll (real data): Excel موجود");
        assert(files.json  && existsSync(files.json),  "exportAll (real data): JSON موجود");
      }
    }

  } finally {
    await pool.drain();
    await browser.close();
    adCache.close();
    dedupe.close();
  }
}

// ============================================================
//  ملخص النتائج
// ============================================================

console.log("\n" + "═".repeat(58));
console.log("  📊 ملخص Stage 4");
console.log("═".repeat(58));
console.log(`  ✅ نجح  : ${passed}`);
console.log(`  ❌ فشل  : ${failed}`);
console.log(`  📋 مجموع: ${passed + failed}`);
console.log("═".repeat(58));

if (failed === 0) {
  console.log("\n  🎉 Stage 4 مكتمل 100% — جاهز للمرحلة التالية!\n");
} else {
  console.log(`\n  ⚠️  ${failed} اختبار فشل — راجع الأخطاء أعلاه\n`);
  process.exit(1);
}

/**
 * ============================================================
 *  CSI-Ultimate — Ad Crawler v6
 *  Stage 3: Discovery Engine
 *  يضيف: Category Walker + Keyword Search + Auto-Walk Mode
 *
 *  تشغيل:
 *    node csi-crawler-v6.mjs                  ← وضع تفاعلي (اختيار فئة)
 *    node csi-crawler-v6.mjs --walk           ← يمشي عبر كل الفئات
 *    node csi-crawler-v6.mjs --search "نص"   ← بحث بكلمة مفتاحية
 *    node csi-crawler-v6.mjs --reset          ← مسح سجل الفئات المكتملة
 * ============================================================
 */

import { mkdirSync }      from "fs";
import * as readline      from "readline";
import * as XLSX          from "xlsx";
import { createPool }     from "./core/browser-pool.mjs";
import { adCache }        from "./core/cache.mjs";
import { dedupe }         from "./core/dedupe.mjs";
import { collectAdLinks, runCrawl } from "./core/crawler-core.mjs";
import {
  buildCategoryTree,
  filterCategories,
  walkCategories,
  categorySession,
} from "./core/category-walker.mjs";
import {
  searchByKeyword,
  searchMultiple,
} from "./core/keyword-search.mjs";

mkdirSync("./output", { recursive: true });
mkdirSync("./state",  { recursive: true });

// ============================================================
//  CONFIG
// ============================================================

const CONFIG = {
  BASE_URL:      "https://www.expatriates.com",
  PAGE_DELAY:    1500,
  AD_DELAY:      1200,
  MAX_PAGES:     15,
  MAX_ADS:       300,
  CONCURRENCY:   3,
  POOL_SIZE:     4,
  POOL_MAX_USES: 80,
  WALK_DELAY:    3000,   // تأخير بين الفئات عند المشي
};

// ============================================================
//  parseArgs
// ============================================================

const args = process.argv.slice(2);
const MODE = {
  walk:   args.includes("--walk"),
  search: args.includes("--search"),
  reset:  args.includes("--reset"),
  query:  args[args.indexOf("--search") + 1] || "",
};

// ============================================================
//  exportExcel
// ============================================================

function exportExcel(records, label) {
  const safeName  = label.replace(/[^\w\u0600-\u06FF]/g, "_").slice(0, 25);
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  const filepath  = `./output/${safeName}_${timestamp}.xlsx`;

  const headers = [
    "رقم الإعلان", "العنوان", "الوصف",
    "الهواتف", "الإيميلات", "واتساب",
    "الموقع", "السعر/الراتب", "الشركة",
    "الفئة", "تاريخ النشر", "الرابط",
  ];

  const rows = records.map(r => [
    r.adId, r.title, r.description,
    r.phones, r.emails, r.whatsapp,
    r.location, r.price, r.company,
    r.category, r.postedDate, r.url,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = [
    {wch:12},{wch:45},{wch:70},
    {wch:30},{wch:35},{wch:35},
    {wch:20},{wch:18},{wch:28},
    {wch:25},{wch:18},{wch:55},
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ads");
  XLSX.writeFile(wb, filepath);
  return filepath;
}

// ============================================================
//  promptChoice
// ============================================================

async function promptChoice(cats) {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║               الفئات المكتشفة                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  cats.forEach((c, i) => console.log(`  [${String(i+1).padStart(3)}]  ${c.name.padEnd(35)} ${c.url}`));
  console.log("\n" + "─".repeat(65));
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("\n  اختيارك (رقم أو 0 للكل): ", ans => {
      rl.close();
      const idx = parseInt(ans.trim()) - 1;
      if (ans.trim() === "0") return resolve(null); // كل الفئات
      resolve(cats[Math.max(0, Math.min(isNaN(idx) ? 0 : idx, cats.length - 1))]);
    });
  });
}

// ============================================================
//  printSummary
// ============================================================

function printSummary(records, label, file, poolStats) {
  const withPhone = records.filter(r => r.phones).length;
  const withEmail = records.filter(r => r.emails).length;
  const withDesc  = records.filter(r => r.description?.length > 10).length;
  const fromCache = records.filter(r => r._fromCache).length;

  console.log("\n" + "═".repeat(55));
  console.log("  النتيجة — " + label);
  console.log("═".repeat(55));
  console.log(`  إجمالي       : ${records.length}`);
  console.log(`  💾 من cache  : ${fromCache}`);
  console.log(`  📞 بأرقام    : ${withPhone}`);
  console.log(`  📧 بإيميل    : ${withEmail}`);
  console.log(`  📝 بوصف      : ${withDesc}`);
  if (poolStats) console.log(`  🔄 Pool      : ${poolStats.recycled} context جُدِّد`);
  if (file)      console.log(`  📁 الملف     : ${file}`);
  console.log("═".repeat(55) + "\n");
}

// ============================================================
//  MAIN
// ============================================================

(async () => {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   CSI-Ultimate v6  |  Discovery Engine             ║");
  console.log("║   Category Walker + Keyword Search                 ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  const cacheSize  = adCache.size();
  const dedupeSize = dedupe.stats().urlsSeen;
  if (cacheSize > 0 || dedupeSize > 0) {
    console.log(`\n  💾 Cache: ${cacheSize} إعلان | Dedupe: ${dedupeSize} URL مسجّل`);
  }

  // ── --reset ──
  if (MODE.reset) {
    categorySession.reset();
    console.log("\n✅ تم مسح سجل الفئات المكتملة\n");
    process.exit(0);
  }

  const { browser, pool } = await createPool({
    size:    CONFIG.POOL_SIZE,
    maxUses: CONFIG.POOL_MAX_USES,
  });

  try {

    // ════════════════════════════════════════
    //  وضع: --search "كلمة"
    // ════════════════════════════════════════
    if (MODE.search) {
      if (!MODE.query) {
        console.log("❌ يجب تحديد كلمة البحث: --search \"كلمة\"");
        return;
      }

      const links = await searchByKeyword(pool, CONFIG.BASE_URL, MODE.query, CONFIG);
      if (!links.length) { console.log("⚠️  لا نتائج"); return; }

      console.log(`\n🚀 استخراج ${links.length} إعلان...\n${"─".repeat(110)}`);
      const records = await runCrawl(pool, links, CONFIG);
      const file    = exportExcel(records, `search_${MODE.query}`);
      printSummary(records, `بحث: "${MODE.query}"`, file, pool.stats());
      return;
    }

    // ════════════════════════════════════════
    //  وضع: --walk (مشي عبر كل الفئات)
    // ════════════════════════════════════════
    if (MODE.walk) {
      const allCategories = await buildCategoryTree(pool, CONFIG.BASE_URL);
      if (!allCategories.length) { console.log("❌ لا فئات"); return; }

      // فلتر: استبعد روابط عامة (Home, Login...)
      const categories = filterCategories(allCategories, {
        exclude: ["Home", "Login", "Register", "Sign", "Account", "Help", "Contact", "About"],
      });

      console.log(`\n📂 ${categories.length} فئة للمشي عبرها`);
      const remaining = categorySession.remaining(categories);
      console.log(`  ↩️  متبقي: ${remaining.length} | مكتمل: ${categories.length - remaining.length}`);

      const allRecords = [];

      await walkCategories(pool, categories, CONFIG, async (cat) => {
        const links = await collectAdLinks(pool, cat.url, CONFIG);
        if (!links.length) {
          console.log("  ⚠️  لا إعلانات جديدة في هذه الفئة");
          return;
        }

        console.log(`\n🚀 استخراج ${links.length} إعلان...\n${"─".repeat(110)}`);
        const records = await runCrawl(pool, links, CONFIG);
        allRecords.push(...records);

        // تصدير لكل فئة على حدة
        if (records.length > 0) {
          const file = exportExcel(records, cat.name);
          console.log(`  📁 ${file} (${records.length} إعلان)`);
        }
      }, { resume: true, delayBetween: CONFIG.WALK_DELAY });

      // تصدير إجمالي
      if (allRecords.length > 0) {
        const file = exportExcel(allRecords, "walk_all");
        printSummary(allRecords, "مشي شامل", file, pool.stats());
      }
      return;
    }

    // ════════════════════════════════════════
    //  وضع: تفاعلي (اختيار فئة)
    // ════════════════════════════════════════
    const allCategories = await buildCategoryTree(pool, CONFIG.BASE_URL);
    if (!allCategories.length) { console.log("❌ لا فئات"); return; }

    const chosen = await promptChoice(allCategories);

    if (!chosen) {
      // اختار "0" → امشي على الكل
      const records = [];
      await walkCategories(pool, allCategories, CONFIG, async (cat) => {
        const links = await collectAdLinks(pool, cat.url, CONFIG);
        if (!links.length) return;
        const r = await runCrawl(pool, links, CONFIG);
        records.push(...r);
        if (r.length > 0) exportExcel(r, cat.name);
      }, { resume: true });

      if (records.length > 0) {
        const file = exportExcel(records, "all_categories");
        printSummary(records, "كل الفئات", file, pool.stats());
      }
      return;
    }

    console.log(`\n✅ الفئة: ${chosen.name}\n`);
    const adLinks = await collectAdLinks(pool, chosen.url, CONFIG);
    if (!adLinks.length) { console.log("⚠️  لا توجد إعلانات جديدة"); return; }

    console.log(`\n🚀 استخراج ${adLinks.length} إعلان...\n${"─".repeat(110)}`);
    const allRecords = await runCrawl(pool, adLinks, CONFIG);
    const file = exportExcel(allRecords, chosen.name);
    printSummary(allRecords, chosen.name, file, pool.stats());

  } finally {
    await pool.drain();
    await browser.close();
    adCache.close();
    dedupe.close();
  }
})();

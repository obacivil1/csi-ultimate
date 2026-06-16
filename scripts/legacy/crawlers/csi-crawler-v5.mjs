/**
 * ============================================================
 *  CSI-Ultimate — Ad Crawler v5
 *  Stage 2B: Pool + Queue + Cache + Dedupe متكاملة
 *
 *  تشغيل:
 *    node csi-crawler-v5.mjs
 * ============================================================
 */

import { mkdirSync }      from "fs";
import * as readline      from "readline";
import * as XLSX          from "xlsx";
import { createPool }     from "./core/browser-pool.mjs";
import { adCache }        from "./core/cache.mjs";
import { dedupe }         from "./core/dedupe.mjs";
import {
  smartLoad,
  collectAdLinks,
  runCrawl,
} from "./core/crawler-core.mjs";

mkdirSync("./output", { recursive: true });
mkdirSync("./state",  { recursive: true });

// ============================================================
//  CONFIG
// ============================================================

const CONFIG = {
  BASE_URL:    "https://www.expatriates.com",
  TIMEOUT:     60000,
  PAGE_DELAY:  1500,
  AD_DELAY:    1200,
  MAX_PAGES:   15,
  MAX_ADS:     300,
  CONCURRENCY: 3,        // عدد العمال المتوازيين
  POOL_SIZE:   4,        // حجم browser pool (CONCURRENCY + 1 احتياطي)
  POOL_MAX_USES: 80,     // تجديد context بعد 80 استخدام
};

// ============================================================
//  discoverCategories — بدون تغيير عن v4
// ============================================================

async function discoverCategories(pool) {
  console.log("\n🔍 جاري اكتشاف الفئات...\n");

  return await pool.withPage(async (page) => {
    await smartLoad(page, CONFIG.BASE_URL + "/");

    const categories = await page.evaluate(base => {
      const seen = new Set();
      const out  = [];
      const push = el => {
        const href = el?.href;
        const text = el?.innerText?.trim().replace(/\s+/g, " ");
        if (!href || !text || seen.has(href)) return;
        if (!href.startsWith(base)) return;
        if (href.endsWith("#") || href.includes("javascript")) return;
        if (text.length < 2 || text.length > 70) return;
        seen.add(href);
        out.push({ name: text, url: href });
      };
      document.querySelectorAll("nav a, header a, .nav a, .menu a, .sidebar a, aside a, [class*='categor'] a, h3 a, h4 a").forEach(push);
      document.querySelectorAll("a[href]").forEach(a => {
        if (a.href.match(/\/cls\/[a-z]/i) || a.href.match(/classifieds\//i)) push(a);
      });
      return out;
    }, CONFIG.BASE_URL);

    return categories.filter((c, i, arr) =>
      c.name.length > 1 && arr.findIndex(x => x.url === c.url) === i
    );
  });
}

// ============================================================
//  promptChoice — بدون تغيير عن v4
// ============================================================

async function promptChoice(cats) {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║               الفئات المكتشفة                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  cats.forEach((c, i) => console.log(`  [${String(i+1).padStart(3)}]  ${c.name.padEnd(35)} ${c.url}`));
  console.log("\n" + "─".repeat(65));
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("\n  اختيارك: ", ans => {
      rl.close();
      const idx = parseInt(ans.trim()) - 1;
      resolve(cats[Math.max(0, Math.min(isNaN(idx) ? 0 : idx, cats.length - 1))]);
    });
  });
}

// ============================================================
//  exportExcel — بدون تغيير عن v4
// ============================================================

function exportExcel(records, catName) {
  const safeName  = catName.replace(/[^\w\u0600-\u06FF]/g, "_").slice(0, 25);
  const timestamp = new Date().toISOString().slice(0, 10);
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
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ads");
  XLSX.writeFile(wb, filepath);
  return filepath;
}

// ============================================================
//  MAIN
// ============================================================

(async () => {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   CSI-Ultimate v5  |  expatriates.com           ║");
  console.log("║   Pool + Queue + Cache + Dedupe                 ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // ── إحصاءات الـ cache/dedupe عند البدء ──
  const cacheSize  = adCache.size();
  const dedupeSize = dedupe.stats().urlsSeen;
  if (cacheSize > 0 || dedupeSize > 0) {
    console.log(`\n  💾 Cache: ${cacheSize} إعلان محفوظ | Dedupe: ${dedupeSize} URL مسجّل`);
    console.log("  (الإعلانات المحفوظة ستُستعاد من الـ cache — لن تُعاد زيارتها)\n");
  }

  // ── إنشاء البrowser Pool ──
  const { browser, pool } = await createPool({
    size:    CONFIG.POOL_SIZE,
    maxUses: CONFIG.POOL_MAX_USES,
  });

  try {
    // الخطوة 1: اكتشاف الفئات
    const categories = await discoverCategories(pool);
    if (!categories.length) { console.log("❌ لا توجد فئات"); return; }

    // الخطوة 2: اختيار الفئة
    const chosen = await promptChoice(categories);
    console.log(`\n✅ الفئة: ${chosen.name}\n`);

    // الخطوة 3: جمع الروابط (مع pageCache + dedup فلترة)
    const adLinks = await collectAdLinks(pool, chosen.url, CONFIG);
    if (!adLinks.length) { console.log("⚠️  لا توجد إعلانات جديدة"); return; }

    // الخطوة 4: الاستخراج المتوازي
    console.log(`\n🚀 استخراج ${adLinks.length} إعلان — ${CONFIG.CONCURRENCY} متوازي | Pool: ${CONFIG.POOL_SIZE}\n`);
    console.log("─".repeat(110));

    const allRecords = await runCrawl(pool, adLinks, CONFIG);

    // الخطوة 5: تصدير Excel
    console.log("\n📊 تصدير إلى Excel...");
    const file = exportExcel(allRecords, chosen.name);

    // ── ملخص ──
    const withPhone   = allRecords.filter(r => r.phones).length;
    const withEmail   = allRecords.filter(r => r.emails).length;
    const withDesc    = allRecords.filter(r => r.description?.length > 10).length;
    const fromCache   = allRecords.filter(r => r._fromCache).length;
    const poolStats   = pool.stats();

    console.log("\n" + "═".repeat(55));
    console.log("  النتيجة");
    console.log("═".repeat(55));
    console.log(`  الفئة        : ${chosen.name}`);
    console.log(`  إجمالي       : ${allRecords.length} / ${adLinks.length}`);
    console.log(`  💾 من cache  : ${fromCache}`);
    console.log(`  📞 بأرقام    : ${withPhone}`);
    console.log(`  📧 بإيميل    : ${withEmail}`);
    console.log(`  📝 بوصف      : ${withDesc}`);
    console.log(`  🔄 Pool      : ${poolStats.recycled} context جُدِّد`);
    console.log(`  📁 الملف     : ${file}`);
    console.log("═".repeat(55) + "\n");

  } finally {
    await pool.drain();
    await browser.close();
    adCache.close();
    dedupe.close();
  }
})();

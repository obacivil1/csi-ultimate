/**
 * ============================================================
 *  CSI-Ultimate — Ad Crawler v7
 *  Stage 4: Smart Search + Multi-Export + Scheduler
 *
 *  تشغيل:
 *    node csi-crawler-v7.mjs                     ← تفاعلي
 *    node csi-crawler-v7.mjs --walk              ← مشي كل الفئات
 *    node csi-crawler-v7.mjs --search "نص"      ← بحث ذكي
 *    node csi-crawler-v7.mjs --schedule          ← تشغيل المجدول
 *    node csi-crawler-v7.mjs --export json,csv   ← تصدير متعدد
 *    node csi-crawler-v7.mjs --reset             ← مسح السجلات
 * ============================================================
 */

import { mkdirSync }      from "fs";
import * as readline      from "readline";
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
import { smartSearch }    from "./core/smart-search.mjs";
import { exportAll, printSummary } from "./core/exporter.mjs";
import { scheduler, parseInterval } from "./core/scheduler.mjs";

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
  WALK_DELAY:    3000,
};

// ============================================================
//  parseArgs
// ============================================================

const args  = process.argv.slice(2);

const MODE = {
  walk:     args.includes("--walk"),
  search:   args.includes("--search"),
  schedule: args.includes("--schedule"),
  addJob:   args.includes("--add-job"),
  listJobs: args.includes("--list-jobs"),
  reset:    args.includes("--reset"),
  query:    args[args.indexOf("--search") + 1]   || "",
  exports:  (args[args.indexOf("--export") + 1]  || "excel").split(",").map(s => s.trim()),
};

// هل نصدّر بصيغ متعددة؟
const EXPORT_OPTS = {
  excel: MODE.exports.includes("excel") || !args.includes("--export"),
  json:  MODE.exports.includes("json"),
  csv:   MODE.exports.includes("csv"),
};

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
      if (ans.trim() === "0") return resolve(null);
      const idx = parseInt(ans.trim()) - 1;
      resolve(cats[Math.max(0, Math.min(isNaN(idx) ? 0 : idx, cats.length - 1))]);
    });
  });
}

// ============================================================
//  MAIN
// ============================================================

(async () => {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   CSI-Ultimate v7  |  Smart Search + Scheduler     ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  const cacheSize  = adCache.size();
  const dedupeSize = dedupe.stats().urlsSeen;
  const schedStats = scheduler.stats();

  if (cacheSize > 0 || dedupeSize > 0)
    console.log(`\n  💾 Cache: ${cacheSize} إعلان | Dedupe: ${dedupeSize} URL`);
  if (schedStats.total > 0)
    console.log(`  ⏰ Jobs مجدولة: ${schedStats.enabled}/${schedStats.total} مفعّل | ${schedStats.due} جاهز`);

  // ── --reset ──
  if (MODE.reset) {
    categorySession.reset();
    scheduler.reset();
    console.log("\n✅ تم مسح سجل الفئات + الـ Jobs المجدولة\n");
    process.exit(0);
  }

  // ── --list-jobs ──
  if (MODE.listJobs) {
    const jobs = scheduler.list();
    if (!jobs.length) {
      console.log("\n⚠️  لا jobs مجدولة\n");
    } else {
      console.log("\n" + "─".repeat(80));
      console.log("  ID".padEnd(20) + "النوع".padEnd(12) + "الهدف".padEnd(35) + "التالي");
      console.log("─".repeat(80));
      jobs.forEach(j => {
        const next = j.nextRunAt > Date.now()
          ? new Date(j.nextRunAt).toLocaleString("ar")
          : "الآن";
        console.log(
          `  ${j.id.padEnd(18)} ${j.type.padEnd(10)} ${j.target.slice(0,33).padEnd(35)} ${next}`
        );
      });
      console.log("─".repeat(80) + "\n");
    }
    process.exit(0);
  }

  // ── --add-job ──
  if (MODE.addJob) {
    // مثال: node csi-crawler-v7.mjs --add-job --id "jobs-daily" --type category --target "/cls/jobs.html" --interval 12h
    const id       = args[args.indexOf("--id") + 1];
    const type     = args[args.indexOf("--type") + 1] || "category";
    const target   = args[args.indexOf("--target") + 1];
    const interval = args[args.indexOf("--interval") + 1] || "6h";

    if (!id || !target) {
      console.log("❌ --add-job يحتاج: --id <id> --target <url/keyword> [--type category|keyword|walk] [--interval 6h]");
      process.exit(1);
    }

    const job = scheduler.add({
      id,
      type,
      target: target.startsWith("http") ? target : CONFIG.BASE_URL + target,
      intervalMs: parseInterval(interval),
    });

    console.log(`\n✅ تم إضافة Job "${id}"`);
    console.log(`   النوع: ${job.type} | الفترة: كل ${interval} | الهدف: ${job.target}\n`);
    process.exit(0);
  }

  // ══════════════════════════════════════════════════════
  //  إنشاء البool
  // ══════════════════════════════════════════════════════
  const { browser, pool } = await createPool({
    size:    CONFIG.POOL_SIZE,
    maxUses: CONFIG.POOL_MAX_USES,
  });

  try {

    // ════════════════════════════════════════════════════
    //  وضع: --search "كلمة" (بحث ذكي)
    // ════════════════════════════════════════════════════
    if (MODE.search) {
      if (!MODE.query) {
        console.log('❌ يجب تحديد كلمة: --search "كلمة"');
        return;
      }

      // اكتشاف الفئات للفولباك
      console.log("\n📂 تحميل الفئات للبحث...");
      const categories = await buildCategoryTree(pool, CONFIG.BASE_URL);

      const { links, strategy, categories: matchingCats } = await smartSearch(
        pool, CONFIG.BASE_URL, MODE.query, CONFIG, categories
      );

      // إذا الاستراتيجية فلترة فئات → اسأل المستخدم
      if (strategy === "category_filter" && matchingCats?.length > 0) {
        console.log(`\n💡 وجدنا ${matchingCats.length} فئة مطابقة لـ "${MODE.query}"`);
        const chosen = await promptChoice(matchingCats);
        const catLinks = await collectAdLinks(pool, (chosen || matchingCats[0]).url, CONFIG);
        if (!catLinks.length) { console.log("⚠️  لا إعلانات"); return; }

        console.log(`\n🚀 استخراج ${catLinks.length} إعلان...\n${"─".repeat(110)}`);
        const records = await runCrawl(pool, catLinks, CONFIG);
        const files   = exportAll(records, `search_${MODE.query}`, EXPORT_OPTS);
        printSummary(records, `بحث: "${MODE.query}"`, files, pool.stats());
        return;
      }

      if (!links.length) {
        console.log(`\n⚠️  لا نتائج للبحث عن "${MODE.query}"`);
        return;
      }

      console.log(`\n🚀 استخراج ${links.length} إعلان...\n${"─".repeat(110)}`);
      const records = await runCrawl(pool, links, CONFIG);
      const files   = exportAll(records, `search_${MODE.query}`, EXPORT_OPTS);
      printSummary(records, `بحث: "${MODE.query}"`, files, pool.stats());
      return;
    }

    // ════════════════════════════════════════════════════
    //  وضع: --schedule (تشغيل المجدول)
    // ════════════════════════════════════════════════════
    if (MODE.schedule) {
      const jobs = scheduler.list();
      if (!jobs.length) {
        console.log("\n⚠️  لا jobs مجدولة. أضف job بـ --add-job\n");
        return;
      }

      console.log(`\n⏰ تشغيل ${jobs.length} job(s) مجدول...`);

      // runner: ينفّذ كل job
      const runner = async (job) => {
        let links = [];

        if (job.type === "category") {
          links = await collectAdLinks(pool, job.target, CONFIG);
        } else if (job.type === "keyword") {
          const r = await smartSearch(pool, CONFIG.BASE_URL, job.target, CONFIG);
          links = r.links;
        } else if (job.type === "walk") {
          const cats = await buildCategoryTree(pool, CONFIG.BASE_URL);
          const filtered = filterCategories(cats, { exclude: ["Home","Login","Register"] });
          const allRecords = [];
          await walkCategories(pool, filtered, CONFIG, async (cat) => {
            const catLinks = await collectAdLinks(pool, cat.url, CONFIG);
            if (!catLinks.length) return;
            const r = await runCrawl(pool, catLinks, CONFIG);
            allRecords.push(...r);
            if (r.length > 0) exportAll(r, cat.name, EXPORT_OPTS);
          }, { resume: true });
          if (allRecords.length > 0) {
            const files = exportAll(allRecords, `scheduled_walk_${job.id}`, EXPORT_OPTS);
            printSummary(allRecords, `Scheduled Walk: ${job.id}`, files, pool.stats());
          }
          return;
        }

        if (!links.length) {
          console.log(`  ⚠️  Job "${job.id}": لا إعلانات جديدة`);
          return;
        }

        const records = await runCrawl(pool, links, CONFIG);
        const files   = exportAll(records, `scheduled_${job.id}`, EXPORT_OPTS);
        printSummary(records, `Scheduled: ${job.id}`, files, pool.stats());
      };

      // شغّل الـ jobs المستحقة الآن
      const dueJobs = scheduler.dueJobs();
      if (dueJobs.length > 0) {
        for (const job of dueJobs) {
          await scheduler.runNow(job.id, runner);
        }
      } else {
        console.log("\n⏳ لا jobs مستحقة الآن. ابدأ الـ scheduler للعمل في الخلفية:");
        console.log('   scheduler.start(runner, 60_000)  // يتحقق كل دقيقة');
      }
      return;
    }

    // ════════════════════════════════════════════════════
    //  وضع: --walk
    // ════════════════════════════════════════════════════
    if (MODE.walk) {
      const allCategories = await buildCategoryTree(pool, CONFIG.BASE_URL);
      if (!allCategories.length) { console.log("❌ لا فئات"); return; }

      const categories = filterCategories(allCategories, {
        exclude: ["Home","Login","Register","Sign","Account","Help","Contact","About"],
      });

      console.log(`\n📂 ${categories.length} فئة | متبقي: ${categorySession.remaining(categories).length}`);
      const allRecords = [];

      await walkCategories(pool, categories, CONFIG, async (cat) => {
        const links = await collectAdLinks(pool, cat.url, CONFIG);
        if (!links.length) { console.log("  ⚠️  لا إعلانات جديدة"); return; }
        console.log(`\n🚀 استخراج ${links.length} إعلان...\n${"─".repeat(110)}`);
        const records = await runCrawl(pool, links, CONFIG);
        allRecords.push(...records);
        if (records.length > 0) exportAll(records, cat.name, EXPORT_OPTS);
      }, { resume: true, delayBetween: CONFIG.WALK_DELAY });

      if (allRecords.length > 0) {
        const files = exportAll(allRecords, "walk_all", EXPORT_OPTS);
        printSummary(allRecords, "مشي شامل", files, pool.stats());
      }
      return;
    }

    // ════════════════════════════════════════════════════
    //  وضع: تفاعلي
    // ════════════════════════════════════════════════════
    const allCategories = await buildCategoryTree(pool, CONFIG.BASE_URL);
    if (!allCategories.length) { console.log("❌ لا فئات"); return; }

    const chosen = await promptChoice(allCategories);

    if (!chosen) {
      const allRecords = [];
      await walkCategories(pool, allCategories, CONFIG, async (cat) => {
        const links = await collectAdLinks(pool, cat.url, CONFIG);
        if (!links.length) return;
        const r = await runCrawl(pool, links, CONFIG);
        allRecords.push(...r);
        if (r.length > 0) exportAll(r, cat.name, EXPORT_OPTS);
      }, { resume: true });

      if (allRecords.length > 0) {
        const files = exportAll(allRecords, "all_categories", EXPORT_OPTS);
        printSummary(allRecords, "كل الفئات", files, pool.stats());
      }
      return;
    }

    console.log(`\n✅ الفئة: ${chosen.name}\n`);
    const adLinks = await collectAdLinks(pool, chosen.url, CONFIG);
    if (!adLinks.length) { console.log("⚠️  لا إعلانات جديدة"); return; }

    console.log(`\n🚀 استخراج ${adLinks.length} إعلان...\n${"─".repeat(110)}`);
    const allRecords = await runCrawl(pool, adLinks, CONFIG);
    const files = exportAll(allRecords, chosen.name, EXPORT_OPTS);
    printSummary(allRecords, chosen.name, files, pool.stats());

  } finally {
    await pool.drain();
    await browser.close();
    adCache.close();
    dedupe.close();
  }
})();

#!/usr/bin/env node
/**
 * ============================================================
 *  CSI-Ultimate — Crawler v8
 *  المرحلة النهائية — تكامل كل الـ Stages
 *  csi-crawler-v8.mjs
 * ============================================================
 *
 *  ما الجديد في v8؟
 *  -----------------
 *  ✅ Stage 1: Foundation (BrowserPool, Queue, Cache, Dedupe)
 *  ✅ Stage 2: Scraper Core (crawler-core.mjs)
 *  ✅ Stage 3: Discovery (CategoryWalker, KeywordSearch)
 *  ✅ Stage 4: SmartSearch, Exporter, Scheduler
 *  ⭐ Stage 5: PostSearch, RateLimiter, Reporter
 *
 *  الأوامر المتاحة:
 *  ----------------
 *  node csi-crawler-v8.mjs --url <URL>
 *  node csi-crawler-v8.mjs --url <URL> --categories
 *  node csi-crawler-v8.mjs --url <URL> --search "keyword"
 *  node csi-crawler-v8.mjs --url <URL> --search "kw1,kw2,kw3"
 *  node csi-crawler-v8.mjs --url <URL> --search "keyword" --post
 *  node csi-crawler-v8.mjs --url <URL> --max-ads 500
 *  node csi-crawler-v8.mjs --url <URL> --max-pages 10
 *  node csi-crawler-v8.mjs --url <URL> --output ./my-output
 *  node csi-crawler-v8.mjs --url <URL> --format excel,csv,json
 *  node csi-crawler-v8.mjs --url <URL> --schedule 6h
 *  node csi-crawler-v8.mjs --url <URL> --resume
 *  node csi-crawler-v8.mjs --status
 *  node csi-crawler-v8.mjs --probe <URL>
 */

import { parseArgs }       from "node:util";
import { existsSync, mkdirSync } from "fs";
import { resolve }         from "path";

// Stage 1 + 2
import { BrowserPool }     from "./core/browser-pool.mjs";
import { Queue }           from "./core/queue.mjs";
import { cache }           from "./core/cache.mjs";
import { dedupe }          from "./core/dedupe.mjs";
import { scrapeAdPage }    from "./core/crawler-core.mjs";

// Stage 3
import {
  buildCategoryTree,
  filterCategories,
  walkCategories,
  categorySession,
} from "./core/category-walker.mjs";
import { searchByKeyword, searchMultiple } from "./core/keyword-search.mjs";

// Stage 4
import { SmartSearch }     from "./core/smart-search.mjs";
import { exportAll }       from "./core/exporter.mjs";
import { Scheduler }       from "./core/scheduler.mjs";

// Stage 5
import {
  postSearch,
  postSearchMultiple,
  probeSearchMechanism,
} from "./core/post-search.mjs";
import {
  rateLimiter,
  retryHandler,
  throttle,
  detectBan,
} from "./core/rate-limiter.mjs";
import {
  createReporter,
  getReporter,
} from "./core/reporter.mjs";

// ============================================================
//  الإعدادات الافتراضية
// ============================================================

const DEFAULTS = {
  CONCURRENCY:  3,
  MAX_PAGES:    10,
  MAX_ADS:      300,
  PAGE_DELAY:   1500,
  AD_DELAY:     800,
  OUTPUT_DIR:   "./output",
  FORMATS:      ["excel", "json"],
};

// ============================================================
//  parseCliArgs — تحليل args
// ============================================================

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    options: {
      url:        { type: "string"  },
      categories: { type: "boolean" },
      search:     { type: "string"  },
      post:       { type: "boolean" }, // ⭐ Stage 5: إجبار POST
      "max-ads":  { type: "string"  },
      "max-pages":{ type: "string"  },
      output:     { type: "string"  },
      format:     { type: "string"  },
      schedule:   { type: "string"  },
      resume:     { type: "boolean" },
      status:     { type: "boolean" },
      probe:      { type: "string"  },  // ⭐ Stage 5: فحص آلية البحث
      concurrency:{ type: "string"  },
      help:       { type: "boolean" },
    },
    allowPositionals: true,
    strict: false,
  });

  return values;
}

// ============================================================
//  printHelp
// ============================================================

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║         CSI-Ultimate Crawler v8 — Stage 5               ║
╚══════════════════════════════════════════════════════════╝

الاستخدام:
  node csi-crawler-v8.mjs [options]

الخيارات الأساسية:
  --url <URL>           رابط الموقع المستهدف
  --categories          تصفح كل الفئات تلقائياً
  --search "kw"         بحث بكلمة مفتاحية (أو عدة: "kw1,kw2")
  --post                إجبار استخدام POST للبحث ⭐ Stage 5

الحدود:
  --max-ads  <n>        أقصى عدد إعلانات (default: ${DEFAULTS.MAX_ADS})
  --max-pages <n>       أقصى صفحات (default: ${DEFAULTS.MAX_PAGES})
  --concurrency <n>     عدد browsers متوازية (default: ${DEFAULTS.CONCURRENCY})

التصدير:
  --output <dir>        مجلد الإخراج (default: ${DEFAULTS.OUTPUT_DIR})
  --format excel,csv,json  صيغ التصدير

الجدولة والحالة:
  --schedule <interval> جدولة تلقائية (مثل: 6h, 30m, 1d)
  --resume              استكمال من آخر جلسة
  --status              عرض حالة الجدولة

التشخيص ⭐ Stage 5:
  --probe <URL>         فحص آلية البحث للموقع

أمثلة:
  node csi-crawler-v8.mjs --url https://www.expatriates.com --categories
  node csi-crawler-v8.mjs --url https://www.expatriates.com --search "driver"
  node csi-crawler-v8.mjs --url https://www.expatriates.com --search "driver" --post
  node csi-crawler-v8.mjs --url https://www.expatriates.com --probe https://www.expatriates.com
  node csi-crawler-v8.mjs --url https://www.expatriates.com --schedule 6h
`);
}

// ============================================================
//  scrapeLinks — يسحب تفاصيل إعلانات من قائمة روابط
// ============================================================

async function scrapeLinks(pool, links, config, reporter) {
  const results    = [];
  const queue      = new Queue({ concurrency: config.concurrency });
  const batchSize  = 50;

  console.log(`\n📋 سحب ${links.length} إعلان...`);

  for (let i = 0; i < links.length; i++) {
    const url = links[i];

    queue.add(async () => {
      await throttle.waitFor(url);
      reporter?.inc("totalRequests");

      const data = await retryHandler.run(async () => {
        const result = await pool.withPage(async (page) => {
          return await scrapeAdPage(page, url, config);
        });
        if (!result) throw new Error("scrape returned null");
        return result;
      }, `scrape:${url.slice(-20)}`);

      if (data) {
        results.push(data);
        reporter?.inc("adsScraped");
      } else {
        reporter?.inc("adsFailed");
        reporter?.recordError(url, new Error("scrape failed"));
      }

      // progress
      const done = results.length + (reporter?._stats.adsFailed ?? 0);
      if (done % batchSize === 0) {
        console.log(`  ↳ ${done}/${links.length} (${((done/links.length)*100).toFixed(0)}%)`);
      }
    });
  }

  await queue.drain();
  console.log(`  ✅ scraped: ${results.length} / ${links.length}`);
  return results;
}

// ============================================================
//  runCategories — تصفح الفئات
// ============================================================

async function runCategories(pool, baseUrl, config, reporter) {
  const allLinks   = new Set();

  const categories = await buildCategoryTree(pool, baseUrl);
  reporter?.set("categoriesFound", categories.length);

  const toWalk = config.resume
    ? categorySession.remaining(categories)
    : categories;

  await walkCategories(pool, toWalk, config, async (cat) => {
    const { links } = await retryHandler.run(
      () => smartSearchLinks(pool, cat.url, config),
      `cat:${cat.name}`
    ) ?? { links: [] };

    links.forEach(l => allLinks.add(l));
    reporter?.recordCategory(cat.name, links.length);
  }, {
    resume:       config.resume,
    delayBetween: config.PAGE_DELAY,
  });

  return [...allLinks];
}

// ── smartSearchLinks: يجمع روابط من URL ──────────────────────

async function smartSearchLinks(pool, url, config) {
  const { extractLinks } = await import("./core/crawler-core.mjs");
  const links = await pool.withPage(async (page) => {
    const { smartLoad } = await import("./core/crawler-core.mjs");
    await smartLoad(page, url);
    return await page.evaluate((base) => {
      return [...new Set(
        Array.from(document.querySelectorAll("a[href]"))
          .map(a => a.href.split("?")[0])
          .filter(h => h.startsWith(base) && /\/cls\/\d+\.html/.test(h))
      )];
    }, new URL(url).origin);
  });
  return { links: links || [] };
}

// ============================================================
//  runSearch — بحث بالكلمات المفتاحية
// ============================================================

async function runSearch(pool, baseUrl, keywords, config, reporter) {
  const usePost = config.usePost ?? false;

  console.log(`\n🔍 وضع البحث: ${usePost ? "POST ⭐" : "GET"}`);

  let resultMap;

  if (usePost) {
    // ⭐ Stage 5: POST search
    resultMap = await postSearchMultiple(pool, baseUrl, keywords, config, {
      delayBetween: config.PAGE_DELAY,
    });
  } else {
    // Stage 3: GET search (fallback)
    resultMap = await searchMultiple(pool, baseUrl, keywords, config, {
      delayBetween: config.PAGE_DELAY,
    });
  }

  const allLinks = new Set();
  for (const [kw, links] of resultMap) {
    links.forEach(l => allLinks.add(l));
    reporter?.recordKeyword(kw, links.length);
  }

  return [...allLinks];
}

// ============================================================
//  runProbe — فحص آلية البحث
// ============================================================

async function runProbe(targetUrl) {
  console.log(`\n🔬 فحص: ${targetUrl}`);
  const pool = new BrowserPool({ maxBrowsers: 1 });

  try {
    const info = await probeSearchMechanism(pool, targetUrl);
    console.log("\n📊 نتيجة الفحص:");
    console.log(JSON.stringify(info, null, 2));
  } finally {
    await pool.close();
  }
}

// ============================================================
//  main
// ============================================================

async function main() {
  const args = parseCliArgs();

  if (args.help) { printHelp(); return; }

  // ── Probe mode ───────────────────────────────────────────
  if (args.probe) {
    await runProbe(args.probe);
    return;
  }

  // ── Status mode ──────────────────────────────────────────
  if (args.status) {
    const scheduler = new Scheduler();
    scheduler.listJobs();
    return;
  }

  // ── Validate ─────────────────────────────────────────────
  if (!args.url) {
    console.error("❌ مطلوب: --url <URL>");
    printHelp();
    process.exit(1);
  }

  const baseUrl = args.url.replace(/\/$/, "");

  // ── Config ───────────────────────────────────────────────
  const config = {
    baseUrl,
    concurrency: parseInt(args.concurrency ?? DEFAULTS.CONCURRENCY),
    MAX_PAGES:   parseInt(args["max-pages"] ?? DEFAULTS.MAX_PAGES),
    MAX_ADS:     parseInt(args["max-ads"]   ?? DEFAULTS.MAX_ADS),
    PAGE_DELAY:  DEFAULTS.PAGE_DELAY,
    AD_DELAY:    DEFAULTS.AD_DELAY,
    outputDir:   resolve(args.output ?? DEFAULTS.OUTPUT_DIR),
    formats:     (args.format ?? "excel,json").split(","),
    resume:      args.resume  ?? false,
    usePost:     args.post    ?? false,   // ⭐ Stage 5
  };

  mkdirSync(config.outputDir, { recursive: true });

  // ── Schedule mode ─────────────────────────────────────────
  if (args.schedule) {
    const scheduler = new Scheduler();
    const jobId = scheduler.addJob({
      name:     `crawl_${baseUrl}`,
      interval: args.schedule,
      command:  `node csi-crawler-v8.mjs ${process.argv.slice(2).filter(a => a !== `--schedule` && a !== args.schedule).join(" ")}`,
    });
    console.log(`\n✅ جلسة مجدولة كل ${args.schedule} | job: ${jobId}`);
    return;
  }

  // ── Reporter ──────────────────────────────────────────────
  const sessionName = `crawl_${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}`;
  const reporter    = createReporter(sessionName, { outputDir: resolve(config.outputDir, "reports") });
  reporter.start();

  // ── Pool ──────────────────────────────────────────────────
  const pool = new BrowserPool({ maxBrowsers: config.concurrency });

  try {
    let links = [];

    // ── اكتشاف الروابط ──────────────────────────────────────
    if (args.categories) {
      console.log("\n📂 وضع: تصفح الفئات");
      links = await runCategories(pool, baseUrl, config, reporter);
    } else if (args.search) {
      const keywords = args.search.split(",").map(k => k.trim()).filter(Boolean);
      console.log(`\n🔍 وضع: بحث (${keywords.length} كلمة${config.usePost ? " — POST ⭐" : ""})`);
      links = await runSearch(pool, baseUrl, keywords, config, reporter);
    } else {
      // الوضع الافتراضي: صفحة البداية
      console.log("\n🏠 وضع: صفحة البداية");
      const { links: homeLinks } = await smartSearchLinks(pool, baseUrl, config);
      links = homeLinks;
    }

    // تحديد الحد الأقصى
    links = [...new Set(links)].slice(0, config.MAX_ADS);
    reporter.set("adsFound", links.length);

    if (links.length === 0) {
      console.log("\n⚠️  لم تُعثر على إعلانات.");
      reporter.end();
      reporter.printSummary();
      return;
    }

    console.log(`\n📌 ${links.length} رابط فريد للسحب`);

    // ── سحب التفاصيل ──────────────────────────────────────────
    const ads = await scrapeLinks(pool, links, config, reporter);

    // ── التصدير ──────────────────────────────────────────────
    if (ads.length > 0) {
      console.log("\n💾 تصدير النتائج...");
      const exported = await exportAll(ads, {
        outputDir: config.outputDir,
        filename:  sessionName,
        formats:   config.formats,
      });

      if (exported.excel) reporter.set("exportedExcel", true);
      if (exported.json)  reporter.set("exportedJson",  true);
      if (exported.csv)   reporter.set("exportedCsv",   true);
    }

    // ── تقرير نهائي ───────────────────────────────────────────
    reporter.end();
    reporter.printSummary();
    reporter.saveReport();

  } finally {
    await pool.close();
  }
}

main().catch(err => {
  console.error("\n💥 خطأ غير متوقع:", err.message);
  process.exit(1);
});

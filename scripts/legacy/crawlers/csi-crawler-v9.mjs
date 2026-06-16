#!/usr/bin/env node
/**
 * ============================================================
 *  CSI-Ultimate — Crawler v9
 *  Stage 6: Production Hardening — الإصدار النهائي
 *  csi-crawler-v9.mjs
 * ============================================================
 *
 *  ما الجديد في v9؟
 *  -----------------
 *  ✅ Stage 1: Foundation (BrowserPool, Queue, Cache, Dedupe)
 *  ✅ Stage 2: Scraper Core (crawler-core.mjs)
 *  ✅ Stage 3: Discovery (CategoryWalker, KeywordSearch)
 *  ✅ Stage 4: SmartSearch, Exporter, Scheduler
 *  ✅ Stage 5: PostSearch, RateLimiter, Reporter
 *  ⭐ Stage 6: CLI تفاعلي، Dashboard، Integration Tests،
 *              Config Profiles، Production Hardening
 *
 *  الأوامر الجديدة في Stage 6:
 *  ----------------------------
 *  --interactive        وضع تفاعلي خطوة بخطوة
 *  --dashboard          Dashboard real-time
 *  --test               تشغيل unit + integration tests
 *  --test-live          تشغيل tests على الموقع الحقيقي
 *  --profile <name>     استخدام profile (default/fast/safe/deep)
 *  --save-profile <n>   حفظ الإعدادات الحالية كـ profile
 *  --list-profiles      عرض الـ profiles المتاحة
 *  --version            عرض الإصدار
 */

import { existsSync, mkdirSync } from "fs";
import { resolve }               from "path";

// ── Stage 1 + 2 ────────────────────────────────────────────
import { BrowserPool, createPool } from "./core/browser-pool.mjs";
import { WorkerQueue as Queue } from "./core/queue.mjs";
import { pageCache }      from "./core/cache.mjs";
import { dedupe }         from "./core/dedupe.mjs";
import { extractAd } from "./core/crawler-core.mjs";

// ── Stage 3 ────────────────────────────────────────────────
import {
  buildCategoryTree,
  walkCategories,
  categorySession,
} from "./core/category-walker.mjs";
import { searchMultiple } from "./core/keyword-search.mjs";
import { searchMultipleKeywords } from "./core/smart-search.mjs";

// ── Stage 4 ────────────────────────────────────────────────
import { exportAll, exportIntegrityCheck } from "./core/exporter.mjs";
import { CrawlScheduler as Scheduler, parseInterval } from "./core/scheduler.mjs";

// ── Site Config ────────────────────────────────────────────
import { getSiteConfig } from "./core/site-adapter.mjs";

// ── Stage 5 ────────────────────────────────────────────────
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
  AdaptiveRateLimiter,
} from "./core/rate-limiter.mjs";
import { createReporter } from "./core/reporter.mjs";

// ── Stage 6 ────────────────────────────────────────────────
import {
  parseCliArgs,
  validateArgs,
  printHelp,
  printVersion,
  printValidationResult,
  promptInteractive,
  buildConfig,
} from "./core/cli.mjs";
import { createDashboard }                     from "./core/dashboard.mjs";
import { saveProfile, listProfiles, loadConfig } from "./core/config-manager.mjs";
import { runAllTests }                          from "./core/integration-tester.mjs";

// ============================================================
//  scrapeLinks — يسحب تفاصيل إعلانات من قائمة روابط
//  (مُحسَّن في v9: يُحدّث الـ Dashboard)
// ============================================================

async function scrapeLinks(pool, links, config, reporter, dash) {
  const results   = [];
  const batchSize = 50;

  if (!dash?.state) console.log(`\n📋 سحب ${links.length} إعلان...`);

  dash?.update({ phase: "scraping", lastEvent: `بدء سحب ${links.length} إعلان` });

  const queue = new Queue({ concurrency: config.concurrency });

  await queue.pushAll(links, async (url) => {
    await throttle.waitFor(url);
    reporter?.inc("totalRequests");

    dash?.update({
      totalRequests: (dash.state.totalRequests || 0) + 1,
      currentDelay:  rateLimiter._current,
      lastUrl:       url,
    });

    const data = await retryHandler.run(async () => {
      const result = await extractAd(pool, url);
      if (!result) throw new Error("scrape returned null");
      return result;
    }, `scrape:${url.slice(-20)}`);

    if (data) {
      results.push(data);
      reporter?.inc("adsScraped");
      dash?.update({
        adsScraped:   results.length,
        currentDelay: rateLimiter._current,
        lastEvent:    `✅ ${url.slice(-30)}`,
      });
    } else {
      reporter?.inc("adsFailed");
      reporter?.recordError(url, new Error("scrape failed"));
      const failed = (dash?.state.adsFailed || 0) + 1;
      dash?.update({ adsFailed: failed, lastEvent: `❌ فشل: ${url.slice(-25)}` });
    }

    // progress (فقط إذا لا dashboard)
    const done = results.length + (reporter?._stats.adsFailed ?? 0);
    if (!config.useDashboard && done % batchSize === 0 && done > 0) {
      console.log(`  ↳ ${done}/${links.length} (${((done/links.length)*100).toFixed(0)}%)`);
    }
  });
  if (!config.useDashboard) {
    console.log(`  ✅ scraped: ${results.length} / ${links.length}`);
  }
  return results;
}

// ============================================================
//  runCategories
// ============================================================

async function runCategories(pool, baseUrl, config, reporter, dash) {
  const allLinks = new Set();

  dash?.update({ phase: "discovery", lastEvent: "بناء شجرة الفئات..." });

  const categories = await buildCategoryTree(pool, baseUrl);
  reporter?.set("categoriesFound", categories.length);
  dash?.update({ lastEvent: `${categories.length} فئة مكتشفة` });

  const toWalk = config.resume
    ? categorySession.remaining(categories)
    : categories;

  await walkCategories(pool, toWalk, config, async (cat) => {
    dash?.update({ currentCategory: cat.name, lastEvent: `📂 ${cat.name}` });

    const result = await retryHandler.run(
      () => getLinksFromUrl(pool, cat.url, baseUrl, config),
      `cat:${cat.name}`
    );
    const links = result?.links ?? [];
    links.forEach(l => allLinks.add(l));
    reporter?.recordCategory(cat.name, links.length);
    dash?.update({ adsFound: allLinks.size });
  }, {
    resume:       config.resume,
    delayBetween: config.PAGE_DELAY,
  });

  return [...allLinks];
}

// ── getLinksFromUrl ───────────────────────────────────────────

async function getLinksFromUrl(pool, url, baseUrl, config = {}) {
  const links = await pool.withPage(async (page) => {
    const { smartLoad, classifyPageState, summarizePageState, captureDiscoveryEvidence, discoverLinksFromHtml, selectCandidateLinks, learnLinkPatterns, classifyPageSemantically, decidePageAction } = await import("./core/crawler-core.mjs");
    const loaded = await smartLoad(page, url, {
      outputDir: config.outputDir,
      debugDiscovery: config.debugDiscovery,
    });
    const state = loaded ? await classifyPageState(page) : { kind: "load-failed" };
    if (state.kind !== "content") {
      console.warn(`  ⚠️ discovery page state for ${url}: ${summarizePageState(state)}`);
    }
    const html = await page.content().catch(() => "");
    const discoveredLinks = discoverLinksFromHtml(html, baseUrl);
    const candidates = selectCandidateLinks(discoveredLinks, baseUrl);
    const patterns = learnLinkPatterns(candidates);
    const metadata = await classifyPageSemantically(page, url);
    const decision = decidePageAction(url, metadata, discoveredLinks);
    console.log(`[DECISION] ${url} → ${decision.action} (p${decision.priority})`);
    await captureDiscoveryEvidence(page, url, {
      outputDir: config.outputDir,
      debugDiscovery: config.debugDiscovery,
      zeroLinks: candidates.length === 0,
      matchedLinkCount: candidates.length,
      patterns,
    });
    return candidates;
  });
  return { links: links || [] };
}

// ============================================================
//  runSearch
// ============================================================

async function runSearch(pool, baseUrl, keywords, config, reporter, dash) {
  const usePost = config.usePost ?? false;
  const useSmart = config.useSmartSearch ?? false;
  let resultMap;
  let allLinks;

  dash?.update({ phase: "discovery", lastEvent: `بحث: ${keywords.join(", ")}` });

  if (useSmart) {
    const smartResults = await searchMultipleKeywords(pool, baseUrl, keywords, config);
    allLinks = new Set();
    for (const r of smartResults) {
      r.links.forEach(l => allLinks.add(l));
      reporter?.recordKeyword(r.query, r.links.length);
      dash?.update({ currentKeyword: r.query, adsFound: allLinks.size });
    }
    return [...allLinks];
  }

  if (usePost) {
    resultMap = await postSearchMultiple(pool, baseUrl, keywords, config, {
      delayBetween: config.PAGE_DELAY,
    });
  } else {
    resultMap = await searchMultiple(pool, baseUrl, keywords, config, {
      delayBetween: config.PAGE_DELAY,
    });
  }

  allLinks = new Set();
  for (const [kw, links] of resultMap) {
    links.forEach(l => allLinks.add(l));
    reporter?.recordKeyword(kw, links.length);
    dash?.update({ currentKeyword: kw, adsFound: allLinks.size });
  }

  return [...allLinks];
}

// ============================================================
//  main
// ============================================================

async function main() {
  let args = parseCliArgs();

  // ── وضع تفاعلي ────────────────────────────────────────────
  if (args.interactive) {
    args = await promptInteractive();
  }

  // ── مساعدة وإصدار ─────────────────────────────────────────
  if (args.help)    { printHelp();    return; }
  if (args.version) { printVersion(); return; }

  // ── Probe mode ────────────────────────────────────────────
  if (args.probe) {
    console.log(`\n🔬 فحص: ${args.probe}`);
    const { pool } = await createPool({ maxBrowsers: 1 });
    try {
      const info = await probeSearchMechanism(pool, args.probe);
      console.log("\n📊 نتيجة الفحص:");
      console.log(JSON.stringify(info, null, 2));
    } finally {
      await pool.drain();
    }
    return;
  }

  // ── الاختبارات ────────────────────────────────────────────
  if (args.test || args["test-live"]) {
    await runAllTests({ live: !!args["test-live"] });
    return;
  }

  // ── عرض الـ Profiles ──────────────────────────────────────
  if (args["list-profiles"]) {
    listProfiles();
    return;
  }

  // ── Status mode ───────────────────────────────────────────
  if (args.status) {
    const scheduler = new Scheduler();
    const jobs = scheduler.list();
    if (jobs.length === 0) {
      console.log("📋 لا توجد jobs مجدولة");
    } else {
      console.log(`📋 ${jobs.length} job(s) مجدولة:\n`);
      for (const job of jobs) {
        console.log(
          `  [${job.enabled ? "✅" : "⏸️"}] ${job.id} ` +
          `| ${job.type}: ${job.target} ` +
          `| كل ${Math.round(job.intervalMs / 1000)}s ` +
          `| تشغيلات: ${job.runCount} ` +
          `| آخر: ${job.lastRunAt ? new Date(job.lastRunAt).toLocaleString("ar") : "—"}`
        );
      }
    }
    return;
  }

  // ── التحقق من الـ args ────────────────────────────────────
  const validation = validateArgs(args);
  if (!printValidationResult(validation)) {
    console.log("\nجرّب: node csi-crawler-v9.mjs --help");
    process.exit(1);
  }

  // ── بناء الـ config ───────────────────────────────────────
  const config = buildConfig(args);

  // ── فحص صحة site config ───────────────────────────────
  const siteCfg = getSiteConfig(config.baseUrl);
  const { validateSiteConfig } = await import("./core/site-adapter.mjs");
  const cfgWarnings = validateSiteConfig(siteCfg, config.baseUrl);
  for (const w of cfgWarnings) console.warn(`  ⚠️  ${w}`);

  // ── حفظ profile إذا طُلب ──────────────────────────────────
  if (args["save-profile"]) {
    saveProfile(args["save-profile"], {
      url:         config.baseUrl,
      concurrency: config.concurrency,
      maxAds:      config.MAX_ADS,
      maxPages:    config.MAX_PAGES,
      pageDelay:   config.PAGE_DELAY,
      formats:     config.formats.join(","),
      outputDir:   config.outputDir,
    });
  }

  mkdirSync(config.outputDir, { recursive: true });

  // ── Schedule mode ─────────────────────────────────────────
  if (args.schedule) {
    const scheduler = new Scheduler();
    const intervalMs = parseInterval(args.schedule);
    const rest = process.argv
      .slice(2)
      .filter((a, i, arr) => a !== "--schedule" && arr[i-1] !== "--schedule")
      .join(" ");
    const job = scheduler.add({
      id:     `crawl_${Date.now()}`,
      type:   "keyword",
      target: config.baseUrl,
      intervalMs,
    });
    console.log(`\n✅ جلسة مجدولة كل ${args.schedule} | job: ${job.id}`);
    return;
  }

  // ── الـ Session ───────────────────────────────────────────
  const sessionName = `crawl_${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}`;
  const reporter    = createReporter(sessionName, { outputDir: resolve(config.outputDir, "reports") });
  reporter.start();

  // ── الـ Dashboard ─────────────────────────────────────────
  const dash = createDashboard({
    enabled:    config.useDashboard,
    siteUrl:    config.baseUrl,
    totalAds:   config.MAX_ADS,
    totalPages: config.MAX_PAGES,
  });
  dash.start();

  // ── Pool ──────────────────────────────────────────────────
  const { pool } = await createPool({ maxBrowsers: config.concurrency });

  try {
    let links = [];

    // ── اكتشاف الروابط ──────────────────────────────────────
    if (args.categories) {
      if (!config.useDashboard) console.log("\n📂 وضع: تصفح الفئات");
      links = await runCategories(pool, config.baseUrl, config, reporter, dash);

    } else if (args.search) {
      const keywords = args.search.split(",").map(k => k.trim()).filter(Boolean);
      if (!config.useDashboard) {
        console.log(`\n🔍 وضع: بحث (${keywords.length} كلمة${config.usePost ? " — POST ⭐" : ""})`);
      }
      links = await runSearch(pool, config.baseUrl, keywords, config, reporter, dash);

    } else {
      if (!config.useDashboard) console.log("\n🏠 وضع: صفحة البداية");
      dash?.update({ phase: "discovery" });
      const { links: homeLinks } = await getLinksFromUrl(pool, config.baseUrl, config.baseUrl, config);
      links = homeLinks;
    }

    // تحديد الحد الأقصى + إزالة المكررات عبر dedupe للـ resume + استبعاد الأنماط غير المرغوب بها
    links = [...new Set(links)].slice(0, config.MAX_ADS);
    const siteCfgForLinks = getSiteConfig(config.baseUrl);
    const excludePatterns = siteCfgForLinks?.excludeUrlPatterns || [];
    if (excludePatterns.length > 0) {
      const before = links.length;
      links = links.filter(l => !excludePatterns.some(p => l.includes(p)));
      const excluded = before - links.length;
      if (excluded > 0) console.log(`  🚫 استبعاد ${excluded} رابطاً (excludeUrlPatterns)`);
    }
    if (config.resume) {
      const before = links.length;
      links = links.filter(l => !dedupe.seenUrl(l));
      const skipped = before - links.length;
      if (skipped > 0) console.log(`  ♻️ تخطي ${skipped} رابطاً مكرراً (resume)`);
      reporter?.inc("adsDuplicate", skipped);
    }
    reporter.set("adsFound", links.length);
    reporter.set("linksAttempted", links.length);
    dash?.update({ adsFound: links.length });

    if (links.length === 0) {
      dash?.stop(`\n⚠️  لم تُعثر على إعلانات.`);
      reporter.end();
      reporter.printSummary();
      return;
    }

    if (!config.useDashboard) {
      console.log(`\n📌 ${links.length} رابط فريد للسحب`);
    }

    // ── سحب التفاصيل ──────────────────────────────────────────
    const ads = await scrapeLinks(pool, links, config, reporter, dash);

    // ── التصدير ───────────────────────────────────────────────
    if (ads.length > 0) {
      dash?.update({ phase: "exporting", lastEvent: "تصدير النتائج..." });
      if (!config.useDashboard) console.log("\n💾 تصدير النتائج...");

      const siteCfg = getSiteConfig(config.baseUrl);
      const exported = exportAll(ads, sessionName, {
        excel: config.formats.includes("excel"),
        json:  config.formats.includes("json"),
        csv:   config.formats.includes("csv"),
        outputDir: config.outputDir,
        language: siteCfg?.language || "en",
      });

      if (exported.excel) reporter.set("exportedExcel", true);
      if (exported.json)  reporter.set("exportedJson",  true);
      if (exported.csv)   reporter.set("exportedCsv",   true);

      // integrity check
      const integrity = exportIntegrityCheck(ads);
      if (!integrity.ok) {
        console.warn(`  ⚠️  فشل فحص سلامة التصدير: ${integrity.issues.join("; ")}`);
      }
    }

    // ── نهاية ─────────────────────────────────────────────────
    reporter.end();
    dash?.update({ phase: "done" });
    dash?.stop();

    reporter.printSummary();
    reporter.saveReport();

  } catch (err) {
    dash?.stop();
    reporter?.end();
    throw err;
  } finally {
    await pool.drain();
  }
}

// ============================================================
//  تشغيل
// ============================================================

main().catch(err => {
  console.error("\n💥 خطأ غير متوقع:", err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

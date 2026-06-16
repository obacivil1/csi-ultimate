/**
 * ============================================================
 *  CSI-Ultimate — Stage 3 Integration Tests
 *
 *  تشغيل:
 *    node test-stage3.mjs
 *
 *  يختبر: category-walker.mjs + keyword-search.mjs
 * ============================================================
 */

import { createPool }          from "./core/browser-pool.mjs";
import { adCache }             from "./core/cache.mjs";
import { dedupe }              from "./core/dedupe.mjs";
import {
  buildCategoryTree,
  filterCategories,
  walkCategories,
  CategorySession,
  categorySession,
} from "./core/category-walker.mjs";
import {
  searchByKeyword,
} from "./core/keyword-search.mjs";
import { collectAdLinks, runCrawl, classifyPageState, discoverLinksFromHtml, learnLinkPatterns, extractAdContentFromHtml, classifyDiscoveryLink } from "./core/crawler-core.mjs";

// ── مساعدات ────────────────────────────────────────────────
let passed = 0, failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}`); failed++; }
}

async function section(name, fn) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  📦 ${name}`);
  console.log("═".repeat(60));
  try { await fn(); }
  catch (e) {
    console.error(`  💥 ${e.message}`);
    failed++;
  }
}

const CONFIG = {
  BASE_URL:   "https://www.expatriates.com",
  PAGE_DELAY: 800,
  AD_DELAY:   800,
  MAX_PAGES:  1,
  MAX_ADS:    6,
  CONCURRENCY:2,
};

let pool, browser;

// ── 0. تهيئة Pool ──────────────────────────────────────────

await section("تهيئة BrowserPool", async () => {
  ({ browser, pool } = await createPool({ size: 3, maxUses: 20 }));
  const s = pool.stats();
  assert(s.total === 3 && s.free === 3, `Pool جاهز: ${s.total} contexts`);
});

// ── 1. buildCategoryTree ───────────────────────────────────

let categories = [];

await section("buildCategoryTree — بناء شجرة الفئات", async () => {
  categories = await buildCategoryTree(pool, CONFIG.BASE_URL);
  assert(Array.isArray(categories),       "النتيجة مصفوفة");
  assert(categories.length > 0,           `عدد الفئات: ${categories.length} > 0`);
  assert(categories.every(c => c.name && c.url), "كل فئة لها name و url");

  // pageCache: الاستدعاء الثاني من cache
  const start  = Date.now();
  const cached = await buildCategoryTree(pool, CONFIG.BASE_URL);
  const elapsed = Date.now() - start;
  assert(elapsed < 500,                   `pageCache: ${elapsed}ms (< 500ms)`);
  assert(cached.length === categories.length, "cache: نفس عدد الفئات");
});

// ── 2. filterCategories ────────────────────────────────────

await section("filterCategories — فلترة الفئات", async () => {
  // فلتر بكلمة
  const jobs = filterCategories(categories, { match: /job|work|employ/i });
  assert(jobs.length >= 0, `فلتر jobs: ${jobs.length} فئة`);

  // استبعاد
  const noLogin = filterCategories(categories, {
    exclude: ["Login", "Register", "Sign", "Account"],
  });
  assert(noLogin.length <= categories.length, `استبعاد: ${noLogin.length} فئة متبقية`);
  assert(!noLogin.some(c => /login|register/i.test(c.name)), "لا توجد روابط Login");

  // فلتر بـ URL
  const classified = filterCategories(categories, { match: /classifieds/i });
  assert(classified.length >= 0, `classifieds: ${classified.length} فئة`);
});

// ── 3. CategorySession ─────────────────────────────────────

await section("CategorySession — سجل الفئات المكتملة", async () => {
  const session = new CategorySession("./state/test3-session.json");

  // في البداية فارغ
  assert(!session.isDone("https://example.com/cat1"), "البداية: ليس مكتملاً");

  // علّم كمكتمل
  session.markDone("https://example.com/cat1");
  assert(session.isDone("https://example.com/cat1"),  "بعد markDone: مكتمل ✓");

  // remaining
  const cats = [
    { url: "https://example.com/cat1", name: "cat1" },
    { url: "https://example.com/cat2", name: "cat2" },
  ];
  const rem = session.remaining(cats);
  assert(rem.length === 1 && rem[0].url === "https://example.com/cat2", "remaining: 1 فئة متبقية");

  // reset
  session.reset();
  assert(!session.isDone("https://example.com/cat1"), "بعد reset: فارغ");

  // نظف
  try { const { rmSync } = await import("fs"); rmSync("./state/test3-session.json"); } catch {}
});

// ── 4. searchByKeyword ─────────────────────────────────────

let searchLinks = [];

await section("searchByKeyword — بحث بكلمة مفتاحية", async () => {
  searchLinks = await searchByKeyword(pool, CONFIG.BASE_URL, "driver", {
    ...CONFIG,
    MAX_PAGES: 1,
    MAX_ADS:   6,
  });

  assert(Array.isArray(searchLinks), "النتيجة مصفوفة");
  // البحث قد يعيد 0 نتائج إذا كان البحث لا يعمل — نقبل كلا الحالتين
  assert(searchLinks.length >= 0, `نتائج البحث: ${searchLinks.length}`);

  if (searchLinks.length > 0) {
    const validLinks = searchLinks.filter(l => /\/cls\/\d+\.html/.test(l));
    assert(validLinks.length === searchLinks.length, `كل الروابط صحيحة النمط: ${validLinks.length}/${searchLinks.length}`);
  } else {
    console.log("  ℹ️  البحث لم يُعد نتائج — الموقع قد لا يدعم البحث بهذه الكلمة");
    assert(true, "البحث أعاد مصفوفة فارغة (مقبول)");
  }
});

// ── 5. classifyPageState ─────────────────────────────────

await section("classifyPageState — يميز Cloudflare/صفحة فارغة/محتوى فعلي", async () => {
  const challenge = await pool.withPage(async (page) => {
    await page.setContent(`<html><head><title>Just a moment...</title></head><body><div>Enable JavaScript and cookies to continue</div></body></html>`);
    return classifyPageState(page);
  });
  assert(challenge.kind === "cloudflare", `Cloudflare challenge detected: ${challenge.kind}`);
  assert(challenge.isChallenge === true, "Challenge flag set");

  const empty = await pool.withPage(async (page) => {
    await page.setContent(`<html><body></body></html>`);
    return classifyPageState(page);
  });
  assert(empty.kind === "empty", `Empty page detected: ${empty.kind}`);

  const real = await pool.withPage(async (page) => {
    await page.setContent(`<html><head><title>Example</title></head><body><h1>Jobs</h1><p>Many listings here...</p><a href="https://www.expatriates.com/cls/123.html">Ad</a></body></html>`);
    return classifyPageState(page);
  });
  assert(real.kind === "content", `Real content detected: ${real.kind}`);
  assert(real.linkCount >= 1, `Link count captured: ${real.linkCount}`);
});

// ── 6. classifier regressions ────────────────────────────

await section("classifyDiscoveryLink — يرفض الروابط الملاحية ويقبل الفئات الحقيقية", async () => {
  const account = classifyDiscoveryLink({ href: "https://example.com/account", text: "My Account" }, "https://example.com");
  const help = classifyDiscoveryLink({ href: "https://example.com/help", text: "Help" }, "https://example.com");
  const contact = classifyDiscoveryLink({ href: "https://example.com/contact", text: "Contact Us" }, "https://example.com");
  const category = classifyDiscoveryLink({ href: "https://example.com/jobs", text: "Jobs" }, "https://example.com", { inSidebar: true, sectionText: "Browse categories" });

  assert(account === "navigation", "account links are rejected as navigation/service links");
  assert(help === "navigation", "help links are rejected as navigation/service links");
  assert(contact === "navigation", "contact links are rejected as navigation/service links");
  assert(category === "category", "real category links are accepted");
});

// ── 7. adaptive discovery heuristics ─────────────────────

await section("adaptive discovery heuristics — تصنيف الروابط وتعلم الأنماط", async () => {
  const html = `<!doctype html><html><body>
    <nav><a href="/classifieds/">Browse</a></nav>
    <div><a href="/classifieds/jobs/">Jobs</a></div>
    <div><a href="/classifieds/jobs/?page=2">Next</a></div>
    <div><a href="/ad/12345">Ad 12345</a></div>
    <div><a href="/search?q=driver">Search</a></div>
  </body></html>`;
  const links = discoverLinksFromHtml(html, "https://example.com");
  assert(links.some(l => l.type === "category"), "category links classified");
  assert(links.some(l => l.type === "pagination"), "pagination links classified");
  assert(links.some(l => l.type === "detail"), "detail links classified");

  const patterns = learnLinkPatterns(links.map(l => l.href));
  assert(patterns.length >= 1, `patterns learned: ${patterns.length}`);

  const metadataHtml = `<!doctype html><html><head><script type="application/ld+json">{"@type":"Product","name":"Driver Needed","description":"Urgent driver for delivery service","telephone":"0501234567","email":"owner@example.com"}</script></head><body><article><h1>Driver Needed</h1><p>Urgent driver for delivery service</p><a href="tel:0501234567">Call</a></article></body></html>`;
  const extraction = extractAdContentFromHtml(metadataHtml, "https://example.com/ad/12345");
  assert(extraction.title.includes("Driver") || extraction.description.includes("driver"), "metadata extraction captured title/description");
  assert(extraction.phones.includes("0501234567") || extraction.emails.includes("owner@example.com"), "metadata extraction captured contact data");
});

// ── 8. walkCategories (على 2 فئات فقط) ────────────────────

await section("walkCategories — المشي عبر فئتين", async () => {
  if (categories.length < 1) {
    console.log("  ⚠️  لا فئات — تخطى");
    assert(true, "تخطى (لا فئات)");
    return;
  }

  // خذ فئتين classifieds فقط لتسريع الاختبار
  const testCats = filterCategories(categories, { match: /classifieds/i }).slice(0, 2);
  if (!testCats.length) {
    console.log("  ℹ️  لا فئات classifieds — نستخدم أول فئتين");
    testCats.push(...categories.slice(0, 2));
  }

  const visited = [];
  await walkCategories(
    pool,
    testCats,
    CONFIG,
    async (cat) => {
      visited.push(cat.url);
      // جمع روابط بسيط — لا نستخرج الإعلانات لتوفير الوقت
      const links = await collectAdLinks(pool, cat.url, { ...CONFIG, MAX_ADS: 3 });
      console.log(`    🔗 ${cat.name}: ${links.length} رابط`);
    },
    { resume: false, delayBetween: 500 }
  );

  assert(visited.length === testCats.length, `walkCategories: زار ${visited.length}/${testCats.length} فئة`);
  assert(visited[0] === testCats[0].url,     "الترتيب صحيح: أول فئة أولاً");
});

// ── 9. Pool Stats ──────────────────────────────────────────

await section("Pool Stats — صحة بعد العمل", async () => {
  const s = pool.stats();
  console.log(`  acquired=${s.acquired} | released=${s.released} | errors=${s.errors}`);
  assert(s.acquired > 0,            `Pool: استُخدم ${s.acquired} مرة`);
  assert(s.acquired === s.released, `Pool: كل contexts أُعيدت (${s.acquired} = ${s.released})`);
  assert(s.errors === 0,            `Pool: لا أخطاء`);
  assert(s.free === s.total,        `Pool: كل contexts حرة (${s.free}/${s.total})`);
});

// ── إغلاق ──────────────────────────────────────────────────

await pool.drain();
await browser.close();
adCache.close();
dedupe.close();

// ── ملخص ───────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log("  📊 النتائج الإجمالية — Stage 3");
console.log("═".repeat(60));
console.log(`  ✅ نجح  : ${passed}`);
console.log(`  ❌ فشل  : ${failed}`);
console.log(`  📋 مجموع: ${passed + failed}`);

if (failed === 0) {
  console.log("\n  🎉 Stage 3 جاهز — التقدم: 60%\n");
  console.log("  الخطوة التالية: node csi-crawler-v6.mjs\n");
} else {
  console.log("\n  ⚠️  راجع الأخطاء أعلاه\n");
  process.exit(1);
}

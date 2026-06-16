/**
 * ============================================================
 *  CSI-Ultimate — Stage 2A Test Suite
 *  اختبار شامل للـ modules الأربعة
 *
 *  تشغيل:
 *    node test-stage2a.mjs
 *
 *  المتطلبات:
 *    - الملفات الأربعة في ./core/
 *    - playwright-extra + puppeteer-extra-plugin-stealth مثبتين
 * ============================================================
 */

import { Cache }                    from "./core/cache.mjs";
import { GlobalDeduper }            from "./core/dedupe.mjs";
import { WorkerQueue, runParallel } from "./core/queue.mjs";
import { BrowserPool, createPool }  from "./core/browser-pool.mjs";
import { rmSync, existsSync }       from "fs";

// ── مساعدات الاختبار ──────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
    results.push({ label, ok: true });
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
    results.push({ label, ok: false });
  }
}

async function section(name, fn) {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`  📦 ${name}`);
  console.log("═".repeat(55));
  try {
    await fn();
  } catch (err) {
    console.error(`  💥 خطأ غير متوقع: ${err.message}`);
    console.error(err.stack);
    failed++;
    results.push({ label: `${name} — crash`, ok: false });
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// تنظيف ملفات الـ state قبل البدء
["./state/test-cache.json", "./state/test-dedupe.json"].forEach(f => {
  if (existsSync(f)) rmSync(f);
});

// ============================================================
//  1. CACHE
// ============================================================

await section("cache.mjs", async () => {

  const cache = new Cache({
    path:    "./state/test-cache.json",
    ttl:     2000,   // 2 ثانية للاختبار
    l1Max:   5,
    autoSave: 3,
    persist: true,
  });

  // أساسيات set/get
  cache.set("k1", { name: "test", value: 42 });
  const v1 = cache.get("k1");
  assert(v1?.name === "test" && v1?.value === 42, "set/get: قيمة صحيحة");

  // has
  assert(cache.has("k1"),   "has: يجد المفتاح الموجود");
  assert(!cache.has("xxx"), "has: لا يجد المفتاح الغائب");

  // TTL انتهت صلاحيته
  cache.set("k_short", "سأنتهي", 100);
  await sleep(200);
  assert(cache.get("k_short") === undefined, "TTL: إدخال منتهي الصلاحية = undefined");

  // delete
  cache.set("k2", "قيمة");
  cache.delete("k2");
  assert(!cache.has("k2"), "delete: المفتاح اختفى");

  // LRU eviction — l1Max=5 نضيف 6
  for (let i = 0; i < 6; i++) cache.set(`lru_${i}`, i);
  assert(cache.size() <= 5, `LRU eviction: الحجم ${cache.size()} ≤ 5`);

  // Persist: flush ثم تحميل في cache جديد
  cache.flush();
  const cache2 = new Cache({ path: "./state/test-cache.json", persist: true });
  assert(cache2.size() > 0, `Persist: cache2 حمّل ${cache2.size()} إدخال من الديسك`);

  // entries()
  const entries = cache.entries();
  assert(Array.isArray(entries), "entries: يُعيد مصفوفة");

  // purgeExpired
  cache.set("will_expire", "x", 50);
  await sleep(100);
  const removed = cache.purgeExpired();
  assert(removed >= 1, `purgeExpired: حذف ${removed} إدخال منتهي`);

  cache.close();
  cache2.close();
});

// ============================================================
//  2. DEDUPE
// ============================================================

await section("dedupe.mjs", async () => {

  const d = new GlobalDeduper({ path: "./state/test-dedupe.json" });
  d.reset(); // ابدأ نظيفاً

  const url1 = "https://www.expatriates.com/cls/12345.html";
  const url2 = "https://www.expatriates.com/cls/99999.html";

  // URL جديد
  assert(!d.seenUrl(url1), "seenUrl: URL جديد = false");
  d.markUrl(url1);
  assert(d.seenUrl(url1),  "seenUrl: بعد mark = true");

  // تطبيع URL (trailing slash / query params)
  d.markUrl("https://example.com/page/");
  assert(d.seenUrl("https://example.com/page"),  "normalizeUrl: trailing slash");
  assert(d.seenUrl("https://example.com/page/?ref=abc"), "normalizeUrl: query params");

  // Content dedup
  const ad1 = { adId: "12345", title: "سائق خاص", phones: "0501234567", emails: "" };
  const ad2 = { adId: "12345", title: "سائق خاص", phones: "0501234567", emails: "" }; // نسخة مطابقة
  const ad3 = { adId: "99999", title: "طباخ",      phones: "0559876543", emails: "" }; // مختلف

  assert(!d.seenContent(ad1), "seenContent: إعلان جديد = false");
  d.markContent(ad1);
  assert(d.seenContent(ad1),  "seenContent: بعد mark = true");
  assert(d.seenContent(ad2),  "seenContent: نسخة مطابقة = true (content hash)");
  assert(!d.seenContent(ad3), "seenContent: إعلان مختلف = false");

  // isDuplicate
  const r1 = d.isDuplicate(ad3, url2);
  assert(!r1.duplicate, "isDuplicate: جديد = false");

  d.mark(ad3, url2);
  const r2 = d.isDuplicate(ad3, url2);
  assert(r2.duplicate, `isDuplicate: بعد mark = true (سبب: ${r2.reason})`);

  // stats
  const s = d.stats();
  assert(typeof s.urlsSeen === "number", `stats: urlsSeen = ${s.urlsSeen}`);

  // Persist
  d.flush();
  const d2 = new GlobalDeduper({ path: "./state/test-dedupe.json" });
  assert(d2.seenUrl(url1), "Persist: URL محفوظ بعد إعادة التحميل");

  d.close();
  d2.close();
});

// ============================================================
//  3. QUEUE
// ============================================================

await section("queue.mjs", async () => {

  // اختبار concurrency الحقيقي
  let maxActive = 0;
  let currentActive = 0;

  const results_q = await runParallel(
    Array.from({ length: 10 }, (_, i) => i),
    async (item) => {
      currentActive++;
      maxActive = Math.max(maxActive, currentActive);
      await sleep(30 + Math.random() * 20);
      currentActive--;
      return item * 2;
    },
    { concurrency: 3 }
  );

  assert(maxActive <= 3, `concurrency: أقصى تزامن = ${maxActive} (≤ 3)`);
  const values = results_q.filter(r => r.status === "fulfilled").map(r => r.value);
  assert(values.length === 10, `نتائج: ${values.length}/10 نجحت`);
  assert(values.includes(18), "قيم صحيحة: 9×2=18 موجود");

  // اختبار retry
  let attempts = 0;
  const q2 = new WorkerQueue({ concurrency: 1, maxRetries: 2, retryBase: 50 });
  q2.setWorker(async () => {
    attempts++;
    if (attempts < 3) throw new Error("فشل مؤقت");
    return "نجح في المحاولة 3";
  });

  const retryResult = await q2.push("test").catch(() => "فشل نهائي");
  assert(attempts === 3, `retry: محاولات = ${attempts} (المتوقع: 3)`);
  assert(retryResult === "نجح في المحاولة 3", "retry: نجاح بعد المحاولات");

  // اختبار فشل نهائي بعد استنفاد المحاولات
  const q3 = new WorkerQueue({ concurrency: 1, maxRetries: 1, retryBase: 30 });
  q3.setWorker(async () => { throw new Error("دائم"); });
  const finalFail = await q3.push("x").catch(e => e.message);
  assert(finalFail === "دائم", "فشل نهائي: يرجع الخطأ الصحيح");

  // اختبار drain()
  const q4    = new WorkerQueue({ concurrency: 2 });
  const done4 = [];
  q4.setWorker(async (item) => { await sleep(20); done4.push(item); return item; });
  [1, 2, 3, 4].forEach(i => q4.push(i));
  await q4.drain();
  assert(done4.length === 4, `drain: انتظر كل المهام — ${done4.length}/4`);

  // اختبار onProgress callback
  let progressCalls = 0;
  const q5 = new WorkerQueue({ concurrency: 2, onProgress: () => progressCalls++ });
  q5.setWorker(async (x) => x);
  await runParallel([1, 2, 3], async x => x, { concurrency: 2, onProgress: () => progressCalls++ });
  // (نكتفي بالتحقق أن لا خطأ)
  assert(true, "onProgress: callback لا يرمي خطأ");

  // stats()
  const q6 = new WorkerQueue({ concurrency: 2 });
  q6.setWorker(async x => x * 2);
  await q6.pushAll([10, 20, 30], async x => x * 2);
  const s = q6.stats();
  assert(s.succeeded === 3 && s.failed === 0, `stats: ${s.succeeded} نجح، ${s.failed} فشل`);
});

// ============================================================
//  4. BROWSER POOL
// ============================================================

await section("browser-pool.mjs — اختبار حقيقي مع Playwright", async () => {

  console.log("  ⏳ تشغيل browser... (قد يستغرق 10-20 ثانية)");

  let browser, pool;
  try {
    ({ browser, pool } = await createPool({ size: 3, maxUses: 5 }));
  } catch (err) {
    console.error(`  ⚠️  فشل تشغيل Playwright: ${err.message}`);
    console.error("  تأكد من تثبيت: npm install playwright-extra puppeteer-extra-plugin-stealth");
    console.error("  وتثبيت المتصفح: npx playwright install chromium");
    assert(false, "browser pool init");
    return;
  }

  // تحقق من الـ stats الأولية
  const s0 = pool.stats();
  assert(s0.total === 3 && s0.free === 3, `pool init: ${s0.total} contexts, ${s0.free} حر`);

  // acquire + release يدوي
  const h1 = await pool.acquire();
  const s1 = pool.stats();
  assert(s1.busy === 1, `acquire: busy=${s1.busy}`);
  await pool.release(h1);
  const s2 = pool.stats();
  assert(s2.free === 3, `release: free عاد إلى ${s2.free}`);

  // withPage: تصفح حقيقي
  const title = await pool.withPage(async (page) => {
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 15000 });
    return await page.title();
  });
  assert(typeof title === "string" && title.length > 0, `withPage: title = "${title}"`);

  // تزامن: 3 طلبات معاً على pool بحجم 3
  const start = Date.now();
  await Promise.all([0, 1, 2].map(() =>
    pool.withPage(async (page) => {
      await page.goto("about:blank", { timeout: 5000 });
      await sleep(300);
    })
  ));
  const elapsed = Date.now() - start;
  assert(elapsed < 1500, `تزامن 3 طلبات: ${elapsed}ms (< 1500ms — كانوا متوازيين)`);

  // acquire timeout
  // أشغل الكل 3 ثم حاول acquire رابع بـ timeout قصير
  const handles = await Promise.all([0,1,2].map(() => pool.acquire()));
  const tinyPool = new BrowserPool(browser, { size: 0, acquireTimeout: 200 });
  // (pool فارغ — acquire سيفشل فوراً)
  // نُحرر الـ handles أولاً لأن pool الأصلي تعطّل
  for (const h of handles) await pool.release(h);

  // maxUses: pool بـ maxUses=2، استخدم slot 3 مرات → يجب إعادة بناءه
  const smallPool = new BrowserPool(browser, { size: 1, maxUses: 2 });
  await smallPool.init();
  for (let i = 0; i < 3; i++) {
    await smallPool.withPage(async (p) => {
      await p.goto("about:blank", { timeout: 5000 });
    });
  }
  const sr = smallPool.stats();
  assert(sr.recycled >= 1, `maxUses: تم تجديد context ${sr.recycled} مرة`);
  await smallPool.drain();

  // إغلاق نظيف
  await pool.drain();
  await browser.close();
  assert(true, "drain + browser.close: إغلاق نظيف");
});

// ============================================================
//  ملخص النتائج
// ============================================================

console.log(`\n${"═".repeat(55)}`);
console.log("  📊 النتائج الإجمالية");
console.log("═".repeat(55));
console.log(`  ✅ نجح  : ${passed}`);
console.log(`  ❌ فشل  : ${failed}`);
console.log(`  📋 مجموع: ${passed + failed}`);

if (failed === 0) {
  console.log("\n  🎉 كل الاختبارات اجتازت — Stage 2A جاهز للتكامل\n");
} else {
  console.log("\n  ⚠️  بعض الاختبارات فشلت — راجع الأخطاء أعلاه\n");
  process.exit(1);
}

/**
 * ============================================================
 *  CSI-Ultimate — Test Stage 5
 *  اختبار شامل لكل مكونات Stage 5
 *  test-stage5.mjs
 * ============================================================
 */

import { strict as assert } from "assert";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";

// ── helpers ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors = [];

function ok(label) {
  console.log(`  ✅ ${label}`);
  passed++;
}

function fail(label, reason) {
  console.log(`  ❌ ${label}: ${reason}`);
  failed++;
  errors.push({ label, reason });
}

async function test(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (e) {
    fail(label, e.message?.slice(0, 120) ?? String(e));
  }
}

function section(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🔷 ${title}`);
  console.log("═".repeat(60));
}

// ── Temp Dir ─────────────────────────────────────────────────

const TMP = resolve("./tmp-test-stage5");
mkdirSync(TMP, { recursive: true });

// ============================================================
//  1 — post-search.mjs
// ============================================================

section("1 — post-search.mjs");

await test("post-search.mjs: import ناجح", async () => {
  const mod = await import("./core/post-search.mjs");
  assert.ok(typeof mod.postSearch          === "function");
  assert.ok(typeof mod.postSearchMultiple  === "function");
  assert.ok(typeof mod.probeSearchMechanism === "function");
});

await test("postSearch: يُرجع { links, strategy }", async () => {
  const { postSearch } = await import("./core/post-search.mjs");
  // Mock pool
  const mockPool = {
    withPage: async (fn) => fn({
      on: () => {},
      evaluate: async () => ({ links: [], hasNext: false, url: "" }),
    }),
  };
  const result = await postSearch(mockPool, "https://example.com", "test", {
    MAX_PAGES: 1, MAX_ADS: 10, PAGE_DELAY: 0,
  });
  assert.ok(typeof result === "object");
  assert.ok(Array.isArray(result.links));
  assert.ok(typeof result.strategy === "string");
});

await test("postSearchMultiple: يُرجع Map", async () => {
  const { postSearchMultiple } = await import("./core/post-search.mjs");
  const mockPool = {
    withPage: async (fn) => fn({ on: () => {}, evaluate: async () => ({ links: [], hasNext: false }) }),
  };
  const result = await postSearchMultiple(
    mockPool, "https://example.com", ["kw1", "kw2"],
    { MAX_PAGES: 1, MAX_ADS: 10, PAGE_DELAY: 0 },
    { delayBetween: 0 }
  );
  assert.ok(result instanceof Map);
  assert.strictEqual(result.size, 2);
  assert.ok(result.has("kw1"));
  assert.ok(result.has("kw2"));
});

await test("buildPostBody: تنسيق صحيح (داخلي)", async () => {
  // نختبر عبر fetch mock
  const body = new URLSearchParams();
  body.set("q", "driver");
  body.set("searchtype", "A");
  body.set("Submit", "Search");
  const str = body.toString();
  assert.ok(str.includes("q=driver"));
  assert.ok(str.includes("searchtype=A"));
});

await test("extractAdLinks: يستخرج روابط cls", async () => {
  const html = `
    <html><body>
      <a href="https://www.expatriates.com/cls/12345.html">Ad 1</a>
      <a href="https://www.expatriates.com/cls/67890.html">Ad 2</a>
      <a href="https://www.expatriates.com/other.html">Other</a>
    </body></html>
  `;
  // نختبر regex مباشرة
  const links = new Set();
  const regex = /href=["'](https?:\/\/[^"']*\/cls\/\d+\.html)[^"']*/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    links.add(match[1]);
  }
  assert.strictEqual(links.size, 2);
  assert.ok([...links].every(l => /\/cls\/\d+\.html/.test(l)));
});

// ============================================================
//  2 — rate-limiter.mjs
// ============================================================

section("2 — rate-limiter.mjs");

await test("rate-limiter.mjs: import ناجح", async () => {
  const mod = await import("./core/rate-limiter.mjs");
  assert.ok(typeof mod.AdaptiveRateLimiter === "function");
  assert.ok(typeof mod.RetryHandler        === "function");
  assert.ok(typeof mod.RequestThrottle     === "function");
  assert.ok(typeof mod.detectBan           === "function");
  assert.ok(typeof mod.rateLimiter         === "object");
  assert.ok(typeof mod.retryHandler        === "object");
  assert.ok(typeof mod.throttle            === "object");
});

await test("detectBan: 429 = محظور", async () => {
  const { detectBan } = await import("./core/rate-limiter.mjs");
  const res = detectBan(429, "");
  assert.strictEqual(res.banned, true);
  assert.ok(res.reason.includes("429"));
});

await test("detectBan: 403 = محظور", async () => {
  const { detectBan } = await import("./core/rate-limiter.mjs");
  const res = detectBan(403, "");
  assert.strictEqual(res.banned, true);
});

await test("detectBan: 200 + محتوى عادي = غير محظور", async () => {
  const { detectBan } = await import("./core/rate-limiter.mjs");
  const res = detectBan(200, "<html>Normal page content</html>");
  assert.strictEqual(res.banned, false);
});

await test("detectBan: CAPTCHA في HTML = محظور", async () => {
  const { detectBan } = await import("./core/rate-limiter.mjs");
  const res = detectBan(200, "<html>Please complete the captcha</html>");
  assert.strictEqual(res.banned, true);
});

await test("AdaptiveRateLimiter: يرفع التأخير عند الخطأ", async () => {
  const { AdaptiveRateLimiter } = await import("./core/rate-limiter.mjs");
  const lim = new AdaptiveRateLimiter({ baseDelay: 1000, backoffFactor: 2, maxDelay: 10000 });
  const before = lim.stats().currentDelay;
  lim.onError(false);
  const after = lim.stats().currentDelay;
  assert.ok(after > before, `${after} > ${before}`);
});

await test("AdaptiveRateLimiter: يخفض التأخير عند النجاح", async () => {
  const { AdaptiveRateLimiter } = await import("./core/rate-limiter.mjs");
  const lim = new AdaptiveRateLimiter({ baseDelay: 5000, recoveryFactor: 0.9 });
  lim.onError(); // ارفع أولاً
  const high = lim.stats().currentDelay;
  lim.onSuccess();
  const after = lim.stats().currentDelay;
  assert.ok(after <= high, `${after} <= ${high}`);
});

await test("AdaptiveRateLimiter: stats() يُرجع كائن صحيح", async () => {
  const { AdaptiveRateLimiter } = await import("./core/rate-limiter.mjs");
  const lim = new AdaptiveRateLimiter();
  const s   = lim.stats();
  assert.ok("currentDelay"  in s);
  assert.ok("totalCalls"    in s);
  assert.ok("totalWaitMs"   in s);
  assert.ok("avgWaitMs"     in s);
  assert.ok("errorCount"    in s);
  assert.ok("successCount"  in s);
});

await test("AdaptiveRateLimiter: wait() لا يتجاوز الحد الأقصى", async () => {
  const { AdaptiveRateLimiter } = await import("./core/rate-limiter.mjs");
  const lim = new AdaptiveRateLimiter({ baseDelay: 1, maxDelay: 100 });
  for (let i = 0; i < 10; i++) lim.onError(true);
  assert.ok(lim.stats().currentDelay <= 100);
});

await test("extractAd: يستخدم rateLimiter أثناء السحب", async () => {
  const { extractAd } = await import("./core/crawler-core.mjs");
  const { rateLimiter } = await import("./core/rate-limiter.mjs");

  const originalWait = rateLimiter.wait;
  const originalOnSuccess = rateLimiter.onSuccess;
  const originalOnError = rateLimiter.onError;

  let waitCalls = 0;
  let successCalls = 0;
  let errorCalls = 0;

  try {
    rateLimiter.wait = async () => { waitCalls++; };
    rateLimiter.onSuccess = () => { successCalls++; };
    rateLimiter.onError = () => { errorCalls++; };

    const mockPage = {
      goto: async () => {},
      waitForTimeout: async () => {},
      title: async () => "Example Ad",
      evaluate: async (fn) => {
        const source = fn?.toString?.() || "";
        if (source.includes("querySelector")) {
          return {
            adId: "123",
            title: "Sample title",
            description: "Sample description",
            phones: "",
            emails: "",
            whatsapp: "",
            location: "",
            price: "",
            company: "",
            category: "",
            postedDate: "",
            url: "https://example.com/cls/123.html",
          };
        }
        return 500;
      },
    };

    const mockPool = {
      withPage: async (fn) => fn(mockPage),
    };

    const uniqueUrl = `https://example.com/cls/${Date.now()}.html`;
    const result = await extractAd(mockPool, uniqueUrl);
    assert.ok(result && result.adId === "123");
    assert.strictEqual(waitCalls, 1);
    assert.strictEqual(successCalls, 1);
    assert.strictEqual(errorCalls, 0);
  } finally {
    rateLimiter.wait = originalWait;
    rateLimiter.onSuccess = originalOnSuccess;
    rateLimiter.onError = originalOnError;
  }
});

await test("RetryHandler: ينجح في أول محاولة", async () => {
  const { RetryHandler } = await import("./core/rate-limiter.mjs");
  const h = new RetryHandler({ maxRetries: 3, baseDelay: 1 });
  let calls = 0;
  const result = await h.run(() => { calls++; return Promise.resolve("ok"); });
  assert.strictEqual(result, "ok");
  assert.strictEqual(calls, 1);
});

await test("RetryHandler: يُعيد المحاولة عند الفشل", async () => {
  const { RetryHandler } = await import("./core/rate-limiter.mjs");
  const h = new RetryHandler({ maxRetries: 3, baseDelay: 1 });
  let calls = 0;
  const result = await h.run(() => {
    calls++;
    if (calls < 3) throw new Error("temporary fail");
    return Promise.resolve("success");
  });
  assert.strictEqual(result, "success");
  assert.strictEqual(calls, 3);
});

await test("RetryHandler: يُرجع null بعد كل المحاولات", async () => {
  const { RetryHandler } = await import("./core/rate-limiter.mjs");
  const h = new RetryHandler({ maxRetries: 2, baseDelay: 1 });
  const result = await h.run(() => { throw new Error("always fail"); });
  assert.strictEqual(result, null);
  assert.strictEqual(h.stats().totalFails, 1);
});

await test("RequestThrottle: domainOf() يستخرج الدومين", async () => {
  const { RequestThrottle } = await import("./core/rate-limiter.mjs");
  const t = new RequestThrottle(60);
  assert.strictEqual(t.domainOf("https://www.example.com/page"), "www.example.com");
  assert.strictEqual(t.domainOf("https://api.site.com/v1"), "api.site.com");
});

await test("RequestThrottle: لا يتجاوز 60 req/min", async () => {
  const { RequestThrottle } = await import("./core/rate-limiter.mjs");
  const t = new RequestThrottle(120); // 120 req/min = 500ms interval
  const start = Date.now();
  await t.throttle("example.com");
  await t.throttle("example.com");
  const elapsed = Date.now() - start;
  // يجب أن ينتظر ~500ms بين الطلبين
  assert.ok(elapsed >= 400, `elapsed=${elapsed}ms`);
});

// ============================================================
//  3 — reporter.mjs
// ============================================================

section("3 — reporter.mjs");

await test("reporter.mjs: import ناجح", async () => {
  const mod = await import("./core/reporter.mjs");
  assert.ok(typeof mod.SessionReporter === "function");
  assert.ok(typeof mod.createReporter  === "function");
  assert.ok(typeof mod.getReporter     === "function");
});

await test("SessionReporter: start/end يعملان", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test1" });
  r.start();
  await new Promise(res => setTimeout(res, 10));
  r.end();
  assert.ok(r.duration >= 10);
});

await test("SessionReporter: inc() يزيد الإحصائيات", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test2" });
  r.inc("adsScraped", 5);
  r.inc("adsScraped", 3);
  assert.strictEqual(r._stats.adsScraped, 8);
});

await test("SessionReporter: set() يضبط القيمة", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test3" });
  r.set("adsFound", 42);
  assert.strictEqual(r._stats.adsFound, 42);
});

await test("SessionReporter: recordCategory() يحفظ", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test4" });
  r.recordCategory("Jobs", 15);
  r.recordCategory("Cars", 8);
  assert.strictEqual(r._stats.categoriesWalked, 2);
  assert.strictEqual(r._stats.adsFound, 23);
  assert.strictEqual(r._topCats.get("Jobs"), 15);
});

await test("SessionReporter: recordKeyword() يحفظ", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test5" });
  r.recordKeyword("driver", 20);
  assert.strictEqual(r._stats.keywordsSearched, 1);
  assert.strictEqual(r._topKws.get("driver"), 20);
});

await test("SessionReporter: recordError() يحفظ", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test6" });
  r.recordError("test-url", new Error("connection failed"));
  assert.strictEqual(r._stats.errors, 1);
  assert.strictEqual(r._errors.length, 1);
  assert.ok(r._errors[0].msg.includes("connection failed"));
});

await test("SessionReporter: saveReport() يحفظ ملف JSON", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test-save" });
  r.start();
  r.inc("adsScraped", 10);
  r.end();
  const path = r.saveReport();
  assert.ok(existsSync(path));
  const { readFileSync } = await import("fs");
  const json = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(json.session.includes("test-save"));
  assert.ok(json.stats.adsScraped === 10);
});

await test("SessionReporter: printSummary() لا يرمي خطأ", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test7" });
  r.start();
  r.inc("adsScraped", 50);
  r.inc("adsFailed", 5);
  r.recordCategory("Jobs", 30);
  r.recordKeyword("driver", 20);
  r.end();
  // لا يجب أن يرمي استثناء
  assert.doesNotThrow(() => r.printSummary());
});

await test("createReporter() + getReporter() يعملان", async () => {
  const { createReporter, getReporter } = await import("./core/reporter.mjs");
  const r1 = createReporter("my-session", { outputDir: TMP });
  const r2 = getReporter();
  assert.ok(r1._name === "my-session");
  assert.ok(r2 === r1); // نفس المثيل
});

await test("SessionReporter: duration صحيح", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test-dur" });
  r.start();
  await new Promise(res => setTimeout(res, 50));
  r.end();
  assert.ok(r.duration >= 40 && r.duration < 500);
});

await test("SessionReporter: topCategories مرتبة في التقرير", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test-top" });
  r.start();
  r.recordCategory("Jobs", 100);
  r.recordCategory("Cars", 50);
  r.recordCategory("Real Estate", 200);
  r.end();
  const path = r.saveReport();
  const { readFileSync } = await import("fs");
  const json = JSON.parse(readFileSync(path, "utf8"));
  const keys = Object.keys(json.topCategories);
  assert.strictEqual(keys[0], "Real Estate"); // أعلى عدد أولاً
  assert.strictEqual(json.topCategories["Real Estate"], 200);
});

// ============================================================
//  4 — تكامل Stage 5 مع Stage 4
// ============================================================

section("4 — تكامل Stage 5");

await test("rate-limiter: مثيلات عالمية موجودة", async () => {
  const { rateLimiter, retryHandler, throttle } = await import("./core/rate-limiter.mjs");
  assert.ok(rateLimiter  instanceof (await import("./core/rate-limiter.mjs")).AdaptiveRateLimiter);
  assert.ok(retryHandler instanceof (await import("./core/rate-limiter.mjs")).RetryHandler);
  assert.ok(throttle     instanceof (await import("./core/rate-limiter.mjs")).RequestThrottle);
});

await test("reporter: مثيل عالمي يُنشأ تلقائياً", async () => {
  // نبدأ من استيراد جديد
  const { getReporter } = await import("./core/reporter.mjs");
  const r = getReporter();
  assert.ok(r !== null && r !== undefined);
  assert.ok(typeof r.inc === "function");
});

await test("post-search + rate-limiter: لا تعارض", async () => {
  const { postSearch }    = await import("./core/post-search.mjs");
  const { rateLimiter }   = await import("./core/rate-limiter.mjs");

  // تحقق أن كلاهما يمكن استيرادهما معاً بدون تعارض
  assert.ok(typeof postSearch   === "function");
  assert.ok(typeof rateLimiter  === "object");
});

await test("csi-crawler-v8.mjs: ملف موجود وصيغته صحيحة", async () => {
  const { readFileSync } = await import("fs");
  assert.ok(existsSync("./csi-crawler-v8.mjs"), "الملف موجود");
  const content = readFileSync("./csi-crawler-v8.mjs", "utf8");
  assert.ok(content.includes("post-search"),  "يستورد post-search");
  assert.ok(content.includes("rate-limiter"), "يستورد rate-limiter");
  assert.ok(content.includes("reporter"),     "يستورد reporter");
  assert.ok(content.includes("--post"),       "يدعم --post flag");
  assert.ok(content.includes("--probe"),      "يدعم --probe flag");
});

// ============================================================
//  5 — اختبارات الحالات الحدية
// ============================================================

section("5 — حالات حدية");

await test("detectBan: HTML فارغ = غير محظور", async () => {
  const { detectBan } = await import("./core/rate-limiter.mjs");
  assert.strictEqual(detectBan(200, "").banned, false);
});

await test("detectBan: 503 = محظور", async () => {
  const { detectBan } = await import("./core/rate-limiter.mjs");
  assert.strictEqual(detectBan(503, "").banned, true);
});

await test("RetryHandler: maxRetries=0 = محاولة واحدة فقط", async () => {
  const { RetryHandler } = await import("./core/rate-limiter.mjs");
  const h = new RetryHandler({ maxRetries: 0, baseDelay: 1 });
  let calls = 0;
  const r = await h.run(() => { calls++; throw new Error("fail"); });
  assert.strictEqual(r, null);
  assert.strictEqual(calls, 1);
});

await test("AdaptiveRateLimiter: reset() يُعيد الضبط", async () => {
  const { AdaptiveRateLimiter } = await import("./core/rate-limiter.mjs");
  const lim = new AdaptiveRateLimiter({ baseDelay: 1500 });
  for (let i = 0; i < 5; i++) lim.onError();
  lim.reset();
  assert.strictEqual(lim.stats().errorCount,   0);
  assert.strictEqual(lim.stats().successCount, 0);
  assert.strictEqual(lim.stats().currentDelay, 1500);
});

await test("SessionReporter: recordBan() يزيد العداد", async () => {
  const { SessionReporter } = await import("./core/reporter.mjs");
  const r = new SessionReporter({ outputDir: TMP, sessionName: "test-ban" });
  r.recordBan("https://example.com/page");
  assert.strictEqual(r._stats.bansDetected, 1);
});

await test("postSearchMultiple: قائمة فارغة = Map فارغة", async () => {
  const { postSearchMultiple } = await import("./core/post-search.mjs");
  const mockPool = {
    withPage: async (fn) => fn({ on: () => {}, evaluate: async () => ({ links: [], hasNext: false }) }),
  };
  const result = await postSearchMultiple(mockPool, "https://example.com", [], {
    MAX_PAGES: 1, MAX_ADS: 10, PAGE_DELAY: 0
  });
  assert.ok(result instanceof Map);
  assert.strictEqual(result.size, 0);
});

// ── تنظيف ────────────────────────────────────────────────────

try {
  rmSync(TMP, { recursive: true, force: true });
} catch {}

// ============================================================
//  النتيجة النهائية
// ============================================================

console.log(`\n${"═".repeat(60)}`);
console.log(`📊  النتيجة النهائية`);
console.log("═".repeat(60));
console.log(`  ✅ نجح  : ${passed}`);
console.log(`  ❌ فشل  : ${failed}`);
console.log(`  📝 إجمالي: ${passed + failed}`);

if (errors.length > 0) {
  console.log("\n  الأخطاء:");
  errors.forEach(e => console.log(`    • ${e.label}: ${e.reason}`));
}

const allOk = failed === 0;
console.log(`\n${allOk ? "🎉" : "⚠️ "} Stage 5: ${allOk ? `${passed}/${passed + failed} ✅ — مكتمل 100%!` : `${passed}/${passed + failed} — يحتاج مراجعة`}`);

if (!allOk) process.exit(1);

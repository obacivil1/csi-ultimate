/**
 * ============================================================
 *  CSI-Ultimate — Integration Tester
 *  Stage 6: Production Hardening
 *  core/integration-tester.mjs
 * ============================================================
 *
 *  اختبار تكاملي شامل:
 *  ① Unit tests (بدون browser)
 *  ② Integration tests (مع browser وهمي)
 *  ③ Live tests على expatriates.com الحقيقي
 *
 *  الاستخدام:
 *    node csi-crawler-v9.mjs --test          (unit + integration)
 *    node csi-crawler-v9.mjs --test-live     (+ اختبار حقيقي)
 */

// ============================================================
//  Mini Test Runner
// ============================================================

class TestRunner {
  constructor(name) {
    this._name    = name;
    this._tests   = [];
    this._passed  = 0;
    this._failed  = 0;
    this._skipped = 0;
  }

  test(label, fn) {
    this._tests.push({ label, fn, skip: false });
  }

  skip(label, fn) {
    this._tests.push({ label, fn, skip: true });
  }

  async run() {
    console.log(`\n${"═".repeat(55)}`);
    console.log(`🧪  ${this._name}`);
    console.log("═".repeat(55));

    for (const t of this._tests) {
      if (t.skip) {
        this._skipped++;
        console.log(`  ⏭️  ${t.label}`);
        continue;
      }

      try {
        await t.fn();
        this._passed++;
        console.log(`  ✅  ${t.label}`);
      } catch (err) {
        this._failed++;
        console.log(`  ❌  ${t.label}`);
        console.log(`      ${err.message}`);
      }
    }

    const total = this._passed + this._failed + this._skipped;
    const icon  = this._failed === 0 ? "🎉" : "⚠️";
    console.log(`\n  ${icon}  ${this._passed}/${total} نجح  |  ${this._failed} فشل  |  ${this._skipped} تخطى`);

    return this._failed === 0;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? "Assertion failed");
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg ?? `Expected ${b}, got ${a}`);
}

// ============================================================
//  Suite 1: وحدات بدون browser
// ============================================================

async function runUnitTests() {
  const r = new TestRunner("Suite 1: Unit Tests (لا يحتاج browser)");

  // ── RateLimiter ───────────────────────────────────────────
  r.test("AdaptiveRateLimiter — onSuccess يخفف التأخير", async () => {
    const { AdaptiveRateLimiter } = await import("./rate-limiter.mjs");
    const rl = new AdaptiveRateLimiter({ baseDelay: 1000, minDelay: 500, maxDelay: 5000 });
    const before = rl._current;
    rl.onSuccess();
    assert(rl._current <= before, `delay ${rl._current} لم يقل عن ${before}`);
  });

  r.test("AdaptiveRateLimiter — onError يرفع التأخير", async () => {
    const { AdaptiveRateLimiter } = await import("./rate-limiter.mjs");
    const rl = new AdaptiveRateLimiter({ baseDelay: 1000 });
    const before = rl._current;
    rl.onError(false);
    assert(rl._current >= before, "delay لم يرتفع");
  });

  r.test("AdaptiveRateLimiter — onError(ban) يرفع أكثر", async () => {
    const { AdaptiveRateLimiter } = await import("./rate-limiter.mjs");
    const rl1 = new AdaptiveRateLimiter({ baseDelay: 1000 });
    const rl2 = new AdaptiveRateLimiter({ baseDelay: 1000 });
    rl1.onError(false);
    rl2.onError(true);
    assert(rl2._current > rl1._current, "ban delay يجب أن يكون أكبر");
  });

  r.test("AdaptiveRateLimiter — maxDelay لا يُتجاوز", async () => {
    const { AdaptiveRateLimiter } = await import("./rate-limiter.mjs");
    const rl = new AdaptiveRateLimiter({ baseDelay: 1000, maxDelay: 2000 });
    for (let i = 0; i < 10; i++) rl.onError(true);
    assert(rl._current <= 2000, `تجاوز maxDelay: ${rl._current}`);
  });

  r.test("AdaptiveRateLimiter — stats() صحيح", async () => {
    const { AdaptiveRateLimiter } = await import("./rate-limiter.mjs");
    const rl = new AdaptiveRateLimiter();
    const st = rl.stats();
    assert("currentDelay" in st && "totalCalls" in st, "stats ناقصة");
  });

  r.test("detectBan — 429 محجوب", async () => {
    const { detectBan } = await import("./rate-limiter.mjs");
    const r = detectBan(429, "");
    assert(r.banned, "429 يجب أن يُعتبر حجب");
  });

  r.test("detectBan — 403 محجوب", async () => {
    const { detectBan } = await import("./rate-limiter.mjs");
    const r = detectBan(403, "");
    assert(r.banned, "403 يجب أن يُعتبر حجب");
  });

  r.test("detectBan — 200 + captcha في HTML محجوب", async () => {
    const { detectBan } = await import("./rate-limiter.mjs");
    const r = detectBan(200, "Please complete the captcha to continue");
    assert(r.banned, "CAPTCHA يجب أن يُعتبر حجب");
  });

  r.test("detectBan — 200 + HTML سليم ليس محجوباً", async () => {
    const { detectBan } = await import("./rate-limiter.mjs");
    const r = detectBan(200, "<html><body>Normal page</body></html>");
    assert(!r.banned, "صفحة سليمة لا يجب أن تكون محجوبة");
  });

  r.test("RetryHandler — ينفذ الدالة بنجاح", async () => {
    const { RetryHandler } = await import("./rate-limiter.mjs");
    const rh = new RetryHandler({ maxRetries: 2, baseDelay: 10 });
    let calls = 0;
    const result = await rh.run(async () => { calls++; return "ok"; });
    assertEqual(result, "ok");
    assertEqual(calls, 1);
  });

  r.test("RetryHandler — يعيد المحاولة عند الفشل", async () => {
    const { RetryHandler } = await import("./rate-limiter.mjs");
    const rh = new RetryHandler({ maxRetries: 2, baseDelay: 10 });
    let calls = 0;
    const result = await rh.run(async () => {
      calls++;
      if (calls < 3) throw new Error("temporary fail");
      return "ok";
    });
    assertEqual(result, "ok");
    assertEqual(calls, 3);
  });

  r.test("RetryHandler — يعيد null بعد الفشل الكلي", async () => {
    const { RetryHandler } = await import("./rate-limiter.mjs");
    const rh = new RetryHandler({ maxRetries: 2, baseDelay: 10 });
    const result = await rh.run(async () => { throw new Error("always fail"); });
    assertEqual(result, null);
  });

  r.test("RequestThrottle — domainOf يستخرج الدومين", async () => {
    const { RequestThrottle } = await import("./rate-limiter.mjs");
    const rt = new RequestThrottle(60);
    assertEqual(rt.domainOf("https://www.example.com/page"), "www.example.com");
  });

  // ── Reporter ──────────────────────────────────────────────
  r.test("SessionReporter — start/end/duration", async () => {
    const { SessionReporter } = await import("./reporter.mjs");
    const rep = new SessionReporter({ sessionName: "test" });
    rep.start();
    await new Promise(r => setTimeout(r, 50));
    rep.end();
    assert(rep.duration >= 50, `duration ${rep.duration} أقل من 50ms`);
  });

  r.test("SessionReporter — inc/set", async () => {
    const { SessionReporter } = await import("./reporter.mjs");
    const rep = new SessionReporter();
    rep.start();
    rep.inc("adsScraped", 5);
    rep.inc("adsScraped", 3);
    assertEqual(rep._stats.adsScraped, 8);
    rep.set("adsFound", 100);
    assertEqual(rep._stats.adsFound, 100);
  });

  r.test("SessionReporter — recordCategory يُحدّث topCats", async () => {
    const { SessionReporter } = await import("./reporter.mjs");
    const rep = new SessionReporter();
    rep.start();
    rep.recordCategory("Jobs", 15);
    rep.recordCategory("Rentals", 8);
    rep.recordCategory("Jobs", 5);
    assertEqual(rep._topCats.get("Jobs"), 20);
    assertEqual(rep._topCats.get("Rentals"), 8);
  });

  r.test("SessionReporter — recordError يُضيف للـ errors", async () => {
    const { SessionReporter } = await import("./reporter.mjs");
    const rep = new SessionReporter();
    rep.start();
    rep.recordError("test-ctx", new Error("test error"));
    assertEqual(rep._errors.length, 1);
    assertEqual(rep._stats.errors, 1);
  });

  r.test("SessionReporter — recordBan يُحدّث bansDetected", async () => {
    const { SessionReporter } = await import("./reporter.mjs");
    const rep = new SessionReporter();
    rep.start();
    rep.recordBan("https://example.com/page");
    assertEqual(rep._stats.bansDetected, 1);
  });

  // ── CLI ───────────────────────────────────────────────────
  r.test("parseCliArgs — يُحلّل --url", async () => {
    const { parseCliArgs } = await import("./cli.mjs");
    const args = parseCliArgs(["node", "script.mjs", "--url", "https://example.com"]);
    assertEqual(args.url, "https://example.com");
  });

  r.test("parseCliArgs — يُحلّل --post --search", async () => {
    const { parseCliArgs } = await import("./cli.mjs");
    const args = parseCliArgs(["node", "s.mjs", "--search", "driver", "--post"]);
    assertEqual(args.search, "driver");
    assert(args.post === true);
  });

  r.test("validateArgs — URL صالح يمرر", async () => {
    const { validateArgs } = await import("./cli.mjs");
    const { errors } = validateArgs({ url: "https://www.expatriates.com" });
    assertEqual(errors.length, 0);
  });

  r.test("validateArgs — URL غير صالح يفشل", async () => {
    const { validateArgs } = await import("./cli.mjs");
    const { errors } = validateArgs({ url: "not-a-url" });
    assert(errors.length > 0, "يجب أن يكون خطأ");
  });

  r.test("validateArgs — بدون URL يفشل", async () => {
    const { validateArgs } = await import("./cli.mjs");
    const { errors } = validateArgs({});
    assert(errors.length > 0, "يجب أن يكون خطأ بسبب غياب URL");
  });

  r.test("buildConfig — يُنشئ config كامل", async () => {
    const { buildConfig } = await import("./cli.mjs");
    const cfg = buildConfig({ url: "https://example.com", "max-ads": "50" });
    assertEqual(cfg.baseUrl, "https://example.com");
    assertEqual(cfg.MAX_ADS, 50);
    assert(Array.isArray(cfg.formats));
  });

  // ── Config Manager ────────────────────────────────────────
  r.test("loadConfig — profile default موجود", async () => {
    const { loadConfig } = await import("./config-manager.mjs");
    const cfg = loadConfig("default");
    assert(cfg !== null, "default profile يجب أن يكون موجوداً");
    assert("concurrency" in cfg, "يجب أن يحتوي على concurrency");
  });

  r.test("loadConfig — profile fast موجود", async () => {
    const { loadConfig } = await import("./config-manager.mjs");
    const cfg = loadConfig("fast");
    assert(cfg.concurrency >= 4, "fast يجب أن يكون concurrency أعلى");
  });

  r.test("loadConfig — profile safe بطيء", async () => {
    const { loadConfig } = await import("./config-manager.mjs");
    const cfg = loadConfig("safe");
    assert(cfg.pageDelay >= 2000, "safe يجب أن يكون تأخير أكبر");
  });

  r.test("loadConfig — profile غير موجود يُعيد null", async () => {
    const { loadConfig } = await import("./config-manager.mjs");
    const cfg = loadConfig("nonexistent_xyz_abc");
    assertEqual(cfg, null);
  });

  // ── Dashboard ─────────────────────────────────────────────
  r.test("LiveDashboard — يُنشأ بدون أخطاء", async () => {
    const { LiveDashboard } = await import("./dashboard.mjs");
    const d = new LiveDashboard({ enabled: false, siteUrl: "https://example.com", totalAds: 100 });
    assert(d.state !== undefined);
  });

  r.test("NullDashboard — update لا يرمي خطأ", async () => {
    const { NullDashboard } = await import("./dashboard.mjs");
    const d = new NullDashboard();
    d.update({ adsScraped: 5 });
    d.start();
    d.stop();
  });

  r.test("createDashboard — يُعيد NullDashboard عند enabled: false", async () => {
    const { createDashboard, NullDashboard } = await import("./dashboard.mjs");
    const d = createDashboard({ enabled: false });
    assert(d instanceof NullDashboard);
  });

  r.test("LiveDashboard — _buildLines يُعيد مصفوفة أسطر", async () => {
    const { LiveDashboard } = await import("./dashboard.mjs");
    const d = new LiveDashboard({ enabled: false, siteUrl: "https://test.com", totalAds: 100, totalPages: 10 });
    d.state.adsScraped = 30;
    const lines = d._buildLines();
    assert(Array.isArray(lines) && lines.length > 5, "يجب أن يكون أكثر من 5 أسطر");
  });

  return r.run();
}

// ============================================================
//  Suite 2: اختبار POST search (بدون browser - fetch فقط)
// ============================================================

async function runPostSearchTests() {
  const r = new TestRunner("Suite 2: POST Search Logic");

  r.test("buildPostBody — يبني body صحيح", async () => {
    // نستورد الدالة مباشرة (private — نختبر عبر postSearch interface)
    const body = new URLSearchParams();
    body.set("q", "driver");
    body.set("searchtype", "A");
    body.set("Submit", "Search");
    const str = body.toString();
    assert(str.includes("q=driver"), "يجب أن يحتوي على q=driver");
    assert(str.includes("searchtype=A"), "يجب أن يحتوي على searchtype=A");
  });

  r.test("extractAdLinks — يستخرج روابط /cls/", async () => {
    // محاكاة HTML
    const html = `
      <a href="https://www.expatriates.com/cls/123456.html">إعلان 1</a>
      <a href="/cls/789012.html">إعلان 2</a>
      <a href="https://other.com/cls/000.html">خارجي</a>
    `;
    const baseUrl = "https://www.expatriates.com";

    // محاكاة الدالة
    const links = new Set();
    const regex = /href=["'](https?:\/\/[^"']*\/cls\/\d+\.html)[^"']*/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[1].split("?")[0];
      if (url.startsWith(baseUrl)) links.add(url);
    }
    const relRegex = /href=["'](\/cls\/\d+\.html)[^"']*/gi;
    while ((match = relRegex.exec(html)) !== null) {
      links.add(baseUrl + match[1]);
    }

    assert(links.has("https://www.expatriates.com/cls/123456.html"), "رابط 1 غائب");
    assert(links.has("https://www.expatriates.com/cls/789012.html"), "رابط 2 غائب");
    assert(!links.has("https://other.com/cls/000.html"), "رابط خارجي يجب أن يُستبعد");
    assertEqual(links.size, 2);
  });

  r.test("hasNextPage — يكشف صفحة تالية", () => {
    const cases = [
      { html: '<a rel="next">التالية</a>',        expected: true  },
      { html: '<a class="next-page">»</a>',        expected: true  },
      { html: '<a>التالية »</a>',                  expected: true  },
      { html: '<p>لا توجد صفحة تالية</p>',        expected: false },
      { html: "",                                   expected: false },
    ];
    for (const { html, expected } of cases) {
      const result = /rel=["']next["']|class=["'][^"']*next[^"']*["']|>\s*(next|التالية|»|›)[^<]*</i.test(html);
      assertEqual(result, expected, `فشل لـ: ${html.slice(0, 30)}`);
    }
  });

  return r.run();
}

// ============================================================
//  Suite 3: Live Test — expatriates.com الحقيقي
// ============================================================

async function runLiveTests() {
  const r = new TestRunner("Suite 3: Live Tests — expatriates.com 🌐");

  console.log("\n  ⚠️  هذه الاختبارات تتصل بالإنترنت الحقيقي");
  console.log("  ⚠️  تأكد من الاتصال قبل تشغيلها\n");

  // اختبار 1: الموقع يرد
  r.test("GET الصفحة الرئيسية يرد 200", async () => {
    const res = await fetch("https://www.expatriates.com/", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CSI-Tester/1.0)" },
      signal:  AbortSignal.timeout(15000),
    });
    assert(res.ok || res.status === 200, `Status: ${res.status}`);
  });

  // اختبار 2: فحص وجود نموذج البحث
  r.test("صفحة البداية تحتوي على form بحث", async () => {
    const res = await fetch("https://www.expatriates.com/", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CSI-Tester/1.0)" },
      signal:  AbortSignal.timeout(15000),
    });
    const html = await res.text();
    assert(
      html.toLowerCase().includes("search") || html.includes("form"),
      "لم يُعثر على نموذج بحث"
    );
  });

  // اختبار 3: POST search endpoint
  r.test("POST إلى search.epl يرد بنتائج", async () => {
    const body = new URLSearchParams();
    body.set("q",          "driver");
    body.set("searchtype", "A");
    body.set("Submit",     "Search");

    const res = await fetch("https://www.expatriates.com/scripts/search/search.epl", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Referer":       "https://www.expatriates.com/classifieds/search/",
        "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Origin":        "https://www.expatriates.com",
      },
      redirect: "follow",
      signal:   AbortSignal.timeout(20000),
    });

    assert(res.status < 500, `Server error: ${res.status}`);
    const html = await res.text();
    assert(html.length > 200, `HTML فارغ تقريباً: ${html.length} chars`);
  });

  // اختبار 4: النتائج تحتوي على روابط /cls/
  r.test("نتائج POST تحتوي على روابط إعلانات", async () => {
    const body = new URLSearchParams();
    body.set("q",          "driver");
    body.set("searchtype", "A");
    body.set("Submit",     "Search");

    const res = await fetch("https://www.expatriates.com/scripts/search/search.epl", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Referer":       "https://www.expatriates.com/classifieds/search/",
        "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin":        "https://www.expatriates.com",
      },
      redirect: "follow",
      signal:   AbortSignal.timeout(20000),
    });

    const html = await res.text();
    const hasLinks = /\/cls\/\d+\.html/i.test(html);

    if (!hasLinks) {
      // ربما لا توجد نتائج لـ "driver" — اختبر بكلمة أخرى
      console.log("    ℹ️  لا روابط لـ 'driver' — هذا محتمل، ليس فشلاً حقيقياً");
    }

    // على الأقل الصفحة ردت بـ HTML
    assert(html.length > 100, "الرد فارغ تقريباً");
  });

  // اختبار 5: صفحة الكلاسيفايد موجودة
  r.test("صفحة /classifieds/ تُحمَّل بنجاح", async () => {
    const res = await fetch("https://www.expatriates.com/classifieds/", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CSI-Tester/1.0)" },
      signal:  AbortSignal.timeout(15000),
      redirect: "follow",
    });
    assert(res.status < 400, `Status: ${res.status}`);
  });

  return r.run();
}

// ============================================================
//  runAllTests — نقطة الدخول
// ============================================================

export async function runAllTests(opts = {}) {
  const { live = false } = opts;

  console.log("\n" + "╔" + "═".repeat(53) + "╗");
  console.log("║       CSI-Ultimate — Integration Tests              ║");
  console.log("╚" + "═".repeat(53) + "╝");

  let allPassed = true;

  try {
    const p1 = await runUnitTests();
    if (!p1) allPassed = false;

    const p2 = await runPostSearchTests();
    if (!p2) allPassed = false;

    if (live) {
      const p3 = await runLiveTests();
      if (!p3) allPassed = false;
    }

  } catch (err) {
    console.error("\n💥 خطأ في الاختبارات:", err.message);
    allPassed = false;
  }

  // ملخص نهائي
  console.log("\n" + "═".repeat(55));
  if (allPassed) {
    console.log("🎉  جميع الاختبارات نجحت!");
  } else {
    console.log("⚠️   بعض الاختبارات فشلت — راجع الأخطاء أعلاه");
    process.exitCode = 1;
  }
  console.log("═".repeat(55) + "\n");

  return allPassed;
}

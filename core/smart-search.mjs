/**
 * ============================================================
 *  CSI-Ultimate — Smart Search Engine
 *  Stage 4: يكتشف آلية البحث الحقيقية للموقع تلقائياً
 *  core/smart-search.mjs
 * ============================================================
 *
 *  المشكلة: expatriates.com لا يدعم /classifieds/search/?q=
 *  الحل:    نكتشف نموذج البحث الفعلي في الصفحة ونستخدمه
 *
 *  الاستراتيجيات (بالترتيب):
 *    1. اكتشاف <form> في الصفحة + إرسال النموذج
 *    2. تجربة URL patterns شائعة
 *    3. فلترة من الفئات (category-filter fallback)
 * ============================================================
 */

import { smartLoad } from "./crawler-core.mjs";

const delay = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
//  اكتشاف نموذج البحث
// ============================================================

/**
 * يكتشف نموذج البحث في الصفحة ويرجع معلوماته
 * @param {import("./browser-pool.mjs").BrowserPool} pool
 * @param {string} baseUrl
 * @returns {Promise<{action:string, method:string, inputName:string}|null>}
 */
export async function discoverSearchForm(pool, baseUrl) {
  return await pool.withPage(async (page) => {
    const loaded = await smartLoad(page, baseUrl + "/");
    if (!loaded) return null;

    return await page.evaluate(() => {
      // ابحث عن كل النماذج في الصفحة
      const forms = Array.from(document.querySelectorAll("form"));

      for (const form of forms) {
        const inputs = Array.from(form.querySelectorAll("input[type='text'], input[type='search'], input:not([type])"));
        if (!inputs.length) continue;

        // تحقق إذا فيه input يبدو مرتبط بالبحث
        const searchInput = inputs.find(inp =>
          /search|query|q|keyword|kw|find/i.test(inp.name + " " + inp.id + " " + inp.placeholder)
        ) || inputs[0];

        const action = form.action || window.location.href;
        const method = form.method?.toUpperCase() || "GET";

        return {
          action,
          method,
          inputName: searchInput.name || searchInput.id || "q",
          formId: form.id || "",
          allInputs: inputs.map(i => ({ name: i.name, id: i.id, placeholder: i.placeholder })),
        };
      }

      // إذا ما في form، ابحث عن input بحث مفرد
      const standaloneInput = document.querySelector(
        "input[type='search'], input[placeholder*='search' i], input[placeholder*='بحث']"
      );
      if (standaloneInput) {
        return {
          action: window.location.href,
          method: "GET",
          inputName: standaloneInput.name || "q",
          formId: "",
          allInputs: [{ name: standaloneInput.name, id: standaloneInput.id }],
        };
      }

      return null;
    });
  });
}

// ============================================================
//  URL patterns للبحث — نجرّبها بالترتيب
// ============================================================

const SEARCH_URL_PATTERNS = [
  // expatriates.com الأنماط الحقيقية
  (base, q) => `${base}/classifieds/search-jobs/?search=${encodeURIComponent(q)}`,
  (base, q) => `${base}/classifieds/search/?search=${encodeURIComponent(q)}`,
  (base, q) => `${base}/classifieds/search/?keywords=${encodeURIComponent(q)}`,
  (base, q) => `${base}/classifieds/search/?q=${encodeURIComponent(q)}`,
  (base, q) => `${base}/classifieds/?search=${encodeURIComponent(q)}`,
  (base, q) => `${base}/classifieds/?keywords=${encodeURIComponent(q)}`,
  (base, q) => `${base}/search/?q=${encodeURIComponent(q)}`,
  (base, q) => `${base}/search/?keywords=${encodeURIComponent(q)}`,
  // نمط مباشر في الفئات
  (base, q) => `${base}/classifieds/jobs/?search=${encodeURIComponent(q)}`,
  (base, q) => `${base}/classifieds/jobs/?q=${encodeURIComponent(q)}`,
];

/**
 * يجرّب URL patterns ويرجع أول واحد يعطي نتائج
 * @param {import("./browser-pool.mjs").BrowserPool} pool
 * @param {string} baseUrl
 * @param {string} query
 * @returns {Promise<{url:string, links:string[]}|null>}
 */
async function tryUrlPatterns(pool, baseUrl, query) {
  for (const pattern of SEARCH_URL_PATTERNS) {
    const searchUrl = pattern(baseUrl, query);

    const result = await pool.withPage(async (page) => {
      const loaded = await smartLoad(page, searchUrl);
      if (!loaded) return null;

      return await page.evaluate((base) => {
        const links = [...new Set(
          Array.from(document.querySelectorAll("a[href]"))
            .map(a => a.href)
            .filter(h => h.startsWith(base) && /\/cls\/\d+\.html/.test(h))
        )];

        // تحقق إذا الصفحة 404 أو "no results"
        const body = document.body?.innerText?.toLowerCase() || "";
        const isError = (
          body.includes("page not found") ||
          body.includes("404") ||
          body.includes("no results found") ||
          body.includes("لا توجد نتائج") ||
          document.title.toLowerCase().includes("404")
        );

        return { links, isError, title: document.title };
      }, base);
    }).catch(() => null);

    if (result && !result.isError && result.links.length > 0) {
      console.log(`  🔍 نمط البحث الناجح: ${searchUrl}`);
      return { url: searchUrl, links: result.links };
    }

    await delay(800);
  }
  return null;
}

// ============================================================
//  بحث عبر نموذج الصفحة الفعلي
// ============================================================

/**
 * يملأ نموذج البحث في الصفحة ويحصل على النتائج
 * @param {import("./browser-pool.mjs").BrowserPool} pool
 * @param {string} baseUrl
 * @param {string} query
 * @param {object} formInfo - من discoverSearchForm()
 * @returns {Promise<string[]>} - روابط الإعلانات
 */
async function searchViaForm(pool, baseUrl, query, formInfo) {
  return await pool.withPage(async (page) => {
    const loaded = await smartLoad(page, baseUrl + "/");
    if (!loaded) return [];

    // ملء نموذج البحث
    const links = await page.evaluate(async (query, formInfo, base) => {
      // ابحث عن الـ input
      const input = document.querySelector(
        `input[name="${formInfo.inputName}"], input#${formInfo.formId} input, input[type="search"]`
      );
      if (!input) return [];

      // ملء القيمة
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      // إرسال النموذج
      const form = input.closest("form");
      if (form) {
        form.submit();
        return ["SUBMITTED"];
      }

      // إذا ما في form، جرّب Enter
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      return ["ENTER_PRESSED"];
    }, query, formInfo, baseUrl);

    if (!links.length || links[0] === "SUBMITTED" || links[0] === "ENTER_PRESSED") {
      // انتظر تحميل الصفحة الجديدة
      await delay(3000);
      return await page.evaluate((base) => {
        return [...new Set(
          Array.from(document.querySelectorAll("a[href]"))
            .map(a => a.href)
            .filter(h => h.startsWith(base) && /\/cls\/\d+\.html/.test(h))
        )];
      }, baseUrl);
    }

    return links;
  }).catch(() => []);
}

// ============================================================
//  الفولباك: فلترة من الفئات بالكلمة المفتاحية
// ============================================================

/**
 * يبحث في روابط الفئات عن فئة تطابق الكلمة المفتاحية
 * @param {Array<{name:string, url:string}>} categories
 * @param {string} query
 * @returns {Array<{name:string, url:string}>}
 */
export function filterCategoriesByKeyword(categories, query) {
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/);

  return categories.filter(cat => {
    const name = cat.name.toLowerCase();
    const url  = cat.url.toLowerCase();
    return words.some(w => name.includes(w) || url.includes(w));
  });
}

// ============================================================
//  smartSearch — الدالة الرئيسية
// ============================================================

/**
 * بحث ذكي متعدد الاستراتيجيات
 * @param {import("./browser-pool.mjs").BrowserPool} pool
 * @param {string} baseUrl
 * @param {string} query
 * @param {object} config
 * @param {Array}  [categories] - للفولباك
 * @returns {Promise<{links:string[], strategy:string}>}
 */
export async function smartSearch(pool, baseUrl, query, config, categories = []) {
  console.log(`\n🔍 بحث ذكي عن: "${query}"`);
  console.log("─".repeat(50));

  // ── الاستراتيجية 1: اكتشاف نموذج الصفحة ──
  console.log("  [1/3] اكتشاف نموذج البحث...");
  const formInfo = await discoverSearchForm(pool, baseUrl);

  if (formInfo) {
    console.log(`  ✓ وجدنا نموذج: action="${formInfo.action}" input="${formInfo.inputName}"`);
    const formLinks = await searchViaForm(pool, baseUrl, query, formInfo);
    if (formLinks.length > 0) {
      console.log(`  ✅ استراتيجية النموذج نجحت: ${formLinks.length} نتيجة`);
      return { links: formLinks, strategy: "form" };
    }
  } else {
    console.log("  ⚠️  لا نموذج بحث في الصفحة");
  }

  // ── الاستراتيجية 2: URL patterns ──
  console.log("  [2/3] تجربة URL patterns...");
  const patternResult = await tryUrlPatterns(pool, baseUrl, query);
  if (patternResult) {
    console.log(`  ✅ URL pattern نجح: ${patternResult.links.length} نتيجة`);
    return { links: patternResult.links, strategy: "url_pattern" };
  }
  console.log("  ⚠️  كل URL patterns فشلت");

  // ── الاستراتيجية 3: فلترة الفئات ──
  console.log("  [3/3] فلترة الفئات بالكلمة المفتاحية...");
  if (categories.length > 0) {
    const matchingCats = filterCategoriesByKeyword(categories, query);
    if (matchingCats.length > 0) {
      console.log(`  ✓ وجدنا ${matchingCats.length} فئة مطابقة:`);
      matchingCats.forEach(c => console.log(`    • ${c.name} → ${c.url}`));
      return { links: [], strategy: "category_filter", categories: matchingCats };
    }
  }

  console.log("  ❌ لا نتائج بأي استراتيجية");
  return { links: [], strategy: "none" };
}

// ============================================================
//  searchMultipleKeywords — بحث بكلمات متعددة
// ============================================================

/**
 * @param {import("./browser-pool.mjs").BrowserPool} pool
 * @param {string} baseUrl
 * @param {string[]} queries
 * @param {object} config
 * @param {Array} [categories]
 * @returns {Promise<{query:string, links:string[], strategy:string}[]>}
 */
export async function searchMultipleKeywords(pool, baseUrl, queries, config, categories = []) {
  const results = [];

  for (const query of queries) {
    const result = await smartSearch(pool, baseUrl, query, config, categories);
    results.push({ query, ...result });
    await delay(config.PAGE_DELAY || 1500);
  }

  return results;
}

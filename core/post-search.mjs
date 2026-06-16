/**
 * ============================================================
 *  CSI-Ultimate — POST Search Engine
 *  Stage 5: Real Search Fix — بحث عبر POST مباشرة لـ search.epl
 *  core/post-search.mjs
 * ============================================================
 *
 *  لماذا؟
 *  -------
 *  Stage 4 اكتشف أن expatriates.com يستخدم:
 *    action="https://www.expatriates.com/scripts/search/search.epl"
 *    method="POST" (وليس GET)
 *  لذا كل URL patterns فشلت — هذا الملف يصلح المشكلة.
 *
 *  الاستراتيجيات (بالترتيب):
 *  --------------------------
 *  ① POST مباشر بـ fetch()           — أسرع + بدون browser
 *  ② POST عبر Puppeteer page          — إذا فشل fetch (حماية JS)
 *  ③ Intercept XHR/Fetch             — إذا الموقع يستخدم AJAX
 *  ④ Form automation                 — يملأ النموذج ويضغط Submit
 *
 *  الميزات:
 *  ---------
 *  ① postSearch       : يبحث بكلمة مفتاحية ويجمع الروابط
 *  ② postSearchMultiple: يبحث بعدة كلمات
 *  ③ يستخدم pageCache + dedupe
 *  ④ يتعامل مع pagination تلقائياً
 */

import { smartLoad, discoverLinksFromHtml, selectCandidateLinks, learnLinkPatterns } from "./crawler-core.mjs";
import { pageCache }  from "./cache.mjs";
import { dedupe }     from "./dedupe.mjs";

const delay = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
//  الثوابت
// ============================================================

const SEARCH_ENDPOINT = "https://www.expatriates.com/scripts/search/search.epl";
const SEARCH_PAGE_URL  = "https://www.expatriates.com/classifieds/search/";

// Selectors لاستخراج روابط الإعلانات
const AD_LINK_PATTERN = /\b(ad|listing|item|post|classified|detail|view)\b/i;

// ============================================================
//  extractAdLinks — استخراج روابط الإعلانات من HTML
// ============================================================

function extractAdLinks(html, baseUrl) {
  const discoveredLinks = discoverLinksFromHtml(html, baseUrl);
  return selectCandidateLinks(discoveredLinks, baseUrl);
}

// ============================================================
//  hasNextPage — هل يوجد صفحة تالية؟
// ============================================================

function hasNextPage(html) {
  return /rel=["']next["']|class=["'][^"']*next[^"']*["']|>\s*(next|»|›)\s*</i.test(html);
}

// ============================================================
//  buildPostBody — يبني body الـ POST request
// ============================================================

function buildPostBody(keyword, page = 1) {
  const params = new URLSearchParams();
  params.set("q",           keyword.trim());
  params.set("searchtype",  "A");  // All
  params.set("Submit",      "Search");
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

// ============================================================
//  Strategy 1: POST مباشر بـ Node fetch
// ============================================================

async function postViaFetch(keyword, page, baseUrl) {
  const body = buildPostBody(keyword, page);
  try {
    const res = await fetch(SEARCH_ENDPOINT, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Referer":       SEARCH_PAGE_URL,
        "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Origin":        "https://www.expatriates.com",
      },
      redirect: "follow",
    });

    if (!res.ok) return null;
    const html = await res.text();

    // تحقق أن الصفحة فيها نتائج فعلاً
    if (html.length < 500) return null;
    if (/no results? found|no ads? found|0 results/i.test(html)) {
      return { links: [], hasNext: false, strategy: "fetch-post" };
    }

    const links = extractAdLinks(html, baseUrl);
    return { links, hasNext: hasNextPage(html), strategy: "fetch-post" };
  } catch {
    return null;
  }
}

// ============================================================
//  Strategy 2: POST عبر Puppeteer (intercept + navigate)
// ============================================================

async function postViaPuppeteer(pool, keyword, page, baseUrl) {
  return await pool.withPage(async (puppeteerPage) => {
    let interceptedLinks = null;

    // Intercept responses
    puppeteerPage.on("response", async (response) => {
      try {
        const url = response.url();
        if (url.includes("search.epl") || url.includes("search")) {
          const ct = response.headers()["content-type"] || "";
          if (ct.includes("html")) {
            const html = await response.text().catch(() => "");
            const links = extractAdLinks(html, baseUrl);
            if (links.length > 0) interceptedLinks = links;
          }
        }
      } catch {}
    });

    // افتح صفحة البحث
    const loaded = await smartLoad(puppeteerPage, SEARCH_PAGE_URL);
    if (!loaded) return { links: [], hasNext: false, strategy: "puppeteer-fail" };

    // ابحث عن الـ form
    const formResult = await puppeteerPage.evaluate((kw) => {
      const form = document.querySelector("form[action*='search']") ||
                   document.querySelector("form");
      if (!form) return false;

      // ابحث عن input البحث
      const input = form.querySelector("input[name='q']") ||
                    form.querySelector("input[type='text']") ||
                    form.querySelector("input[type='search']");
      if (!input) return false;

      input.value = kw;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, keyword);

    if (!formResult) {
      return { links: [], hasNext: false, strategy: "puppeteer-noform" };
    }

    // اضغط Submit وانتظر Navigation
    await Promise.all([
      puppeteerPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}),
      puppeteerPage.evaluate(() => {
        const btn = document.querySelector("input[type='submit'], button[type='submit'], button");
        if (btn) btn.click();
        else {
          const form = document.querySelector("form");
          if (form) form.submit();
        }
      }),
    ]);

    // استخرج النتائج من الصفحة الحالية
    const result = await puppeteerPage.evaluate((base) => {
      const noResults = /no results? found|no ads? found|0 results/i.test(document.body?.innerText || "");
      const nextEl = document.querySelector("a[rel='next']") ||
        [...document.querySelectorAll("a")].find(a => /next|»|›/i.test(a.textContent));
      return {
        links: [],
        hasNext: !!nextEl && !noResults,
        url: location.href,
      };
    }, baseUrl);

    const html = await (typeof puppeteerPage.content === "function"
      ? puppeteerPage.content()
      : puppeteerPage.evaluate(() => document.documentElement?.outerHTML || ""))
      .then(result => {
        if (typeof result === "string") return result;
        if (result && typeof result === "object") {
          if (typeof result.outerHTML === "string") return result.outerHTML;
          if (typeof result.html === "string") return result.html;
        }
        return "";
      })
      .catch(() => "");
    const discoveredLinks = discoverLinksFromHtml(html, baseUrl);
    const links = selectCandidateLinks(discoveredLinks, baseUrl);
    result.links = links;
    // إذا intercepted أكثر، استخدمه
    if (interceptedLinks && interceptedLinks.length > result.links.length) {
      return { links: interceptedLinks, hasNext: result.hasNext, strategy: "puppeteer-intercept" };
    }

    return { ...result, strategy: "puppeteer-form" };
  });
}

// ============================================================
//  Strategy 3: URL Redirect — بعض المواقع تحوّل POST → GET
// ============================================================

async function postViaRedirectProbe(pool, keyword, baseUrl) {
  // expatriates.com بعد POST قد يعيد توجيه إلى URL قابل للقراءة
  return await pool.withPage(async (puppeteerPage) => {
    const redirectUrls = [];

    puppeteerPage.on("response", (res) => {
      const status = res.status();
      if (status >= 300 && status < 400) {
        const loc = res.headers()["location"];
        if (loc) redirectUrls.push(loc);
      }
    });

    // جرّب إرسال POST
    await smartLoad(puppeteerPage, SEARCH_PAGE_URL).catch(() => {});

    const currentUrl = puppeteerPage.url();
    if (currentUrl !== SEARCH_PAGE_URL && AD_LINK_PATTERN.test(currentUrl) === false) {
      // قد نكون حصلنا على redirect URL
      if (redirectUrls.length > 0) {
        return redirectUrls[redirectUrls.length - 1];
      }
    }
    return null;
  });
}

// ============================================================
//  postSearch — الدالة الرئيسية
// ============================================================

/**
 * يبحث بكلمة مفتاحية باستخدام POST وتجمع الروابط
 *
 * @param {object} pool
 * @param {string} baseUrl
 * @param {string} keyword
 * @param {object} config  - { MAX_PAGES, MAX_ADS, PAGE_DELAY }
 * @returns {Promise<{ links: string[], strategy: string }>}
 */
export async function postSearch(pool, baseUrl, keyword, config) {
  console.log(`\n🔍 POST بحث: "${keyword}"`);

  const maxPages = config.MAX_PAGES ?? 5;
  const maxAds   = config.MAX_ADS   ?? 200;
  const pageDly  = config.PAGE_DELAY ?? 1500;

  const allLinks  = new Set();
  let   usedStrat = "none";
  let   pageNum   = 1;

  while (pageNum <= maxPages && allLinks.size < maxAds) {
    const cacheKey = `post-search:${baseUrl}:${keyword}:p${pageNum}`;
    const cached   = pageCache.get(cacheKey);

    let result;

    if (cached) {
      result = cached;
      console.log(`  صفحة ${pageNum}: 📦 cache (${result.links.length} نتيجة) [${result.strategy}]`);
    } else {
      // جرّب Strategy 1: fetch POST
      result = await postViaFetch(keyword, pageNum, baseUrl);

      // Strategy 2: Puppeteer إذا فشل fetch (فقط للصفحة الأولى)
      if (!result && pageNum === 1) {
        console.log(`  📡 fetch POST فشل — جرّب Puppeteer...`);
        result = await postViaPuppeteer(pool, keyword, pageNum, baseUrl);
      }

      if (!result) {
        result = { links: [], hasNext: false, strategy: "failed" };
      }

      pageCache.set(cacheKey, result);
    }

    usedStrat = result.strategy;

    // فلتر المكررات
    const before = allLinks.size;
    result.links
      .filter(l => !dedupe.seenUrl(l))
      .forEach(l => allLinks.add(l));
    const added = allLinks.size - before;

    console.log(`  صفحة ${pageNum}: +${added} جديد (${result.links.length - added} مكرر) | إجمالي: ${allLinks.size} [${usedStrat}]`);

    if (!result.hasNext || added === 0 || result.links.length === 0) break;
    pageNum++;
    await delay(pageDly);
  }

  const finalLinks = [...allLinks].slice(0, maxAds);
  console.log(`  ✅ "${keyword}": ${finalLinks.length} إعلان | استراتيجية: ${usedStrat}\n`);

  return { links: finalLinks, strategy: usedStrat };
}

// ============================================================
//  postSearchMultiple — بحث بعدة كلمات مفتاحية
// ============================================================

/**
 * @param {object}   pool
 * @param {string}   baseUrl
 * @param {string[]} keywords
 * @param {object}   config
 * @param {object}   [opts]
 * @param {number}   [opts.delayBetween]
 * @returns {Promise<Map<string, string[]>>}
 */
export async function postSearchMultiple(pool, baseUrl, keywords, config, opts = {}) {
  const delayBetween = opts.delayBetween ?? 2500;
  const results      = new Map();
  const allFound     = new Set();

  console.log(`\n🔍 POST بحث متعدد: ${keywords.length} كلمة مفتاحية`);
  console.log(`   الموقع: ${baseUrl}`);
  console.log(`   Endpoint: ${SEARCH_ENDPOINT}\n`);

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const { links } = await postSearch(pool, baseUrl, kw, config);

    const unique = links.filter(l => !allFound.has(l));
    unique.forEach(l => allFound.add(l));
    results.set(kw, unique);

    if (i < keywords.length - 1) await delay(delayBetween);
  }

  const total = [...results.values()].reduce((s, v) => s + v.length, 0);
  console.log(`\n📊 POST بحث متعدد: ${total} إعلان فريد من ${keywords.length} كلمة`);

  return results;
}

// ============================================================
//  probeSearchMechanism — يحدد آلية البحث الحقيقية
// ============================================================

/**
 * يختبر الموقع ويحدد أفضل استراتيجية بحث
 * مفيد للـ diagnostics والـ smart-search
 *
 * @param {object} pool
 * @param {string} baseUrl
 * @returns {Promise<{ method: string, endpoint: string, paramName: string }>}
 */
export async function probeSearchMechanism(pool, baseUrl) {
  console.log("\n🔬 فحص آلية البحث...");

  return await pool.withPage(async (page) => {
    await smartLoad(page, baseUrl + "/");

    const info = await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll("form"));
      const searchForms = forms.filter(f =>
        f.action?.includes("search") ||
        f.querySelector("input[name='q'], input[type='search']")
      );

      if (searchForms.length === 0) return null;

      const form  = searchForms[0];
      const input = form.querySelector("input[name='q']") ||
                    form.querySelector("input[type='search']") ||
                    form.querySelector("input[type='text']");

      return {
        method:    (form.method || "get").toUpperCase(),
        endpoint:  form.action || "",
        paramName: input?.name || "q",
        formId:    form.id || "",
      };
    });

    if (info) {
      console.log(`  ✅ آلية البحث: ${info.method} → ${info.endpoint}`);
      console.log(`  📝 اسم الـ param: ${info.paramName}`);
    } else {
      console.log("  ⚠️  لم يُعثر على نموذج بحث");
    }

    return info || { method: "POST", endpoint: SEARCH_ENDPOINT, paramName: "q" };
  });
}

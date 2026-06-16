/**
 * ============================================================
 *  CSI-Ultimate — Keyword Search Engine
 *  Stage 3: Discovery Engine — بحث بالكلمات المفتاحية
 *  core/keyword-search.mjs
 * ============================================================
 *
 *  لماذا؟
 *  -------
 *  بدلاً من تصفح فئة بأكملها، يبحث مباشرة بكلمة مفتاحية
 *  ويجمع فقط الإعلانات المتعلقة.
 *
 *  الميزات:
 *  ---------
 *  ① searchByKeyword  : يبني URL البحث ويجمع النتائج
 *  ② searchMultiple   : يبحث بعدة كلمات متوالياً
 *  ③ يستخدم pageCache لتجنب إعادة البحث
 */

import { smartLoad, selectCandidateLinks, learnLinkPatterns } from "./crawler-core.mjs";
import { pageCache }   from "./cache.mjs";
import { dedupe }      from "./dedupe.mjs";
import { getSearchUrl } from "./site-adapter.mjs";

const delay = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
//  buildSearchUrl — يبني URL البحث (يستخدم site config)
// ============================================================

/**
 * @param {string} baseUrl
 * @param {string} keyword
 * @param {number} [page]
 */
function buildSearchUrl(baseUrl, keyword, page = 1) {
  return getSearchUrl(baseUrl, keyword, page);
}

// ============================================================
//  searchByKeyword — البحث بكلمة واحدة وجمع الروابط
// ============================================================

/**
 * @param {object} pool
 * @param {string} baseUrl
 * @param {string} keyword
 * @param {object} config  - { MAX_PAGES, MAX_ADS, PAGE_DELAY }
 * @returns {Promise<string[]>} - روابط الإعلانات
 */
export async function searchByKeyword(pool, baseUrl, keyword, config) {
  console.log(`\n🔍 بحث: "${keyword}"`);
  const allLinks = new Set();
  let   pageNum  = 1;

  while (pageNum <= (config.MAX_PAGES ?? 5) && allLinks.size < (config.MAX_ADS ?? 100)) {
    const url      = buildSearchUrl(baseUrl, keyword, pageNum);
    const cacheKey = `search:${url}`;
    const cached   = pageCache.get(cacheKey);

    let links, hasNext;

    if (cached) {
      ({ links, hasNext } = cached);
      console.log(`  صفحة ${pageNum}: 📦 cache (${links.length} نتيجة)`);
    } else {
      ({ links, hasNext } = await pool.withPage(async (page) => {
        const loaded = await smartLoad(page, url);
        if (!loaded) return { links: [], hasNext: false };

        const result = await page.evaluate(base => {
          const noResults = document.body?.innerText?.toLowerCase().includes("no result") ||
                            document.body?.innerText?.toLowerCase().includes("no ads found") ||
                            document.body?.innerText?.toLowerCase().includes("0 results");
          const nextEl = document.querySelector("a[rel='next'], .next a, a.next, [class*='next'] a") ||
            [...document.querySelectorAll("a")].find(a => /^\s*(next|»|>)\s*$/i.test(a.textContent));
          const hasNext = !!nextEl && !noResults;
          const rawLinks = Array.from(document.querySelectorAll("a[href]"))
            .map(a => ({ href: a.href, text: (a.innerText || "").trim().slice(0, 200) }))
            .filter(l => l.href.startsWith(base));
          return { links: rawLinks, hasNext };
        }, baseUrl).catch(() => ({ links: [], hasNext: false }));

        const links = selectCandidateLinks(result.links, baseUrl);
        const patternHints = learnLinkPatterns(links);
        return { links, hasNext: result.hasNext || links.length > 0, patternHints };
      }));

      pageCache.set(cacheKey, { links, hasNext });
    }

    // فلتر المكررات
    const before = allLinks.size;
    links.filter(l => !dedupe.seenUrl(l)).forEach(l => allLinks.add(l));
    const added = allLinks.size - before;

    console.log(`  صفحة ${pageNum}: +${added} جديد (${links.length - added} مكرر) | إجمالي: ${allLinks.size}`);

    if (!hasNext || added === 0) break;
    pageNum++;
    await delay(config.PAGE_DELAY ?? 1000);
  }

  const result = [...allLinks].slice(0, config.MAX_ADS ?? 100);
  console.log(`  ✅ "${keyword}": ${result.length} إعلان جديد\n`);
  return result;
}

// ============================================================
//  searchMultiple — بحث بعدة كلمات مفتاحية
// ============================================================

/**
 * @param {object}   pool
 * @param {string}   baseUrl
 * @param {string[]} keywords
 * @param {object}   config
 * @param {object}   [opts]
 * @param {number}   [opts.delayBetween] - تأخير بين الكلمات (ms)
 * @returns {Promise<Map<string, string[]>>} - keyword → links[]
 */
export async function searchMultiple(pool, baseUrl, keywords, config, opts = {}) {
  const delayBetween = opts.delayBetween ?? 2000;
  const results      = new Map();
  const allFound     = new Set();

  console.log(`\n🔍 بحث متعدد: ${keywords.length} كلمة مفتاحية`);

  for (let i = 0; i < keywords.length; i++) {
    const kw    = keywords[i];
    const links = await searchByKeyword(pool, baseUrl, kw, config);

    // إزالة التكرار عبر الكلمات المفتاحية
    const unique = links.filter(l => !allFound.has(l));
    unique.forEach(l => allFound.add(l));
    results.set(kw, unique);

    if (i < keywords.length - 1) await delay(delayBetween);
  }

  const total = [...results.values()].reduce((s, v) => s + v.length, 0);
  console.log(`\n📊 البحث المتعدد: ${total} إعلان فريد من ${keywords.length} كلمة`);

  return results;
}

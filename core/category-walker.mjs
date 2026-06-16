/**
 * ============================================================
 *  CSI-Ultimate — Category Walker
 *  Stage 3: Discovery Engine — استكشاف كل فئات الموقع تلقائياً
 *  core/category-walker.mjs
 * ============================================================
 *
 *  لماذا؟
 *  -------
 *  v5 يطلب من المستخدم اختيار فئة واحدة يدوياً.
 *  Stage 3 يمشي عبر كل الفئات تلقائياً — أو مجموعة مختارة.
 *
 *  الميزات:
 *  ---------
 *  ① buildCategoryTree : يبني شجرة كاملة للفئات (parent → children)
 *  ② walkCategories    : يمشي عبر قائمة فئات ويجمع الروابط من كل واحدة
 *  ③ filterCategories  : يفلتر بكلمات مفتاحية أو regex
 *  ④ CategorySession   : يتذكر أي فئات اكتملت (resume بين الجلسات)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname }                                    from "path";
import { smartLoad }                    from "./crawler-core.mjs";
import { pageCache }                                           from "./cache.mjs";

const delay = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
//  buildCategoryTree — يبني قائمة كاملة بالفئات والفئات الفرعية
// ============================================================

/**
 * يزور الصفحة الرئيسية ويستخرج كل روابط الفئات مع تصنيفها
 *
 * @param {object} pool  - BrowserPool
 * @param {string} baseUrl
 * @returns {Promise<CategoryNode[]>}
 *
 * @typedef {{ name: string, url: string, parent?: string, depth: number }} CategoryNode
 */
export async function buildCategoryTree(pool, baseUrl) {
  console.log("\n🗂️  بناء شجرة الفئات...");

  // ── pageCache ──
  const cacheKey = `cattree:${baseUrl}`;
  const cached   = pageCache.get(cacheKey);
  if (cached) {
    console.log(`  📦 cache: ${cached.length} فئة`);
    return cached;
  }

  const categories = await pool.withPage(async (page) => {
    await smartLoad(page, baseUrl + "/");

    return await page.evaluate(base => {
      const seen = new Set();
      const out  = [];
      const candidateAnchors = [...document.querySelectorAll("a[href]")];
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const navCount = [...document.querySelectorAll("nav a, header a, .nav a, .menu a, [class*='nav'] a, [class*='menu'] a")].length;

      const push = (el, depth = 0, parent = "") => {
        const href = el?.href?.split("?")[0]?.split("#")[0];
        const text = el?.innerText?.trim().replace(/\s+/g, " ");
        if (!href || !text || seen.has(href)) return;
        if (!href.startsWith(base)) return;
        if (href === base || href === base + "/") return;
        if (text.length < 2 || text.length > 80) return;
        const linkDensity = candidateAnchors.length ? candidateAnchors.filter(a => a?.innerText?.trim()).length / candidateAnchors.length : 0;
        const inSidebar = !!el.closest("aside, .sidebar, [class*='side'], [class*='menu']") || /sidebar|aside/i.test(el?.className || "");
        const sectionText = (el.closest("section, nav, header, aside, .sidebar")?.innerText || "").replace(/\s+/g, " ").trim();
        const type = window.__CSI_CLASSIFY_LINK__ ? window.__CSI_CLASSIFY_LINK__(href, text, { linkDensity, inSidebar, sectionText, bodyText, navCount }) : null;
        if (type === "navigation") return;
        if (type && type !== "category") return;
        seen.add(href);
        out.push({ name: text, url: href, parent, depth });
      };

      const linkClassifier = (href, text, context) => {
        const path = href.toLowerCase();
        const label = (window.__CSI_CLASSIFY_LINK__ || (() => "unknown"))(href, text, context);
        return label;
      };

      window.__CSI_CLASSIFY_LINK__ = (href, text, context) => {
        const path = new URL(href, base).pathname.toLowerCase();
        const value = text.toLowerCase();
        const hasCategoryWords = /category|categories|browse|directory|listings?|classifieds?|jobs|cars|property|rent|buy|sell|for-sale|forrent|forsale|real-estate|services?/i.test(path + " " + value);
        const hasNavigationWords = /login|register|sign.?in|sign.?up|account|profile|password|help|faq|contact|about|privacy|terms|cookie|sitemap|logout|home|menu|nav|service|services/i.test(path + " " + value);
        const isRootLike = path === "/" || path === "";
        const hasMeaningfulText = value.length >= 2 && !/^(home|about|contact|login|sign in|register|help|faq|privacy|terms|account|profile|logout|search|menu|nav)$/i.test(value);
        if (isRootLike && !hasMeaningfulText) return "navigation";
        if (hasNavigationWords && (!hasCategoryWords || context.linkDensity > 0.5)) return "navigation";
        if (hasCategoryWords && (hasMeaningfulText || context.inSidebar || context.sectionText || context.linkDensity <= 0.35)) return "category";
        if (hasMeaningfulText && (context.inSidebar || context.sectionText || context.linkDensity <= 0.25)) return "category";
        return "unknown";
      };

      candidateAnchors.forEach(a => push(a, 1));
      return out;
    }, baseUrl);
  });

  const filtered = categories.filter((c, i, arr) =>
    arr.findIndex(x => x.url === c.url) === i
  );

  // خزّن في pageCache (TTL ساعتان)
  pageCache.set(cacheKey, filtered);

  console.log(`  ✅ ${filtered.length} فئة مكتشفة`);
  return filtered;
}

// ============================================================
//  filterCategories — فلتر بكلمة مفتاحية أو regex أو قائمة
// ============================================================

/**
 * @param {CategoryNode[]} categories
 * @param {object} opts
 * @param {string|RegExp} [opts.match]     - نص أو regex للاسم أو URL
 * @param {string[]}       [opts.only]     - أسماء أو URLs محددة
 * @param {string[]}       [opts.exclude]  - استبعاد
 * @param {number}         [opts.maxDepth] - أعمق مستوى
 * @returns {CategoryNode[]}
 */
export function filterCategories(categories, opts = {}) {
  let result = [...categories];

  if (opts.match) {
    const rx = typeof opts.match === "string"
      ? new RegExp(opts.match, "i")
      : opts.match;
    result = result.filter(c => rx.test(c.name) || rx.test(c.url));
  }

  if (opts.only?.length) {
    result = result.filter(c =>
      opts.only.some(k => c.name.includes(k) || c.url.includes(k))
    );
  }

  if (opts.exclude?.length) {
    result = result.filter(c =>
      !opts.exclude.some(k => c.name.includes(k) || c.url.includes(k))
    );
  }

  if (opts.maxDepth != null) {
    result = result.filter(c => c.depth <= opts.maxDepth);
  }

  return result;
}

// ============================================================
//  CategorySession — يتذكر أي فئات أُكملت (resume)
// ============================================================

export class CategorySession {
  constructor(path = "./state/category-session.json") {
    this._path = resolve(path);
    this._done = new Set();
    this._load();
  }

  isDone(catUrl) { return this._done.has(catUrl); }

  markDone(catUrl) {
    this._done.add(catUrl);
    this._save();
  }

  reset() {
    this._done.clear();
    this._save();
  }

  remaining(categories) {
    return categories.filter(c => !this._done.has(c.url));
  }

  stats() {
    return { done: this._done.size };
  }

  _load() {
    if (!existsSync(this._path)) return;
    try {
      const data = JSON.parse(readFileSync(this._path, "utf8"));
      for (const u of (data.done || [])) this._done.add(u);
      if (this._done.size > 0)
        console.log(`[CategorySession] 📂 ${this._done.size} فئة مكتملة من جلسة سابقة`);
    } catch {}
  }

  _save() {
    try {
      mkdirSync(dirname(this._path), { recursive: true });
      writeFileSync(this._path, JSON.stringify({ done: [...this._done] }), "utf8");
    } catch {}
  }
}

// ── مثيل عالمي ───────────────────────────────────────────────
export const categorySession = new CategorySession();

// ============================================================
//  walkCategories — المحرك الرئيسي
// ============================================================

/**
 * يمشي عبر قائمة فئات ويستدعي callback لكل فئة
 *
 * @param {object} pool
 * @param {CategoryNode[]} categories
 * @param {object} config
 * @param {Function} onCategory - async (cat, links) => void
 * @param {object} [opts]
 * @param {boolean} [opts.resume]       - تخطى الفئات المكتملة (default: true)
 * @param {number}  [opts.delayBetween] - تأخير بين الفئات ms (default: 2000)
 */
export async function walkCategories(pool, categories, config, onCategory, opts = {}) {
  const resume       = opts.resume       ?? true;
  const delayBetween = opts.delayBetween ?? 2000;

  const toProcess = resume
    ? categorySession.remaining(categories)
    : categories;

  if (toProcess.length === 0) {
    console.log("\n✅ كل الفئات مكتملة من جلسات سابقة.");
    return;
  }

  console.log(`\n🚶 المشي عبر ${toProcess.length} فئة (من ${categories.length} إجمالي)...`);
  if (resume && categorySession.stats().done > 0) {
    console.log(`  ↩️  تخطى ${categorySession.stats().done} فئة مكتملة (resume)\n`);
  }

  for (let i = 0; i < toProcess.length; i++) {
    const cat = toProcess[i];
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  📂 [${i + 1}/${toProcess.length}] ${cat.name}`);
    console.log(`  🔗 ${cat.url}`);
    console.log("═".repeat(60));

    try {
      await onCategory(cat);
      categorySession.markDone(cat.url);
    } catch (err) {
      console.error(`  ❌ فشلت الفئة "${cat.name}": ${err.message}`);
      // نكمل مع الفئة التالية
    }

    if (i < toProcess.length - 1) {
      await delay(delayBetween);
    }
  }

  console.log(`\n✅ اكتمل المشي عبر ${toProcess.length} فئة`);
}

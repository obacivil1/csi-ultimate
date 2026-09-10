import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium } from 'playwright';
import { generateKeywords, detectFamily, JOB_FAMILIES } from './keywordGenerator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'output');
const LEARNING_FILE = path.join(ROOT, 'output', '.learning.json');
for (const d of [OUTPUT]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── Self-Learning State ──
let learningData = { sites: {}, strategies: {} };
try {
  if (fs.existsSync(LEARNING_FILE)) {
    learningData = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf-8'));
  }
} catch (e) { /* start fresh */ }

function saveLearning() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2), 'utf-8');
  } catch (e) { /* ignore */ }
}

function recordSiteSuccess(site, strategy) {
  if (!learningData.sites[site]) learningData.sites[site] = { success: 0, fail: 0, strategies: {} };
  learningData.sites[site].success++;
  if (strategy) {
    if (!learningData.sites[site].strategies[strategy]) learningData.sites[site].strategies[strategy] = 0;
    learningData.sites[site].strategies[strategy]++;
  }
  saveLearning();
}

function recordSiteFailure(site, strategy) {
  if (!learningData.sites[site]) learningData.sites[site] = { success: 0, fail: 0, strategies: {} };
  learningData.sites[site].fail++;
  saveLearning();
}

function getBestStrategy(site) {
  const s = learningData.sites[site];
  if (!s || !s.strategies || Object.keys(s.strategies).length === 0) return null;
  return Object.entries(s.strategies).sort((a, b) => b[1] - a[1])[0][0];
}

// ── User Agents ──
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Express Setup ──
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let browser = null;
let sseClients = [];
let abortController = null;

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) c.res.write(msg);
}
function logInfo(m) { console.log(`[INFO] ${m}`); broadcast('progress', { text: `[INFO] ${m}\n`, type: 'stdout' }); }
function logSuccess(m) { console.log(`[SUCCESS] ${m}`); broadcast('progress', { text: `[SUCCESS] ${m}\n`, type: 'stdout' }); }
function logWarn(m) { console.log(`[WARN] ${m}`); broadcast('progress', { text: `[WARN] ${m}\n`, type: 'stdout' }); }
function logError(m) { console.log(`[ERROR] ${m}`); broadcast('progress', { text: `[ERROR] ${m}\n`, type: 'stderr' }); }

// ── SSE ──
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  const c = { id: Date.now(), res };
  sseClients.push(c);
  res.write(`event: connected\ndata: {"ok":true}\n\n`);
  req.on('close', () => { sseClients = sseClients.filter(x => x.id !== c.id); });
});

// ── Retry with backoff ──
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 2000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, i) + Math.random() * 1000;
      logWarn(`♻️ محاولة ${i + 1} فشلت — إعادة بعد ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ── Contact noise killers ──
// Emails / phone numbers / social handles pollute result titles & descriptions,
// especially on job-paper blogs (gulfjobpaper etc). We strip them everywhere.
const CONTACT_RE_SRC = '[\\w.+-]+@[\\w-]+\\.[A-Za-z]{2,}|(?:https?:\\/\\/)?(?:www\\.)?(?:wa\\.me|t\\.me|instagram\\.com|facebook\\.com|linkedin\\.com|youtube\\.com|twitter\\.com|x\\.com)\\/[A-Za-z0-9._\\/-]+';
const PHONE_RE_SRC = '(?:\\+?\\d{1,3}[\\s.-]?)?(?:\\(\\d{2,4}\\)[\\s.-]?)?(?:\\d{4,5}[\\s.-]?\\d{3,4}[\\s.-]?\\d{2,5}|\\+\\d{1,3}[\\s.-]\\d{3,4}[\\s.-]?\\d{4,}|\\+\\d{6,15})\\b';
const CONTACT_RE = new RegExp(CONTACT_RE_SRC, 'gi');
const PHONE_RE = new RegExp(PHONE_RE_SRC, 'gi');
const EMAIL_ONLY_RE = /^[\w.+-]+@[\w-]+\.[A-Za-z]{2,}$/;

function sanitizeClean(s) {
  if (!s) return '';
  return String(s)
    .replace(CONTACT_RE, ' ')
    .replace(PHONE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function isEmailOnly(s) {
  return EMAIL_ONLY_RE.test(String(s || '').trim());
}

// Final per-item cleanup right before saving: drop cookie-cutter category snippets
// ("Qatar Jobs", header crumbs), tiny/empty descriptions, and non-date strings.
const MONTH_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2}\b/i;
function cleanItemForSave(it) {
  const title = sanitizeClean(it.title) || it.title;
  let description = sanitizeClean(it.description || '');
  description = description.replace(/^[A-Za-z][A-Za-z' -]{0,30}\s+Jobs$/, '').trim();
  if (description.length < 12) description = '';
  const date = (String(it.date || '').match(MONTH_RE) || [])[0] || '';
  return {
    ...it,
    title,
    location: sanitizeClean(it.location),
    price: sanitizeClean(it.price) || '',
    salary: sanitizeClean(it.salary) || '',
    description,
    date,
  };
}

// ── Core Navigation ──
async function navigate(page, url, timeout = 30000) {
  await retryWithBackoff(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    // Wait for JS rendering to complete
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch (e) { /* ok, use domcontentloaded */ }
    // Extra wait for dynamic content
    await page.waitForTimeout(2000);
  }, 2, 3000);
}

async function isBlocked(page) {
  try {
    const title = await page.title();
    const lower = title.toLowerCase();
    if (lower.includes('just a moment') || lower.includes('please wait') || lower.includes('checking your browser')) {
      logWarn(`⚠️ Cloudflare/保护 detected: "${title}" — waiting 8s...`);
      await page.waitForTimeout(8000);
      const newTitle = (await page.title()).toLowerCase();
      if (newTitle.includes('just a moment') || newTitle.includes('please wait')) {
        return true;
      }
    }
    return false;
  } catch (e) { return true; }
}

// ── Search Strategies ──
async function trySearchForm(page, url, search) {
  const encoded = encodeURIComponent(search);
  const formInfo = await page.evaluate(() => {
    const form = document.querySelector('form[action*="search"], form:has(input[name="q"]), form:has(input[name="search"]), form:has(input[type="search"])');
    if (!form) return null;
    const q = form.querySelector('input[name="q"], input[name="search"], input[name="query"], input[type="search"]');
    return q ? { action: form.getAttribute('action'), qName: q.getAttribute('name') || 'q' } : null;
  }).catch(() => null);

  if (formInfo && formInfo.qName) {
    const searchUrl = new URL(formInfo.action, url).href;
    const sep = searchUrl.includes('?') ? '&' : '?';
    const fullUrl = `${searchUrl}${sep}${encodeURIComponent(formInfo.qName)}=${encoded}`;
    try {
      await navigate(page, fullUrl, 15000);
      if (!(await isBlocked(page))) {
        logSuccess(`✅ بحث عبر رابط النموذج: ${fullUrl}`);
        return { url: fullUrl, strategy: 'form' };
      }
    } catch (e) { /* fall through */ }
  }
  return null;
}

async function trySearchURLPatterns(page, url, search) {
  const encoded = encodeURIComponent(search);
  const slug = String(search).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const paths = [
    `/search?q=${encoded}`, `/?s=${encoded}`, `/?query=${encoded}`, `/search?query=${encoded}`,
    `/jobsearch?q=${encoded}`, `/jobs/?q=${encoded}`, `/jobs/search?q=${encoded}`,
    `/jobs?q=${encoded}`, `/vacancies?q=${encoded}`, `/jobs/search/${encoded}`,
    `/classifieds/?q=${encoded}`, `/classifieds/search?q=${encoded}`,
    `/en/jobs/${slug}-jobs/`, `/${slug}-jobs/`, `/jobs/${slug}`, `/jobs/search/${slug}`,
    `/search/${encoded}`, `/find?q=${encoded}`,
    `/ads/?q=${encoded}`, `/listings/?q=${encoded}`,
    `/scripts/search/search.epl?q=${encoded}`,
    `/search.php?q=${encoded}`, `/search/index?q=${encoded}`,
  ];
  for (const p of paths) {
    try {
      const fullUrl = new URL(p, url).href;
      await navigate(page, fullUrl, 10000);
      if (!(await isBlocked(page))) {
        logSuccess(`✅ بحث عبر: ${fullUrl}`);
        return { url: fullUrl, strategy: 'url_pattern' };
      }
    } catch (e) { /* try next */ }
  }
  return null;
}

async function trySearchInput(page, search) {
  const selectors = [
    'input[type="search"]', 'input[name="q"]', 'input[name="search"]',
    'input[name="query"]', 'input[placeholder*="search" i]',
    'input[placeholder*="job" i]', 'input[placeholder*="find" i]',
    'input.header-search', 'input.search-input',
  ];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (!el) continue;
    try {
      await el.click();
      await el.fill(search);
      await page.waitForTimeout(500);
      const form = await page.evaluate(() => {
        const inp = document.activeElement;
        if (!inp) return null;
        const f = inp.closest('form');
        if (f) return f.getAttribute('action') || '';
        return null;
      }).catch(() => null);

      if (form !== null) {
        await page.evaluate(() => {
          const inp = document.activeElement;
          if (inp) {
            const f = inp.closest('form');
            if (f) f.submit();
          }
        });
      } else {
        await page.keyboard.press('Enter');
      }

      await page.waitForTimeout(3000);
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (e) { /* ignore */ }
      logSuccess(`✅ بحث عبر مربع البحث: ${sel}`);
      return { url: null, strategy: 'input' };
    } catch (e) { /* try next */ }
  }
  return null;
}

// ── Link Extraction ──
const JUNK_TITLES = new Set([
  'read more', 'read', 'more', 'details', 'view', 'view details', 'apply now', 'apply',
  'login', 'register', 'sign in', 'sign up', 'next', 'next page', 'previous', 'load more',
  'see more', 'view all', 'search', 'find jobs', 'all jobs', 'show more', 'browse jobs',
  'التالي', 'المزيد', 'عرض التفاصيل', 'تقدم الآن', 'تسجيل', 'دخول', 'بحث', 'وظائف',
  'جميع الوظائف', 'عرض المزيد', 'تصفح الوظائف', 'لا توجد نتائج', 'البحث', 'نتائج البحث',
  'الصفحة الرئيسية', 'الرئيسية', 'اكثر', 'المقبل', 'التالي', 'السابق', 'أكثر',
]);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'in', 'for', 'of', 'on', 'at', 'and', 'or', 'to', 'with', 'by',
  'as', 'is', 'are', 'be', 'it', 'this', 'that', 'you', 'your', 'our', 'per', 'each',
  'all', 'any', 'new', 'required', 'experience', 'job', 'jobs', 'vacancy', 'career',
  'working', 'work', 'part', 'full', 'time', 'و', 'في', 'خبرة', 'متطلبات', 'مطلوب',
  'بشأن', 'من', 'عن', 'على', 'الى', 'إلى', 'لدى', 'حتى', 'مع', 'بعد', 'قبل',
]);

function tokenizeSearch(text) {
  if (!text) return [];
  return String(text).toLowerCase()
    .split(/[^a-z0-9\u0600-\u06FF]+/i)
    .map(t => t.trim())
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

async function extractAllLinks(page, keyword, maxAds, cardsOnly = false) {
  const tokens = tokenizeSearch(keyword);
  return await page.evaluate(({ tokens, keyword, contactRe, phoneRe, junk, limit, cardsOnly }) => {
    const items = [];
    const seen = new Set();
    const JUNK = new Set(junk);

    // local copy of the contact-noise sanitizer (runs in the page context)
    const CONTACT_RE = new RegExp(contactRe, 'gi');
    const PHONE_RE = new RegExp(phoneRe, 'gi');
    const EMAIL_ONLY_RE = /^[\w.+-]+@[\w-]+\.[A-Za-z]{2,}$/;
    const sanitize = (s) => (String(s || '').replace(CONTACT_RE, ' ').replace(PHONE_RE, ' ').replace(/\s+/g, ' ').trim());
    const isEmailOnly = (s) => EMAIL_ONLY_RE.test(String(s || '').trim());

    const norm = (el) => (el ? (el.textContent || '').trim().replace(/\s+/g, ' ') : '');

    function isJunkTitle(t) {
      const lt = t.toLowerCase().trim();
      return JUNK.has(lt) || lt.length < 4 || lt.length > 90;
    }

    // strong listing signals in the href itself (job-specific, not generic categories)
    function isListingHref(href) {
      return /(job|vacanc|career|position|listing|classified|employ|jobs)/i.test(href)
        || /\/\d{4,}\b/.test(href);
    }

    // obvious category/browse pages that should never be kept without a keyword
    function isCategoryHref(href) {
      return /(category|catalog|catalogue|browse|explore|services|businesses|products|for-sale|rentals|vehicles|motorcycles|accessories|machinery|atv|tractors|harvesters|quad|boats|trucks|autos)/i.test(href)
        || /\bq=/.test(href)          // search-results/category pages, not single listings
        || /search_category=/.test(href);
    }

    // is this anchor presented as a listing title (heading / titled class)?
    function isTitleAnchor(anchor, href) {
      return !!anchor.closest('h1, h2, h3, h4, h5, [class*="title"]')
        || /(job.?title|jobtitle|vacanc|listing|position|title)/i.test(String(anchor.className || ''));
    }

    // token hits across title text + href only (container text is NOT used:
    // it pulls in nav/category megamenu junk)
    function tokenHits(targets) {
      if (!tokens.length) return 1;
      let hits = 0;
      for (const tk of tokens) {
        if (targets.some(t => t.indexOf(tk) !== -1)) hits++;
      }
      return hits;
    }

    function urlBonus(href) {
      if (!href) return 0;
      let s = 0;
      if (/job|vacanc|career|position|employ|listing|classified/i.test(href)) s += 8;
      if (/\/\d{4,}/.test(href)) s += 4;
      if (/\/(ad|item|post|listing|job|jd)\b/.test(href)) s += 4;
      const path = href.split('/');
      const depth = path.filter(Boolean).length;
      if (depth >= 3) s += 2;
      if (depth <= 2) s -= 3;
      return s;
    }

    function extractClassText(container, keys) {
      for (const k of keys) {
        const node = container.querySelector(`[class*="${k}"]`);
        if (node) {
          const t = sanitize(norm(node));
          if (t && t.length > 1) return t.slice(0, 80);
        }
      }
      return '';
    }

    function buildItem(anchor) {
      const href = (anchor.href || '').trim();
      if (!href || href.startsWith('javascript:') || href === '#' || href.startsWith('mailto:')) return null;
      try {
        if (anchor.closest('nav, header, footer, .nav, .header, .footer, .menu, .sidebar, form')) return null;
        if (anchor.closest('[class*="category-nav"], [class*="megamenu"], [class*="submenu"], [class*="dropdown"], [class*="-nav"], [class*="-menu"], [class*="ribbon"]')) return null;
        const u = new URL(href, location.href);
        if (u.hostname !== location.hostname && !isListingHref(href)) return null;
        if (u.hash && u.pathname === location.pathname) return null;
      } catch (e) { return null; }

      const rawTitle = norm(anchor);
      const titleText = sanitize(rawTitle);
      if (!titleText || isJunkTitle(titleText)) return null;
      // reject anchors that are nothing but a contact email/phone (not a listing)
      if (isEmailOnly(rawTitle) || isEmailOnly(titleText)) return null;

      const containerRaw = anchor.closest('li[class], article, tr, section, [class*="card"], [class*="listing"], [class*="result"], [class*="item"], [class*="vacanc"], [class*="post"], [class*="advert"], [class*="wrapper"], [class*="block"]');
      let container = containerRaw || anchor;
      // if the closest container is only a title/heading wrapper, step up to the real card
      if (container !== anchor && /(^|[-_])(title|head)([-_]|$)|job.?title|card.?title|heading/i.test(String(container.className || ''))) {
        const p = container.parentElement;
        if (p && p !== document.body) container = p;
      }
      const cardClass = String(container.className || '').toLowerCase();
      let containerText = (container.textContent || ' ').replace(/\s+/g, ' ').trim();
      if (containerText.length > 1500) containerText = titleText; // megamenu guard
      containerText = sanitize(containerText);

      const targets = [titleText.toLowerCase(), href.toLowerCase()];
      const m = tokenHits(targets);
      const titleStrong = isTitleAnchor(anchor, href);
      const cardJobHint = /job|vacanc|listing|carrer|position|result|classified/i.test(cardClass);
      const listingHref = isListingHref(href);
      const categoryHref = isCategoryHref(href);

      // Precision rule: with a keyword, the listing must mention it in title or url.
      if (categoryHref) return null; // search-results/category/browse pages are never listings
      if (tokens.length && m === 0) return null;
      // Without a keyword, require real listing evidence (no bare anchor nav/category links).
      if (!tokens.length && (!titleStrong && !cardJobHint && !listingHref)) return null;

      let s = urlBonus(href) + m * 20;
      if (titleStrong) s += 10;
      if (listingHref) s += 6;
      if (cardJobHint) s += 5;
      if (titleText.length >= 8 && titleText.length <= 70) s += 2;
      if (/salary|hiring|experience|vacanc|career|position|راتب|خبرة|وظيفة|ألف|ريال/i.test(titleText)) s += 1;

      const company = extractClassText(container, ['company', 'employer', 'firm', 'org']);
      const place = extractClassText(container, ['location', 'place', 'city', 'area', 'region', 'country']);
      const date = extractClassText(container, ['date', 'time', 'posted', 'ago']);
      const salary = extractClassText(container, ['salary', 'wage', 'compensation', 'pay', 'package', 'price', 'amount']);

      let desc = containerText;
      for (const part of [titleText, company, salary, place, date]) {
        if (part) desc = desc.split(part).join(' ');
      }
      desc = desc.replace(/\s+/g, ' ').trim().slice(0, 300);

      return {
        title: titleText.slice(0, 150),
        url: href,
        price: salary,
        location: place,
        date,
        description: desc,
        source: location.hostname || '',
        matched: keyword || '',
        _score: s,
        _tokens: m,
      };
    }

    // 1) prefer real listing cards; pick the HIGHEST-scoring item per href
    //    (nested containers like result Wrappers + article + title-h2 must not
    //    collide — dedupe by URL, and favour the deepest card)
    const CARD_SEL = '[class*="job-card"], [class*="vacanc"], [class*="listing"], [class*="career"], [class*="result-item"], [class*="search-item"], [class*="ad-item"], [class*="position"], [class*="post"], article, li[class]';
    const bestByUrl = new Map();
    const addItem = (it) => {
      const prev = bestByUrl.get(it.url);
      if (!prev || it._score > prev._score) bestByUrl.set(it.url, it);
    };
    for (const card of document.querySelectorAll(CARD_SEL)) {
      if (bestByUrl.size >= limit * 2) break;
      // NOTE: no nested-card skip — on opaque cards (nested li[class] widgets,
      // wrapping sections) skipping would drop every anchor. Dedupe happens
      // below via bestByUrl, and megamenu/nav/ribbon anchors are already excluded
      // inside buildItem.
      for (const a of card.querySelectorAll('a[href]')) {
        if (a.closest('nav, header, footer, .nav, .header, .footer, .menu, .sidebar, form')) continue;
        const it = buildItem(a);
        if (it) addItem(it);
      }
    }
    items.push(...bestByUrl.values());

    // 2) fallback: remaining anchors (one per href) — only when cards are allowed
    if (items.length === 0 && !cardsOnly) {
      const grabbed = new Set();
      for (const a of document.querySelectorAll('a[href]')) {
        if (items.length >= limit) break;
        if (a.closest(CARD_SEL)) continue;
        if (grabbed.has(a.href)) continue;
        grabbed.add(a.href);
        const it = buildItem(a);
        if (it) items.push(it);
      }
    }

    const kept = tokens.length ? items.filter(i => i._tokens > 0) : items;
    kept.sort((a, b) => b._score - a._score);
    return kept.slice(0, limit).map(({ _score, _tokens, ...item }) => item);
  }, { tokens, keyword: keyword || '', contactRe: CONTACT_RE_SRC, phoneRe: PHONE_RE_SRC, junk: Array.from(JUNK_TITLES), limit: maxAds || 100, cardsOnly });
}

// ── Visit individual ad pages for full details ──
async function visitAdPage(page, item, timeout = 12000) {
  let details = null;
  const titleClean = String(item.title || '').replace(/\s+/g, ' ').trim();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout });
    } catch (e) { /* retry below */ }
    await page.waitForTimeout(1500 + attempt * 2500);

    try {
      details = await page.evaluate(({ itemTitle, vaDebug }) => {
        const dbg = { hasTitle: false };
        const sel = 'article, .entry-content, .post-content, .article-body, .job-description, .listing-description, .job-details, .ad-details, main, .content, .post, .entry';
        const titleLC = String(itemTitle || '').toLowerCase();
        dbg.titleLC = titleLC.slice(0, 40);
        let cands = [];
        for (const el of document.querySelectorAll(sel)) {
          const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
          if (t.length < 40) continue;
          const tl = t.toLowerCase();
          const jobLike = /(salary|apply|experience|requirement|visa|cv|resume|hiring|qualification|work|duty|shift|telephone|contact)/i.test(tl);
          cands.push({ el, t, hasTitle: tl.includes(titleLC), jobLike });
        }
        cands.sort((a, b) => a.t.length - b.t.length);
        const withTitle = cands.filter(c => c.hasTitle).sort((a, b) => b.t.length - a.t.length);
        dbg.cands = cands.slice(0, 6).map(c => ({ tag: c.el.tagName, cls: String(c.el.className).slice(0, 30), len: c.t.length, ht: c.hasTitle, head: c.t.slice(0, 50) }));
        const top = (withTitle[0]
          && withTitle[0].t.length <= 30000
          && withTitle[0].el !== document.body
          && withTitle[0].el.tagName !== 'BODY'
          ? withTitle[0] : null)
          || cands.find(c => c.jobLike && c.el !== document.body && c.el.tagName !== 'BODY' && !c.el.closest('form, aside, [class*="login"], [class*="modal"], [class*="popup"], [class*="register"]'));
        const region = top ? top.el : null;
        dbg.region = top ? top.tag + '.' + String(top.cls).split(' ')[0] : 'NULL';
        const body = (document.body ? document.body.innerText : '') || '';
        const allStart = body.replace(/\s+/g, ' ');

        const CONTACT_RE = new RegExp('[\\w.+-]+@[\\w-]+\\.[A-Za-z]{2,}|(?:https?:\\/\\/)?(?:www\\.)?(?:wa\\.me|t\\.me|instagram\\.com|facebook\\.com|linkedin\\.com|youtube\\.com|twitter\\.com|x\\.com)\\/[A-Za-z0-9._\\/-]+', 'gi');
        const PHONE_RE = new RegExp('(?:\\+?\\d{1,3}[\\s.-]?)?(?:\\(\\d{2,4}\\)[\\s.-]?)?(?:\\d{4,5}[\\s.-]?\\d{3,4}[\\s.-]?\\d{2,5}|\\+\\d{1,3}[\\s.-]\\d{3,4}[\\s.-]?\\d{4,}|\\+\\d{6,15})\\b', 'gi');
        const clean = s => String(s || '').replace(CONTACT_RE, ' ').replace(PHONE_RE, ' ').replace(/\s+/g, ' ').trim();

        const pick = (root, sels) => {
          const rootSet = root ? root.querySelectorAll(sels) : [];
          const all = document.querySelectorAll(sels);
          const node = (rootSet && rootSet.length ? rootSet[0] : (all.length ? all[0] : null));
          if (!node) return '';
          const raw = node.textContent || node.innerText || '';
          return clean(raw).slice(0, 120);
        };

        let regionText = region ? clean(region.innerText) : '';
        dbg.regionHead = regionText.slice(0, 80);
        dbg.regionLen = regionText.length;

        // BEST source: the article's own paragraphs (<p>) — they hold the real ad
        // body and skip breadcrumbs, share buttons, tag clouds and prev/next junk.
        let descText = '';
        if (region) {
          const ps = [...region.querySelectorAll('p')]
            .map(p => clean(p.textContent || p.innerText || ''))
            .filter(t => t.length >= 15);
          dbg.pCount = ps.length;
          if (ps.length) descText = ps.join(' | ');
        }
        // fallback A: strip breadcrumb + repeated title from the region text
        if (!descText && regionText && itemTitle) {
          const titleOnce = String(itemTitle).replace(/\s+/g, ' ').trim();
          const tlc = titleOnce.toLowerCase();
          const first = regionText.toLowerCase().indexOf(tlc.slice(0, 40));
          dbg.idxIdx = first;
          if (first >= 0) regionText = regionText.slice(first);
          let pos = regionText.toLowerCase().indexOf(tlc);
          dbg.ti = pos;
          if (pos >= 0) regionText = regionText.slice(pos + titleOnce.length);
          else regionText = regionText.split(titleOnce).join(' ');
          dbg.afterIdx = regionText.slice(0, 60);
          regionText = regionText
            .replace(/\bBy\s+[A-Z][\w.-]*\b\s*(?=\d{1,2},?\s+202[0-9])/g, ' ')
            .replace(/\b(?:Share|WhatsApp|Facebook|Telegram|Twitter|Pinterest)\b.*/g, ' ')
            .replace(/\s+/g, ' ').trim();
          dbg.afterClean = regionText.slice(0, 80);
          descText = regionText;
        }
        // fallback B: whole body (rare)
        if (!descText) descText = regionText || allStart;

        let fullLocation = pick(region, '[class*="location"], [class*="address"], [class*="map"], [class*="city"], [class*="region"]');
        if (!fullLocation && descText) {
          const locMatch = descText.slice(0, 250).match(/(?:Doha|Qatar|Riyadh|Jeddah|Dammam|Khobar|Dubai|Abu Dhabi|Sharjah|Manama|Bahrain|Kuwait City|Kuwait|Muscat|Oman|Saudi Arabia|KSA|United Arab Emirates)/i);
          if (locMatch) fullLocation = locMatch[0];
        }

        const dateMatch = descText.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2}\b/i);

        return {
          description: descText.slice(0, 500),
          salary: pick(region, '[class*="salary"], [class*="compensation"], [class*="wage"], [class*="pay"], [class*="package"]'),
          fullLocation: String(fullLocation || '').slice(0, 60),
          date: dateMatch ? dateMatch[0] : '',
          pageGood: allStart.length > 20,
          dbg: vaDebug ? dbg : undefined,
        };
      }, { itemTitle: item.title, vaDebug: process.env.VA_DEBUG === '1' });
    } catch (e) {
      details = null;
    }
    if (details && details.pageGood) break;
  }

if (!details || !details.pageGood) return item;

  if (process.env.VA_DEBUG === '1') console.log('[VA-DEBUG]', JSON.stringify(details.dbg || {}));

  return {
    ...item,
    description: details.description || item.description,
    salary: details.salary || item.salary || '',
    location: details.fullLocation && details.fullLocation.length <= 60 ? details.fullLocation : item.location,
    date: details.date || item.date,
    visited: true,
  };
}

// ── Pagination ──
async function clickNext(page) {
  const before = page.url();
  const nextSelectors = [
    'a[rel="next"]', '[aria-label="Next"]', '[aria-label="Next page"]',
    'a:has-text("Next")', 'a:has-text("التالي")', '.pagination .next', 'a.next', 'button.next',
    'a[href*="page="]', '.pagination a:last-child',
  ];
  for (const sel of nextSelectors) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      if ((await el.getAttribute('aria-disabled')) === 'true') continue;
      if (sel.includes(':last-child')) {
        const cls = (await el.getAttribute('class')) || '';
        if (!/next|pag/.test(cls)) continue;
      }
      await el.click();
      await page.waitForTimeout(2000);
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (e) { /* ignore */ }
      if (page.url() !== before) return true;
    } catch (e) { /* try next */ }
  }
  return false;
}

// ── Dedup ──
function dedupeResults(results) {
  const seen = new Set();
  return results.filter(item => {
    const key = item.url || item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Main Scraper ──
async function runScrape(url, search, maxPages, maxAds, options = {}) {
  let context = null;
  const results = [];
  const site = new URL(url).hostname;
  const startTime = Date.now();

  try {
    logInfo('🚀 تشغيل المتصفح...');
    if (!browser) {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security',
        ],
      });
    }

    const ua = randomUA();
    context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'Asia/Riyadh',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
    });

    // Add stealth scripts
    await context.addInitScript(() => {
      // Override webdriver detection
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Override plugins
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      // Override languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ar'] });
      // Override Chrome detection
      window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){}, app: {} };
      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    const page = await context.newPage();

    logInfo(`🌐 ${url}`);
    logInfo(`🔑 UA: ${ua.slice(0, 50)}...`);

    // Check learning data for best strategy
    const bestStrategy = getBestStrategy(site);
    if (bestStrategy) {
      logInfo(`🧠 استخدام أفضل استراتيجية مسجلة: ${bestStrategy}`);
    }

    await navigate(page, url);
    const title = await page.title();
    logSuccess(`✅ ${title}`);

    // Check if blocked
    if (await isBlocked(page)) {
      logWarn('⚠️ الموقع يطلب فحص — محاولة التخطي...');
      await page.waitForTimeout(5000);
    }

    // Scroll to trigger lazy loading
    await page.evaluate(() => {
      window.scrollBy(0, 500);
    }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    }).catch(() => {});
    await page.waitForTimeout(1000);

    // Count links on page before search
    const linkCount = await page.evaluate(() => document.querySelectorAll('a[href]').length).catch(() => 0);
    logInfo(`🔗 الروابط على الصفحة: ${linkCount}`);

    // Debug: show page title and content snippet
    const debugInfo = await page.evaluate(() => {
      return {
        title: document.title,
        bodyLength: (document.body?.innerText || '').length,
        bodySnippet: (document.body?.innerText || '').slice(0, 300),
        linkCount: document.querySelectorAll('a[href]').length,
        hasCloudflare: document.title.toLowerCase().includes('just a moment') || document.title.toLowerCase().includes('checking'),
      };
    }).catch(() => ({}));
    logInfo(`📄 العنوان: "${debugInfo.title}" | محتوى: ${debugInfo.bodyLength} حرف`);
    if (debugInfo.bodyLength < 200) {
      logWarn(`⚠️ محتوى صغير — قد يكون Cloudflare أو صفحة فارغة`);
      logInfo(`📝 المحتوى: "${debugInfo.bodySnippet?.slice(0, 200)}"`);
    }

    // Search + extract across one or more queries
    const searchList = Array.isArray(search) ? search.filter(Boolean) : (search ? [search] : []);
    const queries = searchList.length ? searchList : [''];
    const maxQueries = 4;
    let searchStrategy = '';

    for (let qi = 0; qi < queries.length && qi < maxQueries; qi++) {
      if (abortController?.signal.aborted) break;
      const q = queries[qi];
      searchStrategy = '';
      if (qi > 0) {
        logInfo(`🗂 جولة بحث ${qi + 1}/${Math.min(queries.length, maxQueries)} («${q}») — العودة للصفحة الرئيسية...`);
        await navigate(page, url);
      }

      let searched = false;
      if (q) {
        logInfo(`🔎 "${q}"`);

        // Try form first
        const formResult = await trySearchForm(page, url, q);
        if (formResult) { searched = true; searchStrategy = formResult.strategy; }
        else {
          // Try URL patterns
          const urlResult = await trySearchURLPatterns(page, url, q);
          if (urlResult) { searched = true; searchStrategy = urlResult.strategy; }
          else {
            // Try input
            const inputResult = await trySearchInput(page, q);
            if (inputResult) { searched = true; searchStrategy = inputResult.strategy; }
          }
        }
        if (!searched) logWarn('⚠️ ما لقيت مربع بحث — بجيب كل الروابط وأصفّي');
      }

      // Extract from current page
      logInfo('📥 استخراج...');
      // Wait a moment for lazy-loaded result cards to render before extracting
      try {
        await page.waitForSelector('a[href*="/p/"], [class*="listing-tile"], [class*="search-results"], [class*="results-list"], [class*="result__"], [class*="ad-item"], [class*="vacancy"], [class*="job-item"]', { timeout: 10000 });
      } catch (e) { /* page may not use those markers */ }
      await page.waitForTimeout(1500);

      let data = await extractAllLinks(page, q, maxAds);
      logInfo(`📦 استخرج ${data.length} عنصر في جولة «${q || 'بدون بحث'}»`);

      // Debug: if 0 results, try extracting listing cards only (no real listings → honest 0)
      if (data.length === 0) {
        logWarn('⚠️ 0 نتائج — محاولة استخراج بطاقات الإعلانات فقط (بدون روابط تنقل)...');
        data = await extractAllLinks(page, '', maxAds + 50, true);
        logInfo(`🔗 بطاقات فقط: ${data.length} رابط`);
        for (const item of data.slice(0, 5)) {
          logInfo(`  📎 ${item.title.slice(0, 60)} → ${item.url.slice(0, 80)}`);
        }
        // Some sites have no real site-search (WordPress blogs like gulfjobpaper):
        // fall back to the ORIGINAL page with the keyword applied (sidebar/featured links).
        if (data.length === 0 && q && searched) {
          logWarn(`⏪ لا يوجد بحث حقيقي — أرجوع للصفحة الأصلية والاستخراج بكلمة «${q}»...`);
          await navigate(page, url);
          try {
            await page.waitForSelector('a[href*="/p/"], [class*="listing-tile"], [class*="search-results"], [class*="results-list"], [class*="post"], article, h2, h3', { timeout: 8000 });
          } catch (e) { /* ok */ }
          await page.waitForTimeout(1500);
          data = await extractAllLinks(page, q, maxAds);
          logInfo(`🔗 من الصفحة الأصلية: ${data.length} رابط`);
        }
        for (const item of data.slice(0, 5)) {
          logInfo(`  📎 ${item.title.slice(0, 60)} → ${item.url.slice(0, 80)}`);
        }
      }
      const uniqueNew = data.filter(d => !results.some(r => r.url === d.url));
      results.push(...uniqueNew);
      logSuccess(`📦 جولة «${q || 'الصفحة الرئيسية'}»: ${uniqueNew.length} عنصر`);
      for (const item of uniqueNew) broadcast('result', item);

      // Paginate
      for (let p = 2; p <= (maxPages || 5) && results.length < (maxAds || 100); p++) {
        const hasNext = await clickNext(page);
        if (!hasNext) { logInfo('📄 خلاص ما في صفحات زيادة'); break; }
        logInfo(`📄 الصفحة ${p}...`);
        try {
          await page.waitForSelector('a[href*="/p/"], [class*="listing-tile"], [class*="search-results"], [class*="results-list"], [class*="result__"], [class*="ad-item"], [class*="vacancy"], [class*="job-item"]', { timeout: 10000 });
        } catch (e) { /* ok */ }
        await page.waitForTimeout(1500);
        data = await extractAllLinks(page, q, maxAds);
        const newOnes = data.filter(d => !results.some(r => r.url === d.url));
        results.push(...newOnes);
        logSuccess(`📦 الصفحة ${p}: ${newOnes.length} جديد (المجموع: ${results.length})`);
        for (const item of newOnes) broadcast('result', item);
        if (results.length >= (maxAds || 100)) break;
      }
    }

    // Visit individual ad pages for richer details (limit to first 20)
    if (options.visitPages !== false && results.length > 0) {
      logInfo(`🔍 زيارة ${Math.min(results.length, 20)} صفحة إعلان للتفاصيل...`);
      const toVisit = results.slice(0, 20);
      for (let i = 0; i < toVisit.length; i++) {
        if (abortController?.signal.aborted) break;
        logInfo(`  📄 ${i + 1}/${toVisit.length}: ${toVisit[i].title.slice(0, 40)}...`);
        const enriched = await visitAdPage(page, toVisit[i]);
        // Update the result in-place
        const idx = results.findIndex(r => r.url === toVisit[i].url);
        if (idx !== -1) results[idx] = enriched;
        broadcast('result', enriched);
      }
    }

    // Dedup
    const deduped = dedupeResults(results).map(cleanItemForSave);
    if (deduped.length < results.length) {
      logInfo(`🧹 إزالة ${results.length - deduped.length} مكرر → ${deduped.length} فريد`);
    }

    // Record success
    recordSiteSuccess(site, searchStrategy || 'none');

    // Save
    if (deduped.length > 0) {
      const slug = site.replace(/\./g, '_');
      const name = `${slug}_${Date.now()}.json`;
      const fp = path.join(OUTPUT, name);
      fs.writeFileSync(fp, JSON.stringify(deduped, null, 2), 'utf-8');
      logSuccess(`💾 حفظ ${deduped.length} نتيجة ← ${name}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logSuccess(`⏱ الوقت: ${elapsed}ث | الإجمالي: ${deduped.length} نتيجة`);

    await context.close();
    return deduped;

  } catch (err) {
    logError(`❌ ${err.message}`);
    recordSiteFailure(site, 'error');
    if (context) await context.close().catch(() => {});
    return results;
  }
}

// ── Keyword Generator API ──
app.post('/api/keywords/generate', (req, res) => {
  const { input } = req.body || {};
  if (!input) return res.json({ error: 'input required' });
  const keywords = generateKeywords(input);
  const family = detectFamily(input);
  res.json({ keywords, family });
});

app.get('/api/keywords/families', (req, res) => {
  const list = Object.entries(JOB_FAMILIES).map(([key, val]) => ({
    key,
    label: key,
    keywords: val.en.slice(0, 3),
    arabic: val.ar.slice(0, 2),
  }));
  res.json({ families: list });
});

// ── Learning API ──
app.get('/api/learning', (req, res) => {
  res.json({ data: learningData });
});

// ── Scrape API ──
app.post('/api/scrape/start', async (req, res) => {
  const { url, search, maxPages = 10, maxAds = 100, generateKeywords: genMode, visitPages } = req.body || {};
  if (!url) return res.json({ error: 'الرجاء إدخال رابط الموقع' });

  // Auto-generate keywords if requested
  let finalSearch = search;
  if (search) {
    if (genMode) {
      const generated = generateKeywords(search);
      logInfo(`🧠 كلمات مولّدة: ${generated.join(', ')}`);
      finalSearch = generated.slice(0, 4); // run multiple search rounds
    } else {
      finalSearch = [search];
    }
  }

  abortController = new AbortController();

  runScrape(url, finalSearch, parseInt(maxPages), parseInt(maxAds), { visitPages })
    .then((results) => {
      broadcast('done', { code: 0, count: results.length, outputDir: OUTPUT });
    })
    .catch((err) => {
      if (err.message?.includes('aborted')) return;
      broadcast('error', { message: err.message });
    });

  res.json({ ok: true });
});

app.post('/api/scrape/stop', (req, res) => {
  if (abortController) abortController.abort();
  broadcast('stopped', {});
  res.json({ ok: true });
});

app.get('/api/results', (req, res) => {
  try {
    const files = fs.readdirSync(OUTPUT).filter(f => f.endsWith('.json') && !f.startsWith('.'));
    const all = files.map(f => {
      const p = path.join(OUTPUT, f);
      try { return { name: f, size: fs.statSync(p).size, time: fs.statSync(p).mtimeMs }; } catch (e) { return null; }
    }).filter(Boolean).sort((a, b) => b.time - a.time);
    res.json({ files: all });
  } catch (e) { res.json({ files: [] }); }
});

app.get('/api/results/read', (req, res) => {
  const name = req.query.file;
  if (!name) return res.status(400).json({ error: 'file name required' });
  const p = path.join(OUTPUT, path.basename(name));
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    res.json({ data });
  } catch (e) { res.json({ error: 'parse error' }); }
});

app.get('/api/info', (req, res) => {
  res.json({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: ROOT,
    outputDir: OUTPUT,
    version: '10.0.0',
    features: ['stealth', 'retry', 'self-learning', 'keyword-generator', 'page-visit', 'dedup'],
  });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

import { logger } from '../core/logger.mjs';
logger.warn('app/server.mjs (port 3456) is DEPRECATED — consolidate to web/server.mjs (port 3000). Kept for legacy START_SCRAPER.bat only.');

const PORT = process.env.SCRAPER_UI_PORT || 3456;
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  app.listen(PORT, () => {
    logger.info('legacy scraper UI started (deprecated)', { port: PORT });
    console.log(`\n  ║  http://localhost:${PORT}                    ║`);
  });
}

export { extractAllLinks, tokenizeSearch, visitAdPage };

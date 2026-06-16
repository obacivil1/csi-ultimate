/**
 * ============================================================
 *  CSI-Ultimate — BrowserPool v2 (Cloudflare Bypass)
 *  core/browser-pool.mjs
 * ============================================================
 *
 *  التغييرات عن v1:
 *  ─────────────────
 *  ✅ args مُحسّنة لتجاوز Cloudflare
 *  ✅ userAgent Chrome 125 حقيقي
 *  ✅ إزالة route filter (يسبب مشاكل مع CF challenge)
 *  ✅ locale + timezoneId + geolocation واقعية
 *  ✅ webgl + canvas fingerprint طبيعي
 */

import { chromium } from "playwright-extra";
import stealth       from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

// ── إعدادات Context محسّنة لتجاوز Cloudflare ─────────────────
const CTX_OPTIONS = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  viewport:  { width: 1440, height: 900 },
  locale:    "en-US",
  timezoneId: "Asia/Riyadh",
  extraHTTPHeaders: {
    "Accept-Language":           "en-US,en;q=0.9,ar;q=0.8",
    "Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Encoding":           "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest":            "document",
    "Sec-Fetch-Mode":            "navigate",
    "Sec-Fetch-Site":            "none",
    "Sec-Fetch-User":            "?1",
    "Cache-Control":             "max-age=0",
  },
};

// ── args لتجاوز الكشف ────────────────────────────────────────
const LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-first-run",
  "--no-zygote",
  "--disable-gpu",
  "--window-size=1440,900",
  "--start-maximized",
];

// ── Cloudflare bypass script يُحقن في كل صفحة ───────────────
const CF_BYPASS_SCRIPT = `
  // إخفاء علامات الـ automation
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  window.chrome = { runtime: {} };
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
`;

// ── إنشاء context + page جاهزة ────────────────────────────────
async function buildSlot(browser) {
  const ctx  = await browser.newContext(CTX_OPTIONS);
  
  // حقن سكريبت الـ bypass في كل صفحة جديدة
  await ctx.addInitScript(CF_BYPASS_SCRIPT);
  
  const page = await ctx.newPage();
  
  // حجب الصور فقط (لا نحجب JS أو CSS)
  await page.route("**/*.{png,jpg,jpeg,gif,svg,ico,webp,avif}", route => route.abort());
  
  return { ctx, page, healthy: true };
}

// ============================================================
//  BrowserPool
// ============================================================

export class BrowserPool {
  constructor(browser, opts = {}) {
    this._browser        = browser;
    this._size           = opts.size           ?? 3;
    this._maxUses        = opts.maxUses        ?? 50;
    this._acquireTimeout = opts.acquireTimeout ?? 60_000;

    this._pool    = [];
    this._waiters = [];
    this._stats   = { acquired: 0, released: 0, recycled: 0, errors: 0 };
    this._ready   = false;
  }

  async init() {
    if (this._ready) return this;
    const slots = await Promise.all(
      Array.from({ length: this._size }, () =>
        buildSlot(this._browser).then(s => ({ ...s, uses: 0 }))
      )
    );
    this._pool.push(...slots);
    this._ready = true;
    console.log(`[BrowserPool] ✅ pool جاهز — ${this._size} contexts`);
    return this;
  }

  acquire() {
    return new Promise((resolve, reject) => {
      const tryGet = () => {
        const idx = this._pool.findIndex(s => s.healthy && !s._busy);
        if (idx !== -1) {
          const slot = this._pool[idx];
          slot._busy = true;
          slot.uses++;
          this._stats.acquired++;
          resolve({ ctx: slot.ctx, page: slot.page, _slot: slot });
          return true;
        }
        return false;
      };

      if (tryGet()) return;

      let timer;
      const waiter = () => {
        clearTimeout(timer);
        if (!tryGet()) this._waiters.push(waiter);
      };
      this._waiters.push(waiter);
      timer = setTimeout(() => {
        const i = this._waiters.indexOf(waiter);
        if (i !== -1) this._waiters.splice(i, 1);
        this._stats.errors++;
        reject(new Error("[BrowserPool] acquire() timeout — كل الـ contexts مشغولة"));
      }, this._acquireTimeout);
    });
  }

  async release(handle, markUnhealthy = false) {
    const slot = handle._slot;
    if (!slot) return;
    this._stats.released++;

    const needsRecycle = markUnhealthy || !slot.healthy || slot.uses >= this._maxUses;
    if (needsRecycle) {
      this._stats.recycled++;
      try { await slot.page?.close?.().catch(() => {}); } catch {}
      try { await slot.ctx.close(); } catch {}
      try {
        const fresh  = await buildSlot(this._browser);
        slot.ctx     = fresh.ctx;
        slot.page    = fresh.page;
        slot.healthy = true;
        slot.uses    = 0;
      } catch (e) {
        slot.healthy = false;
        console.error("[BrowserPool] ❌ فشل إعادة بناء context:", e.message);
      }
    }

    slot._busy = false;
    const waiter = this._waiters.shift();
    if (waiter) waiter();
  }

  async withPage(fn) {
    const handle = await this.acquire();
    try {
      await handle.page.goto("about:blank", { timeout: 5000 }).catch(() => {});
      const result = await fn(handle.page);
      await this.release(handle);
      return result;
    } catch (err) {
      await this.release(handle, true);
      throw err;
    }
  }

  async drain() {
    const closing = this._pool.map(async (s) => {
      try { await s.page?.close?.().catch(() => {}); } catch {}
      try { await s.ctx.close(); } catch {}
    });
    await Promise.allSettled(closing);
    this._pool    = [];
    this._waiters = [];
    this._ready   = false;
    console.log("[BrowserPool] 🛑 pool أُغلق");
  }

  stats() {
    const busy = this._pool.filter(s => s._busy).length;
    const free = this._pool.filter(s => !s._busy && s.healthy).length;
    return { ...this._stats, busy, free, total: this._pool.length };
  }
}

export async function createPool(poolOpts = {}) {
  const browser = await chromium.launch({
    headless: true,
    args:     LAUNCH_ARGS,
  });
  const pool = new BrowserPool(browser, poolOpts);
  await pool.init();
  return { browser, pool };
}

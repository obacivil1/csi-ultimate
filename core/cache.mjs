/**
 * ============================================================
 *  CSI-Ultimate — Cache
 *  طبقة التخزين المؤقت: ذاكرة + ملف + TTL + Resume
 *  Stage 2A — core/cache.mjs
 * ============================================================
 *
 *  لماذا؟
 *  -------
 *  v4 لا يخزّن أي شيء — إذا انقطع التشغيل في الإعلان 150،
 *  يبدأ من الصفر مرة أخرى.
 *
 *  الطبقات:
 *  ---------
 *  L1 — Map في الذاكرة (سريعة جداً، تُفقد عند الإغلاق).
 *  L2 — ملف JSON على الديسك (تبقى بين الجلسات).
 *
 *  الميزات:
 *  ---------
 *  - TTL لكل إدخال (إذا انتهت مدته يُعامَل كـ miss).
 *  - set / get / has / delete / clear.
 *  - flush() : يكتب L1 إلى L2 فوراً.
 *  - auto-flush: كل N عملية set أو كل T ثانية.
 *  - keys() / values() / entries() للمرور على المخزون.
 *  - حجم L1 محدود (LRU بسيط بـ Map).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname }                                            from "path";

const DEFAULT_TTL       = 24 * 60 * 60 * 1000; // 24 ساعة
const DEFAULT_L1_MAX    = 2_000;                // حد الذاكرة
const DEFAULT_AUTO_SAVE = 50;                   // احفظ كل 50 set
const DEFAULT_SAVE_INTERVAL = 60_000;           // أو كل دقيقة

// ── تسلسل/فك-تسلسل آمن ──────────────────────────────────────
const serialize   = v => JSON.stringify(v);
const deserialize = s => JSON.parse(s);

// ============================================================
//  Cache
// ============================================================

export class Cache {
  /**
   * @param {object} opts
   * @param {string}  opts.path          - مسار ملف الـ L2 (مثلاً "./state/cache.json")
   * @param {number}  [opts.ttl]         - ms مدة بقاء الإدخال (افتراضي: 24h)
   * @param {number}  [opts.l1Max]       - أقصى إدخالات في الذاكرة (2000)
   * @param {number}  [opts.autoSave]    - احفظ كل N عملية set (50)
   * @param {number}  [opts.saveInterval]- احفظ كل N ms (60_000)
   * @param {boolean} [opts.persist]     - فعّل L2 (افتراضي: true)
   */
  constructor(opts = {}) {
    this._path         = opts.path          ?? "./state/cache.json";
    this._ttl          = opts.ttl           ?? DEFAULT_TTL;
    this._l1Max        = opts.l1Max         ?? DEFAULT_L1_MAX;
    this._autoSave     = opts.autoSave      ?? DEFAULT_AUTO_SAVE;
    this._saveInterval = opts.saveInterval  ?? DEFAULT_SAVE_INTERVAL;
    this._persist      = opts.persist       !== false;

    /** @type {Map<string, {v: string, exp: number}>} */
    this._map  = new Map();
    this._dirty = 0;  // عدد التعديلات منذ آخر flush
    this._saveTimer = null;

    // تحميل L2 إذا وُجد
    if (this._persist) {
      this._loadFromDisk();
      this._startAutoSave();
    }
  }

  // ── تخزين قيمة ───────────────────────────────────────────────
  /**
   * @param {string} key
   * @param {*}      value
   * @param {number} [ttl] - ms (يُلغي الافتراضي)
   */
  set(key, value, ttl) {
    const exp = Date.now() + (ttl ?? this._ttl);
    this._evictIfNeeded();
    this._map.set(key, { v: serialize(value), exp });
    this._dirty++;
    if (this._dirty >= this._autoSave) this.flush();
    return this;
  }

  // ── قراءة قيمة ───────────────────────────────────────────────
  /** @returns {* | undefined} */
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.exp) {
      this._map.delete(key);
      return undefined;
    }
    // LRU: أعد الإدراج في نهاية الـ Map
    this._map.delete(key);
    this._map.set(key, entry);
    return deserialize(entry.v);
  }

  // ── فحص وجود مفتاح ───────────────────────────────────────────
  has(key) {
    return this.get(key) !== undefined;
  }

  // ── حذف مفتاح ────────────────────────────────────────────────
  delete(key) {
    const deleted = this._map.delete(key);
    if (deleted) { this._dirty++; if (this._dirty >= this._autoSave) this.flush(); }
    return deleted;
  }

  // ── مسح الكل ─────────────────────────────────────────────────
  clear() {
    this._map.clear();
    this._dirty++;
    this.flush();
  }

  // ── إحصاءات ───────────────────────────────────────────────────
  size()  { return this._map.size; }
  keys()  { return [...this._map.keys()]; }

  /** يُعيد كل القيم غير المنتهية الصلاحية */
  values() {
    const now = Date.now();
    return [...this._map.entries()]
      .filter(([, e]) => e.exp > now)
      .map(([, e]) => deserialize(e.v));
  }

  entries() {
    const now = Date.now();
    return [...this._map.entries()]
      .filter(([, e]) => e.exp > now)
      .map(([k, e]) => [k, deserialize(e.v)]);
  }

  // ── حذف المنتهية الصلاحية يدوياً ─────────────────────────────
  purgeExpired() {
    const now     = Date.now();
    let   removed = 0;
    for (const [k, e] of this._map) {
      if (e.exp <= now) { this._map.delete(k); removed++; }
    }
    if (removed > 0) this.flush();
    return removed;
  }

  // ── كتابة L2 ─────────────────────────────────────────────────
  flush() {
    if (!this._persist) return;
    try {
      const now  = Date.now();
      const data = {};
      for (const [k, e] of this._map) {
        if (e.exp > now) data[k] = e;   // لا تحفظ المنتهية
      }
      mkdirSync(dirname(this._path), { recursive: true });
      writeFileSync(this._path, JSON.stringify(data), "utf8");
      this._dirty = 0;
    } catch (err) {
      console.error("[Cache] ❌ فشل الحفظ:", err.message);
    }
  }

  // ── إغلاق نظيف ────────────────────────────────────────────────
  close() {
    if (this._saveTimer) {
      clearInterval(this._saveTimer);
      this._saveTimer = null;
    }
    this.flush();
  }

  // ──────────────────────────────────────────────────────────────
  //  خاص
  // ──────────────────────────────────────────────────────────────

  _loadFromDisk() {
    if (!existsSync(this._path)) return;
    try {
      const raw  = readFileSync(this._path, "utf8");
      const data = JSON.parse(raw);
      const now  = Date.now();
      for (const [k, e] of Object.entries(data)) {
        if (e.exp > now) this._map.set(k, e);
      }
      console.log(`[Cache] 📂 تحميل ${this._map.size} إدخال من ${this._path}`);
    } catch (err) {
      console.warn("[Cache] ⚠️  فشل تحميل ملف الـ cache:", err.message);
    }
  }

  _startAutoSave() {
    this._saveTimer = setInterval(() => {
      if (this._dirty > 0) this.flush();
      this.purgeExpired();
    }, this._saveInterval);
    // لا تمنع إغلاق Node
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  /** LRU eviction: احذف الأقدم إذا امتلأ L1 */
  _evictIfNeeded() {
    if (this._map.size < this._l1Max) return;
    const firstKey = this._map.keys().next().value;
    this._map.delete(firstKey);
  }
}

// ── نسخ جاهزة للاستخدام المباشر ─────────────────────────────

/** Cache للإعلانات المُستخرجة (TTL يوم واحد) */
export const adCache = new Cache({
  path: "./state/ads.cache.json",
  ttl:  24 * 60 * 60 * 1000,
  l1Max: 10_000,
});

/** Cache لصفحات القوائم (TTL ساعتان) */
export const pageCache = new Cache({
  path: "./state/pages.cache.json",
  ttl:  2 * 60 * 60 * 1000,
  l1Max: 500,
});

/** إغلاق نظيف عند خروج العملية */
process.on("exit", () => { adCache.close(); pageCache.close(); });

/**
 * drift-detector.mjs — كشف انزياح بنية/استجابات المضيف (مستوحى من N0VA v3.21 ml_drift_events)
 * ────────────────────────────────────────────────────────────────────────────
 * النمط المنقول: لا نكشتف انجراف نموذج ML بل انجراف الموقع الكشطي نفسه —
 * تغيّر بنية الصفحة/استجاباتها عبر الزمن. لكل مضيف نبني distrib
 * توقعات إحصائية متدفقة (Welford) على ميزات الاستجابة: عدد الأحرف، الروابط، الصور، زمن
 * الاستجابة، الحالة. عندما تقع عيّنة جديدة بعيدة معدل ±k·σ تُسجَّل كـ
 * "حدث إنجراف" مع ميزة_top لمراجعة سلوك المضيف.
 *
 * الميزات المقترحة (agility):
 *   - thresholds التكيفي: يضبط الحد بناءً على التباين الأخير
 *   - feature weights: وزن مميزات معينة بأولوية أعلى
 *   - sliding window: خيار نافذة منزاحة للبيانات الحديثة فقط
 *   - high-frequency: تحسين الأداء للمراقبة عالية التردد
 *   - clear(hostname): مسح مضيف في قائمة الإلغاء المتسلسل
 *
 * الاستخدام:
 *   import { DriftDetector } from "./drift-detector.mjs";
 *   det.observe("site.example", { chars: 40000, links: 120, images: 8, elapsed: 350 });
 *   det.alerts("site.example");   // → [{feature, z, dir, ...}]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ملف أحداث الانجراف الافتراضي */
function defaultDriftPath() {
  return path.resolve(__dirname, "..", "state", "drift_events.jsonl");
}

/** متوسطات متنقلة عبر خوارزمية Welford للتقارب (بدون تخزين بيانات الغرامة) */
class RollingStats {
  constructor(opts = {}) {
    const { window = 20, adaptThreshold = true } = opts;
    this.n = 0;
    this.mean = 0;
    this.m2 = 0;
    this._min = Infinity;
    this._max = -Infinity;
    this._window = window;
    this._recent = [];
    this._adaptThreshold = adaptThreshold;
    this._baselineMean = null;
    this._baselineStd = null;
    this._lastZ = 0;
    this._adaptiveThreshold = 4;
    this._varianceTrend = "stable";
  }

  update(x) {
    this.n += 1;
    const delta = x - this.mean;
    this.mean += delta / this.n;
    this.m2 += delta * (x - this.mean);
    this._min = Math.min(this._min, x);
    this._max = Math.max(this._max, x);
    this._recent.push(x);
    if (this._recent.length > this._window) this._recent.shift();
    if (this.n === this._window) {
      this._baselineMean = this.mean;
      this._baselineStd = this.std;
      this._adaptiveThreshold = 4;
    }
    if (this._adaptThreshold && this.n > this._window) {
      const recentVar = this.m2 / Math.max(1, this.n - 1);
      const baselineVar = this._baselineStd ** 2 || 1;
      const ratio = recentVar / Math.max(1, baselineVar);
      if (ratio > 1.5) {
        this._adaptiveThreshold = Math.min(8, this._adaptiveThreshold + 0.5);
        this._varianceTrend = "increasing";
      } else if (ratio < 0.5) {
        this._adaptiveThreshold = Math.max(2, this._adaptiveThreshold - 0.5);
        this._varianceTrend = "decreasing";
      } else {
        this._varianceTrend = "stable";
      }
    }
  }

  get std() {
    return this.n < 2 ? 0 : Math.sqrt(this.m2 / (this.n - 1));
  }

  get variance() {
    return this.std ** 2;
  }

  /** z الخاص بالعينة الأخيرة مقارنة بخط الأساس (null قبل بلوغ النافذة) */
  z(x) {
    if (this._baselineMean == null || this._baselineStd === 0) return null;
    return (x - this._baselineMean) / this._baselineStd;
  }

  /** z باستخدام threshold التكيفي (agility) */
  adaptiveZ(x) {
    const baseZ = this.z(x);
    if (baseZ == null) return null;
    return baseZ * (this._adaptiveThreshold / 4);
  }

  toJSON() {
    return { n: this.n, mean: this.mean, std: this.std, min: this._min, max: this._max, adaptiveThreshold: this._adaptiveThreshold };
  }
}

/** نافذة منزاحة للبيانات الحديثة (Agility Option) */
class SlidingWindowStats {
  constructor(window = 20) {
    this._window = window;
    this._recent = [];
    this._mean = 0;
    this._m2 = 0;
  }
  update(x) {
    if (this._recent.length >= this._window) {
      const old = this._recent.shift();
      this._mean -= old / this._window;
      this._m2 -= old * (old - this._mean);
    }
    this._recent.push(x);
    this._mean += (x - this._mean) / this._recent.length;
    this._m2 += (x - this._mean) * (x - this._mean);
  }
  get std() {
    return this._recent.length < 2 ? 0 : Math.sqrt(this._m2 / (this._recent.length - 1));
  }
  get variance() {
    return this.std ** 2;
  }
}

/**
 * DriftDetector — يراقب استجابات المضيفين على ميزات رقمية ويُبلاغ بانحرافها.
 */
export class DriftDetector {
  /**
   * @param {object} [opts]
   * @param {string} [opts.driftPath] - ملف JSONL لأحداث الانجراف (اختياري)
   * @param {string[]} [opts.features] - أسماء الميزات المراقبة
   * @param {number} [opts.threshold=4]  - حد |z| للإنذار (الثابت)
   * @param {number} [opts.minSamples=10] - حد أدنى من العينات قبل الإنذار
   * @param {boolean} [opts.adaptThreshold=true] - تكييف threshold بناءً على التباين
   * @param {number} [opts.weightChars=1] - وزن خاص لميزة chars (1.0 = أولوية عالية)
   * @param {number} [opts.weightLinks=1] - وزن لميزة links
   * @param {number} [opts.weightImages=1] - وزن لميزة images
   * @param {number} [opts.weightElapsed=1] - وزن لميزة elapsed
   * @param {number} [opts.weightStatus=1] - وزن لميزة status
   */
  constructor(opts = {}) {
    this._features = opts.features ?? ["chars", "links", "images", "elapsed", "status"];
    this._staticThreshold = opts.threshold ?? 4;
    this._adaptThreshold = opts.adaptThreshold ?? true;
    this._minSamples = opts.minSamples ?? 10;
    this._weights = {
      chars: opts.weightChars ?? 1,
      links: opts.weightLinks ?? 1,
      images: opts.weightImages ?? 1,
      elapsed: opts.weightElapsed ?? 1,
      status: opts.weightStatus ?? 1,
    };
    this._path = opts.driftPath || defaultDriftPath();
    this._hosts = new Map();
    this._events = new Map();
    this._driftLogCount = 0;
  }

  /** تُسجّل استجابةً جديداً لمضيف على شكل ميزات رقمية. */
  observe(hostname, features = {}) {
    const stats = this._hosts.get(hostname) ?? new Map();
    const alerts = [];

    for (const f of this._features) {
      const x = features[f];
      if (x == null || Number.isNaN(Number(x))) continue;
      let stat = stats.get(f);
      if (!stat) {
        stat = new RollingStats({ adaptThreshold: this._adaptThreshold });
        stats.set(f, stat);
      }
      stat.update(Number(x));
      const weight = this._weights[f] || 1;
      const z = stat.adaptiveZ(Number(x) * weight);
      if (z != null && Math.abs(z) >= this._staticThreshold && stat.n >= this._minSamples) {
        alerts.push({ feature: f, z: Math.round(z * 100) / 100, direction: z > 0 ? "up" : "down", weight });
      }
    }

    this._hosts.set(hostname, stats);
    if (alerts.length) this._events.set(hostname, alerts);
    return alerts;
  }

  /** أعيد الحصيلة المجمعة للمضيف. */
  stats(hostname) {
    const stats = this._hosts.get(hostname);
    if (!stats) return null;
    const out = {};
    for (const [f, stat] of stats) out[f] = stat.toJSON();
    return out;
  }

  /** إنذارات المضيف الحالية. */
  alerts(hostname) {
    return this._events.get(hostname) ?? [];
  }

  /** المضيفون الذين عليهم إنذار إنجراف الآن. */
  driftingHosts() {
    return [...this._events.keys()];
  }

  /** كتابة حدث الإنجراف في ملف JSONL (سجل اختياري). */
  logDrift(hostname) {
    const alerts = this.alerts(hostname);
    if (!alerts.length) return null;
    const record = {
      at: new Date().toISOString(),
      host: hostname,
      alerts,
      stats: this.stats(hostname),
      drift_path: this._path,
    };
    fs.mkdirSync(path.dirname(this._path), { recursive: true });
    fs.appendFileSync(this._path, JSON.stringify(record) + "\n", "utf8");
    this._driftLogCount++;
    return record;
  }

  /** مسح سجلّات مضيف (يُستخدم في الإلغاء المتسلسل — cascade revocation). */
  clear(hostname) {
    this._hosts.delete(hostname);
    this._events.delete(hostname);
    console.info(`[cascade] Revoked host trust: ${hostname}`);
  }

  /** إعادة تعيين كامل للمراقب. */
  reset() {
    this._hosts.clear();
    this._events.clear();
    this._driftLogCount = 0;
  }

  /** الحصول على إحصائيات التجميع لجميع المضيفين. */
  summary() {
    const result = {};
    for (const [hostname, hostStats] of this._hosts) {
      result[hostname] = this.stats(hostname);
    }
    return result;
  }
}

export const DEFAULT_DRIFT_PATH = defaultDriftPath();
export default { DriftDetector, DEFAULT_DRIFT_PATH, RollingStats, SlidingWindowStats };
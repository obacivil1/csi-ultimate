/**
 * ============================================================
 *  CSI-Ultimate — Rate Limiter & Anti-Ban Protection
 *  Stage 5: Smart Protection — حماية ذكية من الحظر
 *  core/rate-limiter.mjs
 * ============================================================
 *
 *  لماذا؟
 *  -------
 *  الـ crawler يطلب مئات الصفحات — بدون تحكم في المعدل
 *  الموقع سيحجب الـ IP. هذا الملف يحل المشكلة.
 *
 *  الميزات:
 *  ---------
 *  ① AdaptiveRateLimiter : يضبط التأخير تلقائياً حسب استجابة الموقع
 *  ② RetryHandler        : إعادة المحاولة بـ exponential backoff
 *  ③ BanDetector         : يكشف علامات الحظر (429, CAPTCHA, إلخ)
 *  ④ RequestThrottle     : تحديد معدل الطلبات لكل دومين
 */

import { rateLimit as RL, circuitBreaker as CB } from "../config/index.mjs";

// ============================================================
//  BanDetector — كشف علامات الحظر (المصدر الموحّد: ban-detector)
// ============================================================

export { detectBan } from "./ban-detector.mjs";

// ============================================================
//  CircuitBreaker — قاطع دائرة على مستوى المضيف
//  يوقف المضيف وحده بعد عدد حجب متتالٍ، وألا يرفع تأخير بقية
//  المضيفات (عزل زمني — Bulkhead). يرجّع نصف-مفتوح تلقائياً
//  بعد الهدوء ويسمح بطلبات استكشاف محدودة.
// ============================================================

export class CircuitBreaker {
  constructor(opts = {}) {
    this._threshold  = opts.tripThreshold       ?? CB.tripThreshold;
    this._windowMs   = opts.windowMs            ?? CB.windowMs;
    this._cooldownMs = opts.cooldownMs          ?? CB.cooldownMs;
    this._halfProbes = opts.halfOpenProbeLimit  ?? CB.halfOpenProbeLimit;
    this._hosts      = new Map(); // hostname → state
  }

  _state(hostname) {
    let s = this._hosts.get(hostname);
    if (!s) {
      s = { failCount: 0, openUntil: 0, probeBudget: 0, lastKind: null };
      this._hosts.set(hostname, s);
    }
    return s;
  }

  /** سجّل نجاح — يشفّي المضيف */
  onSuccess(hostname) {
    const s = this._hosts.get(hostname);
    if (!s) return;
    s.failCount = 0;
    s.openUntil = 0;
    s.probeBudget = 0;
    s.lastKind = null;
  }

  /** سجّل فشل/حجب — يعدّ حتى القفل، ولا يمر قبل انقضاء windowMs */
  onFailure(hostname, kind = null, at = Date.now()) {
    const s = this._state(hostname);
    // نصف-مفتوح: فشل استكشاف يعيد القفل فوراً
    if (s.openUntil > 0 && at >= s.openUntil) {
      s.openUntil = at + this._cooldownMs;
      s.probeBudget = this._halfProbes;
      s.failCount = this._threshold;
      s.lastKind = kind;
      return;
    }
    s.lastKind = kind;
    s.failCount += 1;
    if (s.failCount >= this._threshold) {
      s.openUntil = at + this._cooldownMs;
      s.probeBudget = this._halfProbes;
    }
  }

  /** هل يمر الطلب الآن؟ */
  canRequestNow(hostname, at = Date.now()) {
    const s = this._hosts.get(hostname);
    if (!s) return true;
    if (at < s.openUntil) return false;            // open — محجوب
    if (s.failCount < this._threshold) return true; // لم يُفتح بعد
    // half-open — يُسمح بعدد استكشاف محدود
    if (s.probeBudget > 0) {
      s.probeBudget -= 1;
      return true;
    }
    return false;
  }

  /** حالة المضيف الكمية */
  status(hostname, at = Date.now()) {
    const s = this._hosts.get(hostname);
    if (!s) return "closed";
    if (at < s.openUntil) return "open";
    if (s.failCount >= this._threshold) return "half_open";
    return "closed";
  }

  reset(hostname) {
    this._hosts.delete(hostname);
  }

  snapshot() {
    const out = {};
    for (const [h, s] of this._hosts) {
      out[h] = { failCount: s.failCount, status: this.status(h), lastKind: s.lastKind };
    }
    return out;
  }
}

// ============================================================
//  HostLimiters — عزل المحددات على مستوى المضيف
//  (مثيل AdaptiveRateLimiter لكل hostname بدل محدِّد عالمي)
// ============================================================

const HOST_LIMITERS = new Map();
const DEFAULT_HOST = "*";

export function getHostLimiter(hostname = DEFAULT_HOST) {
  const key = hostname || DEFAULT_HOST;
  if (!HOST_LIMITERS.has(key)) {
    HOST_LIMITERS.set(key, new AdaptiveRateLimiter({
      minDelay:  RL.minDelayMs,
      maxDelay:  RL.maxDelayMs,
      baseDelay: RL.baseDelayMs,
    }));
  }
  return HOST_LIMITERS.get(key);
}

/** انتظر حسب المضيف المعزول */
export async function waitForHost(hostname) {
  await getHostLimiter(hostname).wait();
}

/**
 * سجل نتيجة لجلسة مضيف: يحدّث المحدد المعزول + قاطع الدائرة.
 * @param {string} hostname
 * @param {boolean} ok
 * @param {string} [kind] - نوع الحظر (من ban-detector)
 */
export function reportHostResult(hostname, ok, kind = null) {
  const limiter = getHostLimiter(hostname);
  if (ok) limiter.onSuccess();
  else limiter.onError(Boolean(kind));
  const breaker = getCircuitBreaker();
  if (ok) breaker.onSuccess(hostname);
  else breaker.onFailure(hostname, kind);
}

let _circuitBreaker = null;
export function getCircuitBreaker() {
  if (!_circuitBreaker) _circuitBreaker = new CircuitBreaker();
  return _circuitBreaker;
}

// ============================================================
//  AdaptiveRateLimiter — معدل تكيّفي
// ============================================================

export class AdaptiveRateLimiter {
  /**
   * @param {object} opts
   * @param {number} [opts.minDelay]        - أقل تأخير (ms) — default 500
   * @param {number} [opts.maxDelay]        - أكبر تأخير (ms) — default 8000
   * @param {number} [opts.baseDelay]       - التأخير الابتدائي — default 1500
   * @param {number} [opts.backoffFactor]   - معامل التضاعف عند الخطأ — default 2
   * @param {number} [opts.recoveryFactor]  - معامل التعافي عند النجاح — default 0.9
   * @param {number} [opts.errorThreshold]  - عدد الأخطاء قبل رفع التأخير — default 3
   */
  constructor(opts = {}) {
    this._min      = opts.minDelay       ?? RL.minDelayMs;
    this._max      = opts.maxDelay       ?? RL.maxDelayMs;
    this._current  = opts.baseDelay      ?? RL.baseDelayMs;
    this._backoff  = opts.backoffFactor  ?? RL.backoffFactor;
    this._recovery = opts.recoveryFactor ?? RL.recoveryFactor;
    this._errThres = opts.errorThreshold ?? RL.errorThreshold;

    this._errorCount   = 0;
    this._successCount = 0;
    this._totalWait    = 0;
    this._calls        = 0;
    this._lastCall     = 0;
  }

  /** انتظر التأخير المناسب ثم سجّل الطلب */
  async wait() {
    const now     = Date.now();
    const elapsed = now - this._lastCall;
    const toWait  = Math.max(0, this._current - elapsed);

    if (toWait > 0) await new Promise(r => setTimeout(r, toWait));

    this._lastCall   = Date.now();
    this._totalWait += toWait;
    this._calls++;
  }

  /** سجّل نجاح — يخفف التأخير */
  onSuccess() {
    this._errorCount = 0;
    this._successCount++;
    this._current = Math.max(
      this._min,
      Math.round(this._current * this._recovery)
    );
  }

  /** سجّل خطأ — يرفع التأخير */
  onError(isBan = false) {
    this._errorCount++;
    this._successCount = 0;

    const factor = isBan ? this._backoff * 2 : this._backoff;
    this._current = Math.min(
      this._max,
      Math.round(this._current * factor)
    );

    if (isBan) {
      console.warn(`  🚫 Ban detected! تأخير رُفع إلى ${this._current}ms`);
    } else if (this._errorCount >= this._errThres) {
      console.warn(`  ⚠️  ${this._errorCount} أخطاء متتالية — تأخير: ${this._current}ms`);
    }
  }

  /** إحصائيات */
  stats() {
    return {
      currentDelay:  this._current,
      totalCalls:    this._calls,
      totalWaitMs:   this._totalWait,
      avgWaitMs:     this._calls > 0 ? Math.round(this._totalWait / this._calls) : 0,
      errorCount:    this._errorCount,
      successCount:  this._successCount,
    };
  }

  /** إعادة ضبط */
  reset() {
    this._errorCount   = 0;
    this._successCount = 0;
    this._totalWait    = 0;
    this._calls        = 0;
    this._lastCall     = 0;
    this._current      = 1500;
  }
}

// ============================================================
//  RetryHandler — إعادة المحاولة بـ exponential backoff
// ============================================================

export class RetryHandler {
  /**
   * @param {object} opts
   * @param {number} [opts.maxRetries]   — default 3
   * @param {number} [opts.baseDelay]    — ms — default 2000
   * @param {number} [opts.backoff]      — default 2
   * @param {number} [opts.maxDelay]     — ms — default 30000
   */
  constructor(opts = {}) {
    this._max      = opts.maxRetries ?? RL.maxRetries;
    this._base     = opts.baseDelay  ?? 2000;
    this._backoff  = opts.backoff    ?? 2;
    this._maxDelay = opts.maxDelay   ?? 30000;

    this._totalRetries = 0;
    this._totalFails   = 0;
  }

  /**
   * ينفذ دالة مع إعادة المحاولة
   * @template T
   * @param {() => Promise<T>} fn
   * @param {string} [label] — اسم للـ logging
   * @returns {Promise<T|null>}
   */
  async run(fn, label = "operation") {
    let attempt = 0;
    let lastErr  = null;

    while (attempt <= this._max) {
      try {
        const result = await fn();
        if (attempt > 0) {
          console.log(`  ✅ ${label}: نجح في المحاولة ${attempt + 1}`);
        }
        return result;
      } catch (err) {
        lastErr = err;
        attempt++;
        this._totalRetries++;

        if (attempt > this._max) break;

        const waitMs = Math.min(
          this._maxDelay,
          this._base * Math.pow(this._backoff, attempt - 1)
        );

        // إضافة jitter لتجنب thundering herd
        const jitter  = Math.random() * waitMs * 0.2;
        const finalMs = Math.round(waitMs + jitter);

        console.warn(`  🔄 ${label}: فشل (${err.message?.slice(0, 50)}) — إعادة بعد ${finalMs}ms [${attempt}/${this._max}]`);
        await new Promise(r => setTimeout(r, finalMs));
      }
    }

    this._totalFails++;
    console.error(`  ❌ ${label}: فشل نهائياً بعد ${this._max} محاولات — ${lastErr?.message}`);
    return null;
  }

  stats() {
    return {
      totalRetries: this._totalRetries,
      totalFails:   this._totalFails,
    };
  }
}

// ============================================================
//  RequestThrottle — تحديد معدل الطلبات لكل دومين
// ============================================================

export class RequestThrottle {
  /**
   * @param {number} [requestsPerMinute] — default 20
   */
  constructor(requestsPerMinute = 20) {
    this._rpm      = requestsPerMinute;
    this._interval = 60000 / requestsPerMinute; // ms بين كل طلب
    this._queues   = new Map(); // domain → lastCallTime
  }

  /**
   * ينتظر الوقت اللازم ثم يسمح بالطلب
   * @param {string} domain
   */
  async throttle(domain) {
    const last    = this._queues.get(domain) ?? 0;
    const now     = Date.now();
    const elapsed = now - last;
    const toWait  = Math.max(0, this._interval - elapsed);

    if (toWait > 0) {
      await new Promise(r => setTimeout(r, toWait));
    }

    this._queues.set(domain, Date.now());
  }

  /** استخرج الدومين من URL */
  domainOf(url) {
    try { return new URL(url).hostname; }
    catch { return url; }
  }

  /** ينتظر حسب الدومين */
  async waitFor(url) {
    await this.throttle(this.domainOf(url));
  }
}

// ============================================================
//  مثيلات عالمية جاهزة للاستخدام
// ============================================================

export const rateLimiter = new AdaptiveRateLimiter({
  minDelay:    RL.minDelayMs,
  maxDelay:    RL.maxDelayMs,
  baseDelay:   RL.baseDelayMs,
});

export const retryHandler = new RetryHandler({
  maxRetries: RL.maxRetries,
  baseDelay:  2000,
});

export const throttle = new RequestThrottle(RL.requestsPerMinute); // req/min

// قاطع الدائرة المعلّق العام (يُنشأ عند أول استخدام)
export const circuitBreaker = getCircuitBreaker();

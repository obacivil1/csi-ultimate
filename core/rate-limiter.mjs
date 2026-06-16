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

// ============================================================
//  BanDetector — كشف علامات الحظر
// ============================================================

const BAN_PATTERNS = [
  /captcha/i,
  /are you a robot/i,
  /rate.?limit/i,
  /too many requests/i,
  /access denied/i,
  /blocked/i,
  /cf-error/i,          // Cloudflare
  /ddos.?guard/i,
  /please wait/i,
  /verify you are human/i,
  /unusual traffic/i,
];

/**
 * يفحص الـ HTML أو HTTP status ويحدد إذا كان الـ IP محظور
 * @param {number} statusCode
 * @param {string} [html]
 * @returns {{ banned: boolean, reason: string }}
 */
export function detectBan(statusCode, html = "") {
  // HTTP status codes للحظر
  if (statusCode === 429) return { banned: true, reason: "429 Too Many Requests" };
  if (statusCode === 403) return { banned: true, reason: "403 Forbidden"         };
  if (statusCode === 503) return { banned: true, reason: "503 Service Unavailable" };

  // فحص محتوى الصفحة
  for (const pattern of BAN_PATTERNS) {
    if (pattern.test(html)) {
      return { banned: true, reason: `محتوى يشير إلى حجب: ${pattern}` };
    }
  }

  return { banned: false, reason: "" };
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
    this._min      = opts.minDelay       ?? 500;
    this._max      = opts.maxDelay       ?? 8000;
    this._current  = opts.baseDelay      ?? 1500;
    this._backoff  = opts.backoffFactor  ?? 2;
    this._recovery = opts.recoveryFactor ?? 0.9;
    this._errThres = opts.errorThreshold ?? 3;

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
    this._max      = opts.maxRetries ?? 3;
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
  minDelay:    800,
  maxDelay:    5000,
  baseDelay:   1500,
});

export const retryHandler = new RetryHandler({
  maxRetries: 3,
  baseDelay:  2000,
});

export const throttle = new RequestThrottle(15); // 15 req/min

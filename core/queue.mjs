/**
 * ============================================================
 *  CSI-Ultimate — WorkerQueue
 *  طابور العمال: تحكم بالتزامن + إعادة المحاولة + التتبع
 *  Stage 2A — core/queue.mjs
 * ============================================================
 *
 *  لماذا؟
 *  -------
 *  processBatch() في v4 يستخدم Promise.allSettled() مع delay بسيط.
 *  هذا لا يتحكم في التزامن الحقيقي (قد يفتح 3 tabs في نفس اللحظة
 *  بدلاً من تشغيل الـ 3 باستمرار دون انقطاع).
 *  WorkerQueue يُشغّل W عمال دائمين يسحبون من الطابور.
 *
 *  الميزات:
 *  ---------
 *  - تزامن ثابت: W عمال دائماً مشغولون (ما دام هناك عمل).
 *  - إعادة المحاولة: maxRetries مع exponential backoff.
 *  - أحداث: onSuccess / onFailure / onProgress.
 *  - drain(): يُكمل كل العمل المعلّق ثم يحل.
 *  - pause() / resume(): لإيقاف التدفق مؤقتاً.
 *  - stats: نسبة الإنجاز، عداد النجاح/الفشل.
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Exponential backoff مع jitter ──────────────────────────────
function backoff(attempt, base = 800, cap = 15_000) {
  const exp   = Math.min(base * 2 ** attempt, cap);
  const jitter = exp * 0.25 * Math.random();
  return exp + jitter;
}

// ============================================================
//  WorkerQueue
// ============================================================

export class WorkerQueue {
  /**
   * @param {object} opts
   * @param {number}   opts.concurrency  - عدد العمال المتوازيين (افتراضي: 4)
   * @param {number}   opts.maxRetries   - أقصى محاولات قبل الفشل النهائي (3)
   * @param {number}   opts.retryBase    - ms أساس الانتظار بين المحاولات (800)
   * @param {Function} [opts.onSuccess]  - callback(result, item, idx)
   * @param {Function} [opts.onFailure]  - callback(error, item, idx)
   * @param {Function} [opts.onProgress] - callback(stats)
   * @param {number}   [opts.minDelay]   - ms حد أدنى بين عمليات نفس العامل (0)
   */
  constructor(opts = {}) {
    this._concurrency  = opts.concurrency  ?? 4;
    this._maxRetries   = opts.maxRetries   ?? 3;
    this._retryBase    = opts.retryBase    ?? 800;
    this._minDelay     = opts.minDelay     ?? 0;
    this._onSuccess    = opts.onSuccess    ?? null;
    this._onFailure    = opts.onFailure    ?? null;
    this._onProgress   = opts.onProgress   ?? null;

    /** @type {Array<{item, idx, resolve, reject, attempts}>} */
    this._queue        = [];
    this._activeCount  = 0;
    this._paused       = false;

    this._stats = {
      total:     0,
      done:      0,
      succeeded: 0,
      failed:    0,
    };

    /** resolve الخاصة بـ drain() */
    this._drainResolvers = [];
  }

  // ── إضافة عنصر للطابور ────────────────────────────────────────
  /**
   * @param {*}      item - البيانات المُمرّرة للـ worker (URL مثلاً)
   * @param {number} [idx] - رقم مرجعي اختياري
   * @returns {Promise<*>} يحل بنتيجة worker أو يرفض بعد استنفاد المحاولات
   */
  push(item, idx) {
    this._stats.total++;
    const taskIdx = idx ?? this._stats.total;

    return new Promise((resolve, reject) => {
      this._queue.push({ item, idx: taskIdx, resolve, reject, attempts: 0 });
      this._tick();
    });
  }

  // ── إضافة دُفعة ───────────────────────────────────────────────
  /**
   * @param {Array}    items
   * @param {Function} workerFn - async (item, idx) => result
   * @returns {Promise<Array<{status, value?, reason?, item, idx}>>}
   */
  async pushAll(items, workerFn) {
    if (typeof workerFn !== "function") {
      throw new Error("[Queue] workerFn must be a function");
    }
    this._workerFn = workerFn;
    const promises = items.map((item, i) => this.push(item, i));
    return Promise.allSettled(promises);
  }

  // ── تعيين دالة العمل ──────────────────────────────────────────
  setWorker(fn) { this._workerFn = fn; return this; }

  // ── إيقاف / استئناف ───────────────────────────────────────────
  pause()  { this._paused = true;  }
  resume() { this._paused = false; this._tick(); }

  // ── انتظر إتمام كل العمل ──────────────────────────────────────
  /**
   * @returns {Promise<void>} يحل عندما تكون الـ queue فارغة والعمال خاملين
   */
  drain() {
    if (this._isDrained()) return Promise.resolve();
    return new Promise(resolve => this._drainResolvers.push(resolve));
  }

  // ── الإحصاءات الحالية ─────────────────────────────────────────
  stats() {
    return {
      ...this._stats,
      active:  this._activeCount,
      queued:  this._queue.length,
      percent: this._stats.total > 0
        ? Math.round((this._stats.done / this._stats.total) * 100)
        : 0,
    };
  }

  // ── خاص: هل انتهى العمل؟ ──────────────────────────────────────
  _isDrained() {
    return this._queue.length === 0 && this._activeCount === 0;
  }

  // ── خاص: أيقظ عمالاً جدداً ────────────────────────────────────
  _tick() {
    while (
      !this._paused &&
      this._activeCount < this._concurrency &&
      this._queue.length > 0
    ) {
      const task = this._queue.shift();
      this._activeCount++;
      this._runTask(task);
    }
  }

  // ── خاص: تشغيل مهمة واحدة مع retry ──────────────────────────
  async _runTask(task) {
    const { item, idx, resolve, reject } = task;

    if (typeof this._workerFn !== "function") {
      this._activeCount--;
      this._tick();
      reject(new Error("[Queue] workerFn not set"));
      return;
    }

    while (task.attempts <= this._maxRetries) {
      try {
        if (this._minDelay > 0 && task.attempts === 0) {
          await sleep(this._minDelay);
        }

        const result = await this._workerFn(item, idx);

        this._stats.succeeded++;
        this._stats.done++;
        this._onSuccess?.(result, item, idx);
        this._onProgress?.(this.stats());
        resolve(result);
        break;

      } catch (err) {
        task.attempts++;

        if (task.attempts > this._maxRetries) {
          // فشل نهائي
          this._stats.failed++;
          this._stats.done++;
          this._onFailure?.(err, item, idx);
          this._onProgress?.(this.stats());
          reject(err);
          break;
        }

        // إعادة المحاولة بعد backoff
        const wait = backoff(task.attempts - 1, this._retryBase);
        console.warn(
          `[Queue] ⚠️  محاولة ${task.attempts}/${this._maxRetries + 1}` +
          ` — idx=${idx} — انتظار ${Math.round(wait)}ms` +
          ` — ${err.message?.slice(0, 60)}`
        );
        await sleep(wait);
      }
    }

    this._activeCount = Math.max(0, this._activeCount - 1);
    this._tick();

    // تحقق من drain
    if (this._isDrained()) {
      this._drainResolvers.forEach(r => r());
      this._drainResolvers = [];
    }
  }
}

// ── مساعد سريع: شغّل items متوازياً بدون إنشاء queue صريح ──────
/**
 * @param {Array}    items
 * @param {Function} workerFn     - async (item, idx) => result
 * @param {object}   [opts]       - خيارات WorkerQueue
 * @returns {Promise<Array<PromiseSettledResult>>}
 */
export async function runParallel(items, workerFn, opts = {}) {
  const q = new WorkerQueue(opts);
  q.setWorker(workerFn);
  const results = await q.pushAll(items, workerFn);
  await q.drain();
  return results;
}

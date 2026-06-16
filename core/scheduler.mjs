/**
 * ============================================================
 *  CSI-Ultimate — Crawl Scheduler
 *  Stage 4: جدولة تلقائية للـ crawling
 *  core/scheduler.mjs
 * ============================================================
 *
 *  يتيح:
 *  ─ تشغيل jobs بفترات زمنية (كل X دقيقة/ساعة)
 *  ─ قائمة انتظار للـ jobs المتعددة
 *  ─ حفظ/استعادة حالة الـ jobs (state/scheduler.json)
 *  ─ تحديد أوقات التشغيل (ساعات العمل)
 * ============================================================
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

mkdirSync("./state", { recursive: true });
const STATE_FILE = "./state/scheduler.json";

// ============================================================
//  هياكل البيانات
// ============================================================

/**
 * @typedef {object} ScheduledJob
 * @property {string}   id          - معرّف فريد
 * @property {string}   type        - "category" | "keyword" | "walk"
 * @property {string}   target      - URL الفئة أو الكلمة المفتاحية
 * @property {number}   intervalMs  - الفترة بالمللي ثانية
 * @property {number}   nextRunAt   - timestamp التشغيل القادم
 * @property {number}   lastRunAt   - timestamp آخر تشغيل (0 = لم يُشغَّل)
 * @property {number}   runCount    - عدد مرات التشغيل
 * @property {boolean}  enabled     - مفعّل/معطّل
 * @property {object}   [timeWindow] - { startHour, endHour } - ساعات التشغيل
 */

// ============================================================
//  CrawlScheduler
// ============================================================

export class CrawlScheduler {
  constructor() {
    /** @type {Map<string, ScheduledJob>} */
    this._jobs    = new Map();
    this._running = false;
    this._timer   = null;
    this._load();
  }

  // ──────────────────────────────────────────────────
  //  CRUD
  // ──────────────────────────────────────────────────

  /**
   * أضف job جديد
   * @param {object} opts
   * @param {string} opts.id
   * @param {"category"|"keyword"|"walk"} opts.type
   * @param {string} opts.target
   * @param {number} opts.intervalMs   - ms (مثال: 3600000 = ساعة)
   * @param {object} [opts.timeWindow] - { startHour:8, endHour:20 }
   * @returns {ScheduledJob}
   */
  add({ id, type, target, intervalMs, timeWindow = null, enabled = true }) {
    if (!id || !type || !target || !intervalMs) {
      throw new Error("add(): id, type, target, intervalMs مطلوبة");
    }

    const job = {
      id,
      type,
      target,
      intervalMs,
      nextRunAt: Date.now(),  // يشتغل فوراً في أول مرة
      lastRunAt: 0,
      runCount:  0,
      enabled,
      timeWindow,
    };

    this._jobs.set(id, job);
    this._save();
    return job;
  }

  /** عدّل job موجود */
  update(id, changes) {
    const job = this._jobs.get(id);
    if (!job) throw new Error(`Job "${id}" غير موجود`);
    Object.assign(job, changes);
    this._save();
    return job;
  }

  /** احذف job */
  remove(id) {
    const deleted = this._jobs.delete(id);
    this._save();
    return deleted;
  }

  /** أوقف أو فعّل job */
  toggle(id) {
    const job = this._jobs.get(id);
    if (!job) return false;
    job.enabled = !job.enabled;
    this._save();
    return job.enabled;
  }

  /** كل الـ jobs */
  list() {
    return [...this._jobs.values()];
  }

  /** الـ jobs الجاهزة للتشغيل الآن */
  dueJobs() {
    const now = Date.now();
    return [...this._jobs.values()].filter(job => {
      if (!job.enabled) return false;
      if (job.nextRunAt > now) return false;
      if (job.timeWindow) {
        const hour = new Date().getHours();
        if (hour < job.timeWindow.startHour || hour >= job.timeWindow.endHour) return false;
      }
      return true;
    });
  }

  // ──────────────────────────────────────────────────
  //  تشغيل
  // ──────────────────────────────────────────────────

  /**
   * شغّل الـ scheduler
   * @param {function} runner - async (job) => void
   * @param {number}   [tickMs=60000] - كل كم ms يتحقق
   */
  start(runner, tickMs = 60_000) {
    if (this._running) return;
    this._running = true;
    console.log(`\n⏰ Scheduler بدأ — يتحقق كل ${tickMs / 1000}s`);
    this._tick(runner);
    this._timer = setInterval(() => this._tick(runner), tickMs);
  }

  /** أوقف الـ scheduler */
  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer   = null;
    this._running = false;
    console.log("⏰ Scheduler أوقف");
  }

  /** شغّل job واحد فوراً */
  async runNow(id, runner) {
    const job = this._jobs.get(id);
    if (!job) throw new Error(`Job "${id}" غير موجود`);
    await this._runJob(job, runner);
  }

  // ──────────────────────────────────────────────────
  //  Internal
  // ──────────────────────────────────────────────────

  async _tick(runner) {
    const due = this.dueJobs();
    if (!due.length) return;

    console.log(`\n⏰ Scheduler: ${due.length} job(s) جاهز للتشغيل`);
    for (const job of due) {
      await this._runJob(job, runner);
    }
  }

  async _runJob(job, runner) {
    const startedAt = Date.now();
    console.log(`\n▶️  تشغيل Job "${job.id}" (${job.type}: ${job.target})`);

    try {
      await runner(job);
      job.runCount++;
      job.lastRunAt = startedAt;
      job.nextRunAt = Date.now() + job.intervalMs;
      console.log(
        `✅ Job "${job.id}" اكتمل — ` +
        `التشغيل التالي: ${new Date(job.nextRunAt).toLocaleString("ar")}`
      );
    } catch (err) {
      console.error(`❌ Job "${job.id}" فشل: ${err.message}`);
      // أعد المحاولة بعد 5 دقائق
      job.nextRunAt = Date.now() + 5 * 60_000;
    }

    this._save();
  }

  // ──────────────────────────────────────────────────
  //  State persistence
  // ──────────────────────────────────────────────────

  _save() {
    const data = Object.fromEntries(this._jobs);
    writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf8");
  }

  _load() {
    if (!existsSync(STATE_FILE)) return;
    try {
      const data = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      for (const [id, job] of Object.entries(data)) {
        this._jobs.set(id, job);
      }
      console.log(`[Scheduler] 📂 تحميل ${this._jobs.size} job(s) محفوظ`);
    } catch {
      console.warn("[Scheduler] ⚠️  تعذّر قراءة scheduler.json");
    }
  }

  /** احذف كل الـ jobs */
  reset() {
    this._jobs.clear();
    this._save();
  }

  /** إحصاءات سريعة */
  stats() {
    const jobs     = [...this._jobs.values()];
    const enabled  = jobs.filter(j => j.enabled).length;
    const due      = this.dueJobs().length;
    const totalRuns = jobs.reduce((s, j) => s + j.runCount, 0);
    return { total: jobs.length, enabled, due, totalRuns };
  }
}

// ============================================================
//  مساعد: تحويل وقت إنساني → ms
// ============================================================

export function parseInterval(str) {
  // "30m" → 1800000 | "2h" → 7200000 | "1d" → 86400000
  const match = String(str).match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i);
  if (!match) throw new Error(`parseInterval: صيغة غير صحيحة "${str}" — استخدم مثل "30m" أو "2h"`);
  const val  = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const map  = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Math.round(val * map[unit]);
}

// ============================================================
//  singleton
// ============================================================
export const scheduler = new CrawlScheduler();

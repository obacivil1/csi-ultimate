/**
 * ============================================================
 *  CSI-Ultimate — Session Reporter
 *  Stage 5: Reporting — تقارير إحصائية شاملة
 *  core/reporter.mjs
 * ============================================================
 *
 *  لماذا؟
 *  -------
 *  بعد كل جلسة crawling يجب معرفة:
 *    - كم إعلان جُمع؟
 *    - كم وقت استغرق؟
 *    - ما نسبة النجاح؟
 *    - أين الأخطاء؟
 *    - ما أكثر الفئات إنتاجاً؟
 *
 *  الميزات:
 *  ---------
 *  ① SessionReporter : يتتبع كل أحداث الجلسة
 *  ② يولّد تقرير نصي ملوّن للـ console
 *  ③ يحفظ تقرير JSON للتحليل اللاحق
 *  ④ مقارنة بين الجلسات (trend analysis)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve, dirname }                                                 from "path";

const delay = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
//  تنسيق الأرقام والوقت
// ============================================================

function formatDuration(ms) {
  if (ms < 1000)     return `${ms}ms`;
  if (ms < 60000)    return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000)  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function formatNum(n) {
  return n?.toLocaleString("en-US") ?? "0";
}

function pct(part, total) {
  if (!total) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

// ============================================================
//  SessionReporter
// ============================================================

export class SessionReporter {
  /**
   * @param {object} opts
   * @param {string} [opts.outputDir]   - مجلد حفظ التقارير — default "./output/reports"
   * @param {string} [opts.sessionName] - اسم الجلسة
   */
  constructor(opts = {}) {
    this._dir     = resolve(opts.outputDir ?? "./output/reports");
    this._name    = opts.sessionName ?? `session_${Date.now()}`;
    this._start   = null;
    this._end     = null;

    // إحصائيات
    this._stats = {
      // Discovery
      categoriesFound:    0,
      categoriesWalked:   0,
      keywordsSearched:   0,
      pagesVisited:       0,

      // Discovery
      linksAttempted:     0,        // روابط تم إرسالها للـ scrape
      linksDiscovered:    0,        // روابط مكتشفة قبل الفلترة

      // Ads
      adsFound:           0,        // روابط مجموعة
      adsScraped:         0,        // إعلانات scraped بنجاح
      adsFailed:          0,        // إعلانات فشل scraping
      adsDuplicate:       0,        // مكررة تم تخطيها
      adsCached:          0,        // من الـ cache

      // Performance
      totalRequests:      0,
      cacheHits:          0,
      cacheMisses:        0,
      retries:            0,
      errors:             0,
      bansDetected:       0,

      // Rate Limiting
      totalWaitMs:        0,
      avgDelayMs:         0,

      // Export
      exportedExcel:      false,
      exportedJson:       false,
      exportedCsv:        false,
    };

    // سجل الأحداث
    this._events    = [];
    this._errors    = [];
    this._topCats   = new Map(); // category → count
    this._topKws    = new Map(); // keyword → count

    // مرجع الملف
    this._reportPath = null;
  }

  // ── بدء / إيقاف ──────────────────────────────────────────

  start() {
    this._start = Date.now();
    this._log("info", "🚀 بدأت الجلسة");
    console.log(`\n${"═".repeat(60)}`);
    console.log(`🚀  جلسة جديدة: ${this._name}`);
    console.log(`    ${new Date().toLocaleString()}`);
    console.log("═".repeat(60));
  }

  end() {
    this._end = Date.now();
    this._log("info", "✅ انتهت الجلسة");
  }

  // ── تحديث الإحصائيات ─────────────────────────────────────

  inc(key, amount = 1) {
    if (key in this._stats) this._stats[key] += amount;
  }

  set(key, value) {
    if (key in this._stats) this._stats[key] = value;
  }

  /** سجّل نتيجة فئة */
  recordCategory(catName, adsFound) {
    this._stats.categoriesWalked++;
    this._stats.adsFound += adsFound;
    const prev = this._topCats.get(catName) ?? 0;
    this._topCats.set(catName, prev + adsFound);
    this._log("category", `📂 ${catName}: ${adsFound} إعلان`);
  }

  /** سجّل نتيجة بحث */
  recordKeyword(keyword, adsFound) {
    this._stats.keywordsSearched++;
    this._stats.adsFound += adsFound;
    const prev = this._topKws.get(keyword) ?? 0;
    this._topKws.set(keyword, prev + adsFound);
    this._log("keyword", `🔍 "${keyword}": ${adsFound} إعلان`);
  }

  /** سجّل خطأ */
  recordError(context, err) {
    this._stats.errors++;
    const msg = err?.message ?? String(err);
    this._errors.push({ time: Date.now(), context, msg });
    this._log("error", `❌ ${context}: ${msg.slice(0, 100)}`);
  }

  /** سجّل حظر */
  recordBan(url) {
    this._stats.bansDetected++;
    this._log("ban", `🚫 حظر محتمل: ${url}`);
  }

  // ── الـ log الداخلي ───────────────────────────────────────

  _log(type, msg) {
    this._events.push({ t: Date.now(), type, msg });
  }

  // ── حساب المدة ───────────────────────────────────────────

  get duration() {
    const end = this._end ?? Date.now();
    return this._start ? end - this._start : 0;
  }

  // ── إنشاء التقرير ─────────────────────────────────────────

  /**
   * يطبع تقرير ملوّن في الـ console
   */
  printSummary() {
    const dur  = this.duration;
    const s    = this._stats;
    const line = "═".repeat(60);

    console.log(`\n${line}`);
    console.log("📊  ملخص الجلسة");
    console.log(`    ${this._name}`);
    console.log(`    مدة: ${formatDuration(dur)}`);
    console.log(line);

    // الاكتشاف
    console.log("\n📂  الاكتشاف:");
    console.log(`    فئات مكتشفة  : ${formatNum(s.categoriesFound)}`);
    console.log(`    فئات معالجة  : ${formatNum(s.categoriesWalked)}`);
    console.log(`    بحث كلمات    : ${formatNum(s.keywordsSearched)}`);
    console.log(`    صفحات زُرت   : ${formatNum(s.pagesVisited)}`);

    // الإعلانات
    const attempted = s.linksAttempted || s.adsScraped + s.adsFailed;
    console.log("\n📋  الإعلانات:");
    console.log(`    روابط مجموعة : ${formatNum(s.adsFound)}`);
    console.log(`    Scraped ✅   : ${formatNum(s.adsScraped)}`);
    console.log(`    فشل ❌       : ${formatNum(s.adsFailed)}`);
    console.log(`    مكررة ⏭️     : ${formatNum(s.adsDuplicate)}`);
    console.log(`    من Cache 📦  : ${formatNum(s.adsCached)}`);
    if (attempted > 0) {
      console.log(`    دقة الاستخراج: ${pct(s.adsScraped, attempted)}`);
    }
    if (s.adsScraped + s.adsFailed > 0) {
      console.log(`    نسبة نجاح scrape: ${pct(s.adsScraped, s.adsScraped + s.adsFailed)}`);
    }

    // الأداء
    console.log("\n⚡  الأداء:");
    console.log(`    طلبات كلية   : ${formatNum(s.totalRequests)}`);
    console.log(`    Cache hits   : ${formatNum(s.cacheHits)} (${pct(s.cacheHits, s.totalRequests)})`);
    console.log(`    إعادة محاولة : ${formatNum(s.retries)}`);
    console.log(`    أخطاء        : ${formatNum(s.errors)}`);
    if (s.bansDetected > 0) {
      console.log(`    حجب محتمل 🚫 : ${formatNum(s.bansDetected)}`);
    }
    if (s.avgDelayMs > 0) {
      console.log(`    متوسط تأخير  : ${formatDuration(s.avgDelayMs)}`);
    }

    // السرعة
    if (dur > 0 && s.adsScraped > 0) {
      const adsPerMin = Math.round((s.adsScraped / dur) * 60000);
      console.log(`    سرعة         : ~${adsPerMin} إعلان/دقيقة`);
    }

    // أفضل الفئات
    if (this._topCats.size > 0) {
      console.log("\n🏆  أفضل الفئات:");
      const sorted = [...this._topCats.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      sorted.forEach(([name, count]) => {
        console.log(`    ${count.toString().padStart(4)} | ${name}`);
      });
    }

    // أفضل الكلمات المفتاحية
    if (this._topKws.size > 0) {
      console.log("\n🔍  أفضل الكلمات:");
      const sorted = [...this._topKws.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      sorted.forEach(([kw, count]) => {
        console.log(`    ${count.toString().padStart(4)} | "${kw}"`);
      });
    }

    // الأخطاء
    if (this._errors.length > 0) {
      console.log(`\n❌  آخر الأخطاء (${this._errors.length}):`);
      this._errors.slice(-3).forEach(e => {
        console.log(`    • ${e.context}: ${e.msg.slice(0, 60)}`);
      });
    }

    // التصدير
    console.log("\n💾  التصدير:");
    console.log(`    Excel  : ${s.exportedExcel ? "✅" : "—"}`);
    console.log(`    JSON   : ${s.exportedJson  ? "✅" : "—"}`);
    console.log(`    CSV    : ${s.exportedCsv   ? "✅" : "—"}`);

    console.log(`\n${line}\n`);
  }

  /**
   * يحفظ تقرير JSON
   * @returns {string} مسار الملف
   */
  saveReport() {
    mkdirSync(this._dir, { recursive: true });

    const report = {
      session:     this._name,
      startTime:   this._start ? new Date(this._start).toISOString() : null,
      endTime:     this._end   ? new Date(this._end).toISOString()   : null,
      duration:    this.duration,
      durationStr: formatDuration(this.duration),
      stats:       this._stats,
      topCategories: Object.fromEntries(
        [...this._topCats.entries()].sort((a, b) => b[1] - a[1])
      ),
      topKeywords: Object.fromEntries(
        [...this._topKws.entries()].sort((a, b) => b[1] - a[1])
      ),
      errors:      this._errors,
      events:      this._events.slice(-100), // آخر 100 حدث
    };

    const filename = `${this._name.replace(/[^a-zA-Z0-9_-]/g, "_")}_${Date.now()}.json`;
    this._reportPath = resolve(this._dir, filename);
    writeFileSync(this._reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`💾 تقرير محفوظ: ${this._reportPath}`);

    return this._reportPath;
  }

  /**
   * يقرأ آخر تقرير محفوظ
   */
  static loadLatest(dir = "./output/reports") {
    const absDir = resolve(dir);
    if (!existsSync(absDir)) return null;

    const files = readdirSync(absDir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    try {
      return JSON.parse(readFileSync(resolve(absDir, files[0]), "utf8"));
    } catch { return null; }
  }
}

// ============================================================
//  مثيل عالمي
// ============================================================

export let currentReporter = null;

export function createReporter(name, opts = {}) {
  currentReporter = new SessionReporter({ sessionName: name, ...opts });
  return currentReporter;
}

export function getReporter() {
  if (!currentReporter) {
    currentReporter = new SessionReporter({ sessionName: "default" });
  }
  return currentReporter;
}

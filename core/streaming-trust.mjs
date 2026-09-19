/**
 * streaming-trust.mjs — نبض ثقة مستمر للمضيف (مستوحى من N0VA v3.23 Continuous Behavioral Auth)
 * ────────────────────────────────────────────────────────────────────────────
 * فكرة v3.23 المنقولة (بلا جلسات مستخدم/WebSocket/ONNX):
 *   "لا لحظة ثقة" — أي مضيف يُقيَّم باستمرار: كل استجابة (تغذية anomaly-score من
 *   http-fetch) تحدّث current_trust بحدود صارمة:
 *     - الحسم (decay): الـ score يخفض الثقة تدريجياً، مقيد (لا انهيار فوري).
 *     - التعافي (recovery): عند استقرار طويل القيم المخفضة تُرفع الثقة ببطء شديد.
 *   الإجراءات فورية حسب عتبات (flag → warn، step_up → retry، suspend → backoff،
 *   terminate → pause_host) — الأسماء مألوفة من ban-detector.
 *   التنبؤ (forecast): انحدار خطي بسيط + R² → هل الثقة صاعدة/هابطة بعد horizon؟
 *      (≈ Forecasting في v3.23 — تنبيه مبكر قبل الانهيار).
 *
 * القيم الافتراضية مطابقة لروح v3.23: decay=0.15/عيّنة، recovery=0.02 بعد 30
 * عيّنة مستقرة، عتبات {terminate:0.10, suspend:0.25, step_up:0.50, flag:0.70}.
 */
import path from "node:path";

const THRESHOLDS = [["terminate", 0.10], ["suspend", 0.25], ["step_up", 0.50], ["flag", 0.70]];

/** خريطة قرار→إجراء بمعجم المحرّك الحالي (ban-detector) */
export const ACTION_BY_DECISION = {
  none: "continue",
  flag: "warn",
  step_up: "retry_proxy",
  suspend: "wait_backoff",
  terminate: "pause_host",
};

/** خط انحدار خطي بسيط (intercept, slope, r2) — بلا مكتبات */
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.[1] ?? 0, r2: 1 };
  const meanX = points.reduce((a, p) => a + p[0], 0) / n;
  const meanY = points.reduce((a, p) => a + p[1], 0) / n;
  let num = 0, den = 0;
  for (const [x, y] of points) {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  let ssRes = 0, ssTot = 0;
  for (const [x, y] of points) {
    const pred = slope * x + intercept;
    ssRes += (y - pred) ** 2;
    ssTot += (y - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}

export class StreamingTrust {
  /**
   * @param {object} [opts]
   * @param {number} [opts.decayRate=0.15]    - حسم الثقة لكل عيّنة نسبةً للـ score
   * @param {number} [opts.recoveryRate=0.02] - رفع الثقة عند الاستقرار (مقيد)
   * @param {number} [opts.recoverAfterN=30]  - عدد العيّنات قبل السماح بالتعافي
   * @param {number} [opts.stableMean=0.15]   - متوسط score يُعتبر "مستقراً"
   * @param {number} [opts.window=60]         - نافذة السجلات
   */
  constructor(opts = {}) {
    this._decay = opts.decayRate ?? 0.15;
    this._recovery = opts.recoveryRate ?? 0.02;
    this._recoverAfter = opts.recoverAfterN ?? 30;
    this._stableMean = opts.stableMean ?? 0.15;
    this._window = opts.window ?? 60;

    this._trust = 1.0;
    this._min5m = 1.0;
    this._delta = 0.0;
    this._scores = [];   // آخر scores (أعلى وحشياً أخف)
    this._count = 0;
    this._lastAt = 0;
  }

  /** score شذوذ 0..1 استجابةً مؤسسية (من anomaly-scorer). */
  push(score) {
    const s = Math.max(0, Math.min(1, Number(score) || 0));
    this._scores.push(s);
    if (this._scores.length > this._window) this._scores.shift();
    this._count++;

    const old = this._trust;

    // حسم تدريجي (من pricip الشعب: `combined * 0.15`)
    let next = Math.max(0, old - s * this._decay);

    // تعافٍ بطيء فقط بعد استقرار طويل
    if (s < this._stableMean && this._scores.length >= this._recoverAfter) {
      const last = this._scores.slice(-this._recoverAfter);
      const avg = last.reduce((a, v) => a + v, 0) / last.length;
      if (avg < this._stableMean) next = Math.min(1, next + this._recovery);
    }

    this._trust = Math.round(next * 1000) / 1000;
    this._min5m = Math.min(this._min5m, this._trust);
    this._delta = this._trust - old;
    this._lastAt = Date.now();
    return this._trust;
  }

  /** القرار الحالي حسب الثقة */
  decide() {
    for (const [decision, threshold] of THRESHOLDS) {
      if (this._trust < threshold) return decision;
    }
    return "none";
  }

  /** إجراء المحرّك الحالي للقرار */
  action() {
    return ACTION_BY_DECISION[this.decide()] ?? "continue";
  }

  /**
   * تنبؤ بالثقة بعد horizon عيّنات (انحدار خطي) — إشارة مبكرة.
   * @param {number} [horizon=5]
   * @returns {{score:number, confidence:number, trend:string, slope:number}}
   */
  forecast(horizon = 5) {
    if (this._scores.length < 2) {
      return { score: this._trust, confidence: 0, trend: "stable", slope: 0 };
    }
    const points = this._scores.map((v, i) => [i, v]);
    const { slope, intercept, r2 } = linearRegression(points);
    const predicted = intercept + slope * (points.length + horizon);
    const trend = slope > 0.01 ? "rising" : slope < -0.01 ? "falling" : "stable";
    return {
      score: Math.round(Math.max(0, Math.min(1, predicted)) * 1000) / 1000,
      confidence: Math.round(r2 * 1000) / 1000,
      trend,
      slope: Math.round(slope * 1000) / 1000,
    };
  }

  stats() {
    return {
      trust: this._trust,
      minTrust5m: this._min5m,
      delta: this._delta,
      decision: this.decide(),
      action: this.action(),
      samples: this._count,
      window: this._scores.length,
      lastScore: this._scores.length ? this._scores[this._scores.length - 1] : null,
      forecast: this.forecast(),
    };
  }

  reset() {
    this._trust = 1.0;
    this._min5m = 1.0;
    this._delta = 0.0;
    this._scores = [];
    this._count = 0;
  }
}

/**
 * StreamingTrustHub — نبض ثقة لكل مضيف على حدة (شبيه "جلسات الستريم" لكل مستخدم).
 * http-fetch يغذّيها بكل استجابة؛ أي مضيف ترتفع فيه إشاراته تُتخذ له إجراء مستند
 * إلى سياقه وحده — عزل تام بين المضيفات.
 */
export class StreamingTrustHub {
  constructor(opts = {}) {
    this._opts = opts;
    this._hosts = new Map();
  }

  _for(hostname) {
    if (!this._hosts.has(hostname)) this._hosts.set(hostname, new StreamingTrust(this._opts));
    return this._hosts.get(hostname);
  }

  /** يُغذّي score شذوذ استجابة لمضيف ويعيد حالته */
  push(hostname, score) {
    return this._for(hostname).push(score);
  }

  state(hostname) {
    return this._for(hostname).stats();
  }

  snapshot() {
    const out = {};
    for (const [h, t] of this._hosts) out[h] = t.stats();
    return out;
  }

  /** المضيفات اللتان وصلت لدرجة توقف (terminate) — تنبيه لإيقافها */
  dyingHosts() {
    return [...this._hosts].filter(([, t]) => t.decide() === "terminate").map(([h]) => h);
  }

  /** يؤدي إلغاء host إلى مسح حالته وإثبات الإلغاء في ملف السجل.
   *  @param {string} hostname -اسم المضيف
   * @param {string} [reason] -سبب الإلغاء
   * @returns {{hostname:string, reason:string, at:string, trustBefore:number}}
   */
  revokeHost(hostname, reason) {
    const trustBefore = this._hosts.has(hostname) ? this._for(hostname).stats().trust : 1;
    const record = {
      hostname,
      reason: reason || "unspecified",
      at: new Date().toISOString(),
      trustBefore,
    };
    // كتابة السجل
    const revPath = path.resolve(__dirname, "..", "state", "revocations.jsonl");
    fs.mkdirSync(path.dirname(revPath), { recursive: true });
    fs.appendFileSync(revPath, JSON.stringify(record) + "\n", "utf8");
    // مسح حالة المضيف
    this._hosts.delete(hostname);
    return record;
  }
}

export default { StreamingTrust, StreamingTrustHub, ACTION_BY_DECISION };
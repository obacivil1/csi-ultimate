/**
 * anomaly-scorer.mjs — مقترح شذوذ قابل للتفسير (مستوحى من N0VA v3.21 ML Anomaly Detection)
 * ────────────────────────────────────────────────────────────────────────────
 * مبدأ v3.21 المنقولة إلى سكرابرنا (بدون Python/torch/sklearn — JS صافي، صفر اعتماديات):
 *   1. "ML يقترح، القواعد تُقرّر"  — هذا المُصدِّر يُخرج score أُنشئ من إشارات ضعيفة
 *      متعددة (مثل Ensemble)، و action النهائي يبقى من محرك القواعد (ban-detector).
 *   2. "كل قرار له تفسير"          — attribution بأسلوب SHAP رخيص (leave-one-out
 *      على log-odds) لكل إشارة: أي عامل رفع/خفض النتيجة وكم.
 *   3. "Fallback عند فشل النموذج"   — أي استثناء → allow آمن + fallback:true (لا يتعطل.
 *
 * الإشارات الضعيفة (Weak signals) المدمجة:
 *   - كود HTTP صريح (403/429/503/410...)
 *   - نوع الحجب من ban-detector + ثقته (kind + confidence)
 *   - حجب ناعم (صفحة 200 بجسم شبه فارغ)
 *   - تأخير غير طبيعي (latency)
 *   - فشل قاطع الدائرة التراكمي (breaker fails)
 */

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/** معكوس sigmoid: يُحول احتمال (0..1) إلى log-odds (–∞..+∞). يُثبَّت عند الأطراف. */
function logOddsOf(p) {
  const t = clamp(p, 1e-9, 1 - 1e-9);
  return Math.log(t / (1 - t));
}

/** إسهام log-odds لكل كود HTTP صريح — الأقوى يعطي أقوى رفع */
const STATUS_LOG_ODDS = {
  429: 3.4, 403: 3.2, 503: 2.8, 401: 2.5, 410: 1.5, 451: 2.2,
  302: 0.4, 301: 0.3, 500: 1.8, 502: 1.6, 504: 1.6,
};

/** أنماط حجب نصية من ban-detector تُعدّ إشارة قوية للشذوذ */
const TEXT_KINDS = new Set(["http_429", "http_403", "http_503", "waf_block", "captcha", "cf_challenge", "cf_error", "js_required"]);

/**
 * scoreResponse — يفصل مسار الاستجابة إلى إشارات ثم يدمجها (Ensemble-lite).
 * @param {object} input
 * @param {number} [input.status]
 * @param {string|null} [input.kind]                 - نوع الحجب من ban-detector
 * @param {number} [input.confidence]                - ثقة الحجب 0..100
 * @param {Array<{kind:string,signal:string,score:number}>} [input.evidence]
 * @param {number} [input.elapsed]                   - زمن الطلب ms
 * @param {number} [input.breakerFails]              - عدد فشل قاطع الدائرة المتراكم للمضيف
 * @param {number} [input.latencyHighMs]             - العتبة التي يُعد فيها التأخير شذوذاً
 * @returns {{score:number, decision:string, signals:Array, explanation:Array, fallback:boolean, reason?:string}}
 */
export function scoreResponse(input = {}) {
  try {
    const {
      status = 200, kind = null, confidence = 0,
      evidence = [], elapsed = 0,
      breakerFails = 0,
      latencyHighMs = 8000,
    } = input;

    const signals = [];

    // 1) إشارة: كود HTTP صريح
    const statusL = STATUS_LOG_ODDS[status] ?? 0;
    if (statusL > 0) {
      signals.push({ name: `status_${status}`, weight: statusL, value: status, info: `HTTP ${status} صريح` });
    }

    // 2) إشارة: نوع الحجب + الثقة (من القواعد) — تُغذَّى القواعدُ نموذجَ الاقتراح
    const conf = clamp(confidence / 100, 0, 1);
    if (kind && TEXT_KINDS.has(kind)) {
      signals.push({ name: `kind_${kind}`, weight: 2.6 * conf, value: conf, info: `نوع حجب: ${kind}` });
    }

    // 3) إشارة: حجب ناعم (200 بجسم شبه فارغ)
    const soft = evidence.some((e) => e.kind === "soft_block");
    if (soft) {
      signals.push({ name: "soft_block", weight: 1.4, value: 1, info: "صفحة 200 بجسم شبه فارغ" });
    }

    // 4) إشارة: تأخير غير طبيعي
    if (elapsed > latencyHighMs) {
      const excess = clamp((elapsed - latencyHighMs) / latencyHighMs, 0, 1);
      signals.push({ name: "high_latency", weight: 0.5 + 0.7 * excess, value: elapsed, info: `تأخير ${elapsed}ms` });
    }

    // 5) إشارة: فشل قاطع الدائرة التراكمي (ذاكرة قصيرة المدى)
    if (breakerFails > 0) {
      const capped = Math.min(breakerFails, 5);
      signals.push({ name: "breaker_fails", weight: capped * 0.45, value: breakerFails, info: `${breakerFails} فشل بهذا المضيف` });
    }

    // 6) إشارة احترازية: لا إشارة اشتعلت → لا شذوذ
    if (signals.length === 0) {
      signals.push({ name: "baseline", weight: logOddsOf(0.05), value: 0.05, info: "أساس هادئ" });
    }

    const result = scoreSignals(signals);
    result.fallback = false;
    return result;
  } catch {
    // Fallback: أي خطأ → اقتراح آمن، القواعد تواصل
    return { score: 0.5, decision: "allow", signals: [], explanation: [], fallback: true, reason: "scorer_error" };
  }
}

/**
 * scoreSignals — Combiner عام: يجمع log-odds للإشارات ثم يفسّر (SHAP-like leave-one-out).
 * @param {Array<{name:string, weight:number, value?:any, info?:string}>} signals
 * @returns {{score:number, decision:string, signals:Array, explanation:Array}}
 */
export function scoreSignals(signals = []) {
  const weighted = signals.filter((s) => Number.isFinite(s.weight)).map((s) => ({
    name: s.name, weight: s.weight, value: s.value ?? null, info: s.info ?? "",
  }));

  const totalLog = weighted.reduce((a, s) => a + s.weight, 0);
  const score = Math.round(sigmoid(totalLog) * 1000) / 1000;
  const decision = decide(score);

  // التفسير: نسبة مساهمة كل إشارة عبر تأثير إزالة كل منها (leave-one-out)
  const explanation = weighted
    .map((s) => {
      const contribution = sigmoid(totalLog) - sigmoid(totalLog - s.weight);
      return { feature: s.name, contribution: Math.round(contribution * 1000) / 1000, weight: s.weight, value: s.value };
    })
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return { score, decision, signals: weighted, explanation };
}

/**
 * decide — عتبات قرار الاقتراح (تتبع مبدأ شجرة v3.21: حساسية حسب المسار).
 * الاقتراح لا ينفّذ إجراءً؛ محرك القواعد هو من يقرر action.
 * @param {number} score 0..1
 * @returns {"allow"|"step_up"|"deny"}
 */
export function decide(score) {
  if (score < 0.3) return "allow";
  if (score < 0.6) return "step_up";
  return "deny";
}

/**
 * toText — يحول التفسير إلى نص مقروء (مثل explanation_text في v3.21).
 * @param {Array} explanation
 * @returns {string}
 */
export function toText(explanation = []) {
  if (!explanation.length) return "لا شذوذ يُشار إليه.";
  return explanation.slice(0, 3).map((e) => {
    const dir = e.contribution >= 0 ? "رفع" : "خفض";
    return `- ${e.feature} (${dir} score بـ ${Math.abs(e.contribution).toFixed(2)})`;
  }).join("\n");
}

export default { scoreResponse, scoreSignals, decide, toText, sigmoid, logOddsOf };
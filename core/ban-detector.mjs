/**
 * ban-detector.mjs — كاشف الحظر الموحّد (مصدر واحد للقسم كله)
 * ──────────────────────────────────────────────────────────────
 * يدمج المعرّفين المبعثرين (anti-detect, canonical-extractor, rate-limiter)
 * في تصنيف واحد مبني على الأدلة الموزونة:
 *   - إشارات صريحة قوية: HTTP 429/403/503, CF challenge, captcha
 *   - إشارات ناعمة: حجب بـ 200 مع محتوى شبه فارغ (soft-block), كلمات عامة
 * المبدأ (SSRA): النجاح الكاذب أأخطر من الفشل الصريح — لا نُصنّف حجباً
 * من كلمة ضعيفة وحيدة على صفحة كبيرة سليمة.
 */
import { banDetection as BD } from "../config/index.mjs";

const THRESHOLD = BD.confidenceThreshold;

// أوزان الإشارات — قوية>ناعمة، كبح الفوضع الكاذب من "blocked" العامة
const WEIGHTS = {
  http_429: 100, http_403: 100, http_503: 90,
  cf_challenge: { "just a moment": 90, "cf-chl": 85, "challenge-platform": 90, "checking your browser": 90, "...click verify": 85, "attention required": 80 },
  cf_error:     { "cf-ray": 70, "error 1015": 90, "error 1020": 90, "error 1006": 90, "cloudflare ray": 75 },
  captcha:      { captcha: 85, recaptcha: 85, hcaptcha: 85, "are you a robot": 90, "verify you are human": 90, "verify humanity": 85 },
  waf_block:    { "access denied": 70, "your request has been blocked": 80, "request has been blocked": 80, "you have been blocked": 75, blocked: 45, "unusual traffic": 60, "too many requests": 60, "rate limit": 60, ddos: 55, "suspicious activity": 60 },
  js_required:  { "please enable javascript": 70, "enable javascript": 65, "javascript is required": 70 },
};

const HARD_STATUS = new Set(BD.statusHardCodes);

// إشارة حجب ناعم (200 بمحتوى فارغ تقريباً) — وزن منخفض حتى لا نطلقها على صفحات صغيرة شرعية
const SOFT_BLOCK_WEIGHT = 35;

function pickWeight(kind, word) {
  if (typeof WEIGHTS[kind] === "number") return WEIGHTS[kind];
  return WEIGHTS[kind]?.[word] ?? 50;
}

/**
 * يصنّف استجابة صفحة إلى حجب أو لا.
 * @param {object} input
 * @param {number} [input.statusCode]
 * @param {string} [input.title]
 * @param {string} [input.bodyText]
 * @param {string} [input.html]
 * @param {number} [input.contentBytes] - لو لم يمرر html مُسبقاً
 * @param {string} [input.url]
 * @returns {{ banned: boolean, kind: string|null, confidence: number, evidence: Array<{kind:string,signal:string,score:number}>, reason: string, action: string }}
 */
export function classifyBan(input = {}) {
  const { statusCode = null, title = "", bodyText = "", html = "", contentBytes = null, url = "" } = input;
  const haystack = `${title} ${bodyText} ${html}`.toLowerCase();

  const evidence = [];
  const add = (kind, signal, score) => { evidence.push({ kind, signal, score }); };

  // 1) أكواد HTTP الصريحة
  if (statusCode && HARD_STATUS.has(statusCode)) {
    add(`http_${statusCode}`, `HTTP ${statusCode}`, WEIGHTS[`http_${statusCode}`] ?? 90);
  }

  // 2) أنماط النص المصنّفة
  for (const [kind, words] of Object.entries(BD.patterns)) {
    for (const word of words) {
      if (haystack.includes(word)) {
        add(kind, word, pickWeight(kind, word));
      }
    }
  }

  // 3) الحجب الناعم: 2xx مع جسم شبه فارغ
  const bytes = contentBytes ?? (html ? Buffer.byteLength(html, "utf8") : null);
  const bodyOnly = bodyText.length;
  const totalBytes = bytes ?? bodyOnly;
  const looks2xx = statusCode == null || (statusCode >= 200 && statusCode < 300);
  if (looks2xx && totalBytes !== null && totalBytes > 0 && totalBytes < BD.softBlockMinContentBytes) {
    add("soft_block", `content ${totalBytes}B < ${BD.softBlockMinContentBytes}B`, SOFT_BLOCK_WEIGHT);
  }

  if (evidence.length === 0) {
    return { banned: false, kind: null, confidence: 0, evidence, reason: "", action: "continue" };
  }

  const confidence = Math.min(100, Math.round(evidence.reduce((s, e) => s + e.score, 0)));
  const banned = confidence >= THRESHOLD;
  const kind = [...evidence].sort((a, b) => b.score - a.score)[0].kind;

  const reason = evidence.map((e) => `${e.signal}(${e.score})`).join(", ");

  let action = banned ? "pause_host" : "warn";
  if (banned) {
    if (kind === "http_429") action = "retry_proxy";
    else if (kind === "http_403" || kind === "http_503" || kind === "cf_challenge" || kind === "cf_error") action = "rotate_fingerprint";
    else if (kind === "captcha") action = "wait_backoff";
    else if (kind === "soft_block") action = "retry_proxy";
  }

  return { banned, kind, confidence, evidence, reason, action };
}

/**
 * واجهة توافقية (تحل محل detectBan القديم في rate-limiter):
 * @param {number} statusCode
 * @param {string} html
 * @returns {{ banned: boolean, reason: string, kind: string|null, confidence: number }}
 */
export function detectBan(statusCode, html = "") {
  const r = classifyBan({ statusCode, html });
  return { banned: r.banned, reason: r.reason, kind: r.kind, confidence: r.confidence };
}

export { THRESHOLD };
export default { classifyBan, detectBan };
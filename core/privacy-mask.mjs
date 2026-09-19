/**
 * privacy-mask.mjs — محرك خصوصية بسياسات (مستوحى من N0VA v3.33 Programmable Privacy)
 * ────────────────────────────────────────────────────────────────────────────
 * النمط المنقول: سياسات DSL بسيطة تُحوّل PII (إيميلات/هواتف/عناوين IP/نصوص)
 * قبل كتابة التقارير — بدل نسخ نموذج الضخامة الكامل.
 *
 * المبدأ المنقول: "Deny by default" — لا تُحوّل شي إلا بسياسة صريحة.
 *
 * الاستخدام:
 *   import { applyMaskPolicies, DEFAULT_POLICY } from "./privacy-mask.mjs";
 *   const { docs, log } = applyMaskPolicies(docs, DEFAULT_POLICY);
 */
import { createHash } from "node:crypto";

// ── أنماط التحوّل المتاحة ──────────────────────────────────

const TRANSFORMS = {
  /** يُبقي النص كما هو — للتسجيل فقط */
  keep(value, _opts) { return { masked: value, changed: false }; },

  /** يُخفي البُعد الأخير (last-4 visible) */
  maskPhone(value, opts = {}) {
    const stealth = opts.stealth !== false; // default: stealth on
    const digits = String(value).replace(/[^\d+]/g, "");
    if (digits.length < 4) return { masked: stealth ? "*".repeat(digits.length) : digits, changed: stealth };
    const visible = digits.slice(-4);
    const hidden = "*".repeat(digits.length - 4);
    return { masked: hidden + visible, changed: stealth };
  },

  /** يُخفي الاسم (يبقي أول حرف + stars) */
  maskName(value, opts = {}) {
    const stealth = opts.stealth !== false;
    const s = String(value).trim();
    if (!s) return { masked: s, changed: false };
    return { masked: stealth ? s[0] + "*".repeat(Math.max(0, s.length - 1)) : s, changed: stealth };
  },

  /** يُ псевдоonymize via sha256 truncated — قابل للتحقق لكن غير قابل للعكس */
  pseudonymize(value, opts = {}) {
    const salt = opts.salt || "csi-default-salt";
    const h = createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 16);
    return { masked: `[ps:${h}]`, changed: true };
  },

  /** يُخفي الإيميل بالكامل */
  maskEmail(value, opts = {}) {
    const stealth = opts.stealth !== false;
    const s = String(value).trim();
    const at = s.indexOf("@");
    if (at < 1) return { masked: stealth ? "***" : s, changed: stealth };
    const user = s.slice(0, at);
    const domain = s.slice(at + 1);
    const maskedUser = user.length <= 1 ? (stealth ? "*" : user) : stealth ? user[0] + "*".repeat(Math.max(0, user.length - 1)) : user;
    const maskedDomain = domain.includes(".") ? (stealth ? "*".repeat(domain.indexOf(".")) + domain.slice(domain.indexOf(".")) : domain) : stealth ? "***" : domain;
    return { masked: `${maskedUser}@${maskedDomain}`, changed: stealth };
  },

  /** يُختزل IP إلى /24 أو يُخفيه */
  coarsenIP(value, opts = {}) {
    const stealth = opts.stealth !== false;
    const s = String(value).trim();
    const v4 = s.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
    if (v4) return { masked: stealth ? `${v4[1]}.0` : s, changed: stealth };
    const v6 = s.includes(":");
    if (v6) {
      const parts = s.split(":");
      if (parts.length >= 5) return { masked: stealth ? parts.slice(0, 4).join(":") + "::" : s, changed: stealth };
    }
    return { masked: stealth ? "[ip-masked]" : s, changed: stealth };
  },

  /** يحذف النص بالكامل */
  redact() { return { masked: "", changed: true }; },

  /** يطبق سياسة الحجب الشامل - Deny by default override */
  fullMask(value, _opts) { return { masked: "[REDACTED]", changed: true }; },
};

// ── سياسات افتراضية ────────────────────────────────────────

/** سياسة PII اختيارية: تُخفي إيميلات وهواتف فقط عند تمكين الخصوصية explicitly */
export const DEFAULT_POLICY = [
  { field: "emails",       transform: "maskEmail",       params: { stealth: true }, enabled: false },
  { field: "phones",       transform: "maskPhone",       params: { stealth: true }, enabled: false },
  { field: "whatsapp",     transform: "maskPhone",       params: { stealth: true }, enabled: false },
  { field: "social",       transform: "pseudonymize",    params: {}, enabled: false },
  { field: "ip_address",   transform: "coarsenIP",       params: {}, enabled: false },
];

/** سياسة الحجب التام (للحالات التي يُطلب فيها الحجب الكامل) */
export const STRICT_POLICY = [
  { field: "emails",       transform: "fullMask",        params: {}, enabled: true },
  { field: "phones",       transform: "fullMask",        params: {}, enabled: true },
  { field: "whatsapp",     transform: "fullMask",        params: {}, enabled: true },
  { field: "social",       transform: "pseudonymize",    params: {}, enabled: true },
  { field: "ip_address",   transform: "coarsenIP",       params: {}, enabled: true },
];

/**
 * تحويل قيمة حقل واحد عبر سياسة.
 * @param {string} value
 * @param {object} policy
 * @returns {{masked:string, changed:boolean, transform:string}}
 */
function applyTransform(value, policy) {
  // Check if policy is enabled - "Deny by default"
  if (policy.enabled === false) return { masked: value, changed: false, transform: "disabled" };
  const fn = TRANSFORMS[policy.transform];
  if (!fn) return { masked: value, changed: false, transform: "unknown" };
  if (!value || (typeof value === "string" && !value.trim())) {
    return { masked: value, changed: false, transform: policy.transform };
  }
  const { masked, changed } = fn(value, policy.params || {});
  return { masked, changed, transform: policy.transform };
}

/**
 * تطبيق سياسات على مستند واحد (doc) — يُحوّل الحقول المحددة ويسجّل في السجل.
 * @param {object} doc - مستند (url, host, title, emails, phones, ...))
 * @param {object[]} policies
 * @param {string} [salt="csi-default-salt"]
 * @returns {{doc:object, enforced:Array}}
 */
export function applyMaskPolicy(doc, policies = DEFAULT_POLICY, salt = "csi-default-salt") {
  const enforced = [];
  const maskedDoc = { ...doc };

  for (const p of policies) {
    // Skip disabled fields (Deny by default)
    if (p.enabled === false) continue;

    const value = maskedDoc[p.field];
    if (value == null) continue;

    // القيمة قد تكون مصفوفة أو نص
    const isArr = Array.isArray(value);
    const values = isArr ? value : [String(value)];

    let anyChanged = false;
    const newValues = values.map((v) => {
      const result = applyTransform(v, { ...p, params: { ...p.params, salt } });
      if (result.changed) anyChanged = true;
      return result.masked;
    });

    if (anyChanged) {
      maskedDoc[p.field] = isArr ? newValues : newValues.join("; ");
      enforced.push({
        field: p.field,
        transform: p.transform,
        count: values.length,
      });
    }
  }

  return { doc: maskedDoc, enforced };
}

/**
 * تطبيق سياسات على مجموعة مستندات.
 * @param {object[]} docs
 * @param {object[]} [policies=DEFAULT_POLICY]
 * @param {object} [opts]
 * @returns {{docs:object[], log:object[]}}
 */
export function applyMaskPolicies(docs, policies = DEFAULT_POLICY, opts = {}) {
  const { salt = "csi-default-salt" } = opts;
  const log = [];
  const masked = docs.map((doc, i) => {
    const { doc: maskedDoc, enforced } = applyMaskPolicy(doc, policies, salt);
    if (enforced.length) {
      log.push({
        index: i,
        url: doc.url,
        enforced,
        timestamp: new Date().toISOString(),
      });
    }
    return maskedDoc;
  });
  return { docs: masked, log };
}

export default { applyMaskPolicy, applyMaskPolicies, DEFAULT_POLICY, TRANSFORMS };

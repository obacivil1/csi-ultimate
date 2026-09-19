/**
 * tech-detector.mjs — كاشف تقنيات المواقع + تحليل رؤوس أمنية (سلبي تماماً)
 * ─────────────────────────────────────────────────────────────────────────
 * مستوحى من N0VA Observer/ReconEngine لكن في حدود سلبية مشروعة:
 *   - كشف التقنيات من HTML/الرؤوس التي يقدمها الخادم أصلاً (WordPress،
 *     Cloudflare، الجيل المتوقع من السكريبر/الـ selectors)
 *   - تحليل الرؤوس الأمنية المفتوحة (ما ينقص = ملاحظة، لا اختبار نشط)
 *
 * لا يقوم بأي فحص منافذ، مسارات، أو حقن — خارج نطاق الاستخدام القانوني.
 */

// ── بصمات التقنيات (أنماط على HTML + رؤوس HTTP) ─────────────
const TECH_SIGNATURES = [
  { tech: "WordPress", patterns: [/wp-content/i, /wp-includes/i, /wp-json/i, /wp-generator/i] },
  { tech: "Drupal", patterns: [/sites\/default\/files/i, /Drupal\.settings/i, /x-generator:\s*drupal/i] },
  { tech: "Joomla", patterns: [/\/components\/com_/i, /Joomla!/i] },
  { tech: "React", patterns: [/_next\/static/i, /react(?:\.min)?\.js/i, /__REACT/i, /data-reactroot/i] },
  { tech: "Vue", patterns: [/vue(?:\.min)?\.js/i, /__vue__/i, /v-cloak/i] },
  { tech: "Angular", patterns: [/ng-version/i, /angular(?:\.min)?\.js/i] },
  { tech: "Svelte", patterns: [/svelte-/i, /__svelte/i] },
  { tech: "Django", patterns: [/csrfmiddlewaretoken/i, /django/i] },
  { tech: "Flask", patterns: [/Werkzeug/i, /flask/i] },
  { tech: "Laravel", patterns: [/laravel_session/i, /XSRF-TOKEN/i] },
  { tech: "Ruby on Rails", patterns: [/rails-ujs/i, /csrf-token/i] },
  { tech: "ASP.NET", patterns: [/__VIEWSTATE/i, /aspnet/i, /x-aspnet-version/i] },
  { tech: "PHP", patterns: [/x-powered-by:\s*php/i, /\.php/i] },
  { tech: "Nginx", patterns: [/server:\s*nginx/i] },
  { tech: "Apache", patterns: [/server:\s*apache/i] },
  { tech: "Cloudflare", patterns: [/cf-ray/i, /cloudflare/i, /cf-cache-status/i] },
  { tech: "Varnish", patterns: [/x-varnish/i] },
  { tech: "Shopify", patterns: [/cdn\.shopify\.com/i, /myshopify\.com/i, /x-shopid/i] },
  { tech: "Wix", patterns: [/static\.wixstatic\.com/i, /wix\.com/i] },
  { tech: "OpenCart", patterns: [/oc_session/i, /index\.php\?route=/i] },
  { tech: "Magento", patterns: [/mage\/cache/i, /form_key/i, /var\/view_preprocessed/i] },
];

// ── الرؤوس الأمنية الموصى فحصها (قراءة فقط) ─────────────────
const SECURITY_HEADERS = [
  "Strict-Transport-Security",
  "Content-Security-Policy",
  "X-Frame-Options",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
];

/**
 * detectTechnologies — كشف التقنيات من HTML و/أو رؤوس HTTP.
 * يعيد قائمة التقنيات مع الأنماط المطابقة (قراءة مصدر سلبي فقط).
 *
 * @param {object} [input]
 * @param {string} [input.html=""]           - محتوى الصفحة الملتقطة
 * @param {object|string} [input.headers={}] - رؤوس XMLHttpRequest أو سلسلة raw
 * @returns {{tech:string, matched:string[]}[]}
 */
export function detectTechnologies(input = {}) {
  const { html = "", headers = {} } = input;
  const headerText =
    typeof headers === "string"
      ? headers
      : Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");

  const combined = `${headerText}\n${html}`;
  const found = [];

  for (const sig of TECH_SIGNATURES) {
    const matched = sig.patterns.filter((p) => p.test(combined));
    if (matched.length > 0) {
      found.push({ tech: sig.tech, matched: matched.map((p) => p.source) });
    }
  }
  return found;
}

/**
 * analyzeSecurityHeaders — يفيد أي رؤوس أمنية أساسية مفقودة/موجودة.
 * قراءة سلبية لما أرسله الخادم؛ لا يختبر شيئاً. يعيد درجة أمان 0-100.
 *
 * @param {object|string} headers - رؤوس استجابة (لا تهم الحالة)
 * @returns {{present:string[], missing:string[], score:number}}
 */
export function analyzeSecurityHeaders(headers = {}) {
  const headerText =
    typeof headers === "string"
      ? headers
      : Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");

  const headerKeys = new Set(
    headerText.split("\n").map((l) => l.split(":")[0]?.trim().toLowerCase()).filter(Boolean)
  );

  const present = [];
  const missing = [];
  for (const h of SECURITY_HEADERS) {
    if (headerKeys.has(h.toLowerCase())) present.push(h);
    else missing.push(h);
  }

  const score = SECURITY_HEADERS.length ? Math.round((present.length / SECURITY_HEADERS.length) * 100) : 0;
  return { present, missing, score };
}

export { TECH_SIGNATURES, SECURITY_HEADERS };
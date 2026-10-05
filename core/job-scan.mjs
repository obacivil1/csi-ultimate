/**
 * job-scan.mjs — shared planning/controls role taxonomy + region gates
 *
 * Single source of truth for the user's specialty keywords:
 *   senior planning engineer, senior planning lead, senior planning & cost control lead,
 *   senior control lead, project control lead, cost control engineer, scheduling engineer…
 * Used by: scripts/job-hunter/*, state/expat_planning_extract.mjs, n8n-workflow/pipeline.mjs
 */

export const TARGET_ROLE_PHRASES = [
  "senior planning & cost control lead",
  "senior planning and cost control lead",
  "senior planning & scheduling",
  "senior planning and scheduling",
  "senior planning lead",
  "senior planning engineer",
  "planning & cost control lead",
  "planning and cost control lead",
  "planning & controls lead",
  "planning and controls lead",
  "senior control lead",
  "project control lead",
  "project controls lead",
  "project control engineer",
  "project controls engineer",
  "cost control lead",
  "cost control engineer",
  "controls lead",
  "controls engineer",
  "planning lead",
  "senior planner",
  "planning engineer",
  "scheduling engineer",
  "senior scheduler",
  "lead scheduler",
  "project scheduler",
  "cost estimator",
  "planning manager",
  "project controller",
  "scheduler",
  "planner",
  "مخطط",
  "متخصص تخطيط",
  "مهندس تخطيط",
  "مخطط مشاريع",
  "مخطط رئيسي",
  "مخطط أول",
  "مهندس جدولة",
  "مراقب تكاليف",
  "مهندس تكاليف",
  "مخطط جدولة",
  "تخطيط مشاريع",
  "مدير تخطيط",
  "التخطيط والتحكم",
]

export const ROLE_PHRASE_RE = new RegExp(
  "(?:" +
    TARGET_ROLE_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .filter(Boolean)
      .join("|") +
    ")",
  "i"
)

export const PLANNING_RE = new RegExp(
  "(?:" +
    [
      "planning",
      "schedul(?:e|ing|er|ed)",
      "cost control",
      "project control",
      "control(?:s)? (?:lead|engineer|manager)",
      "cost estimat",
      "planner",
      "primavera",
      "\\bp6\\b",
      "earned value",
      "جدولة",
      "تخطيط",
      "التخطيط",
      "مخطط",
      "مراقب تكاليف",
      "مهندس تكاليف",
      "مهندس جدولة",
      "بريمافيرا",
    ].join("|") +
    ")",
  "i"
)

/** Explicit target region only. Generic "saudi"/"السعودية" is NOT a target:
 *  it appears in almost every Saudi listing, so it cannot prove Riyadh. */
export const TARGET_REGION_RE = /riyadh|الرياض/i

export const OTHER_CITY_RE =
  /jeddah|جدة|dammam|الدمام|khobar|الخبر|jubail|الجبيل|mecca|مكة|makkah|medina|المدينة|yanbu|ينبع|tabuk|تبوك|abha|أبها|hail|حائل|buraidah|بريدة|manama|المنامة|bahrain|البحرين|doha|قطر|kuwait|الكويت|dubai|دبي|abu dhabi|أبو ظبي|muscat|مسقط|oman|عمان/i

export const FOREIGN_CITY_RE =
  /manama|المنامة|bahrain|البحرين|doha|قطر|kuwait|الكويت|dubai|دبي|abu dhabi|أبو ظبي|muscat|مسقط|oman|عمان|emirates|الإمارات/i

export const GENERIC_SAUDI_RE = /saudi|arabia|السعودية|سعودية/i

export const JOB_SEEKER_RE =
  /job\s*seek(?:ers?|ing)|باحث عن عمل|إعلان البحث عن عمل|طلبات التوظيف|\blooking\s+for\b|\bseeking\b|available\s+for|open\s+to\s+work|immediat\w*\s+available|part[ -]?time|freelance|freelancer|فريلانس|مستقل|دوام جزئي|أبحث عن|بحث عن وظيفة|cv|curriculum\s*vitae|resume|سيرة ذاتية|\d+\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|expertise)/i

export const SERVICE_OFFER_RE =
  /services?\s+offer|quantity\s*take[- ]?off|bar bending|\bBBS\b|cutting\s+list|freelance|web\s*design|digital\s*marketing|translation\s*services|seo\s*services|smm\s*services|photoshop|auto\s*cad\s*services|office\s*for\s*re(?:nt|nt)|room\s*for\s*rent|apartment\s*for\s*sale|car\s*for\s*sale|cv\s*(?:writing|preparation)|resume\s*writing|مكتب هندسي|خدمات|إعارة عمالة|استقدام/i

export const JOBSEEKER_DOMAIN_RE = /gmail|yahoo|hotmail|outlook|icloud|protonmail|zoho/i

export const BLOCK_PAGE_RE =
  /(captcha|are you a robot|rate.?limit|too many requests|access denied|blocked|cf-error|cf-chl|checking your browser|just a moment|ddos|verify you are human|unusual traffic|enable javascript|please complete the security|cloudflare|attention required|forbidden|pardon our interruption|page not found|does not exist)/i

export function isTargetRole(text) {
  if (!text) return false
  return ROLE_PHRASE_RE.test(text) && !NON_ROLE_RE.test(text)
}

export function isPlanningAdjacent(text) {
  if (!text) return false
  return PLANNING_RE.test(text)
}

export const NON_ROLE_RE =
  /urban planning|urban planner|city planning|city planner|financial planning|financial planner|event planning|event planner|media planning|media planner|strategic planning|strategic planner|supply chain planning|supply chain planner|demand planning|demand planner|production planning|production planner|capacity planning|capacity planner|hr planning|workforce planning|workforce planner|succession planning|succession planner|marketing|content writer|sales|software engineer|data scientist|machine learning|devops|accountant|teacher|nurse|driver|salesman|receptionist|administrator assistant|secretary|restaurant|chef|cashier|waiter|security guard|facility management|cafm|quantity take[- ]?off/i

/**
 * Gate a candidate during extraction: decide accept / skip-reason.
 * - kind 'ad': nothing (title only validated via isTargetRole by caller)
 * - region: null ok, or {reject, reason}
 *
 * Precision-first: any off-target city mention rejects, even when Riyadh is also
 * mentioned. Previously a generic "Saudi"/"السعودية" counted as the target region,
 * so every Jeddah/Dammam/Khobar ad that said "Saudi Arabia" was accepted.
 */
/**
 * Off-domain advertising noise: these words mean the posting sells a service or
 * belongs to another trade, even when the title contains a planning phrase.
 * e.g. "COST ESTIMATOR (Events, Fit-Out, Signage)" is events/fit-out work, not
 * project controls for construction EPC.
 */
export const OFF_DOMAIN_RE =
  /events?\b|exhibition|fit[\s-]?out|signage|museum exhibition|interior\s+(?:fit|decoration)|partition|false\s*ceiling|catering|food\s*&?\s*beverage|medical|healthcare|hospital|clinic|school|university|teacher|driver|logistics|warehouse|store\s*manager|retail|hospitality|bank|teller|cashier|receptionist|front\s*desk|marketing|sales|accountant|secretary|nurse|chef|cleaning|security\s+guard|technician\s+/i

/**
 * Normalize a raw "Region:" / location string into a clean single label.
 * Fixes "Riyadh (Riyadh)", "  Riyadh  (Riyadh)" → "Riyadh".
 */
export function normalizeLoc(raw) {
  if (!raw) return ""
  let s = String(raw).replace(/\s+/g, " ").trim()
  // "Riyadh (Riyadh)" → "Riyadh"   |   "Riyadh (Al Olaya)" → "Riyadh (Al Olaya)"
  const inner = s.match(/\(([^)]*)\)/)
  if (inner && /^[\s]*riyadh[\s]*$/i.test(inner[1])) {
    s = s.replace(/\s*\([^)]*\)/, "").trim()
  }
  // Collapse an exact duplicated city name with any separator
  s = s.replace(/^([A-Za-z\u0600-\u06FF]+)\s*[(\-–]\s*([A-Za-z\u0600-\u06FF]+)\s*\)?$/,
    (m, a, b) => (a.toLowerCase() === b.toLowerCase() ? a : m))
  return s.replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "").trim()
}

export function regionGate(text, targetRegionRe = TARGET_REGION_RE) {
  if (!text) return { ok: true }
  if (FOREIGN_CITY_RE.test(text)) return { ok: false, reason: "foreign-city", snippet: text.slice(0, 80) }
  if (OTHER_CITY_RE.test(text)) return { ok: false, reason: "other-city", snippet: text.slice(0, 80) }
  if (!targetRegionRe.test(text) && GENERIC_SAUDI_RE.test(text)) {
    return { ok: false, reason: "saudi-non-riyadh", snippet: text.slice(0, 80) }
  }
  return { ok: true }
}

export function isJobSeeker(text) {
  if (!text) return false
  return JOB_SEEKER_RE.test(text)
}

export function isServiceOffer(text) {
  if (!text) return false
  return SERVICE_OFFER_RE.test(text)
}

/**
 * True only when the text really is a challenge/404/error shell.
 * A short page is NOT a blocked page on its own — the old `length < 300` rule
 * rejected every legitimately short ad, so it was removed.
 */
export function isBlockedPage(text) {
  if (!text) return true
  return BLOCK_PAGE_RE.test(text)
}

export function planningKeywords() {
  return TARGET_ROLE_PHRASES.slice()
}
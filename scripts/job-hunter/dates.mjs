import { MONTHS_EN, MONTHS_AR, WEEKDAYS } from "./config.mjs"

const NOW_REF = "enStr"
function now() { return new Date().getTime() }

export function parseDate(text) {
  if (!text) return null
  let clean = String(text).replace(/\s+/g, " ").trim()
  clean = clean
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
  if (!clean) return null
  const t = now()
  if (/\bاليوم\b|\btoday\b/i.test(clean) && clean.length < 60) return t
  if (/\bأمس\b|\byesterday\b/i.test(clean) && clean.length < 60) return t - 86400000

  const withOffsets = (m, d, y) => {
    const ts = new Date(y, m, d).getTime()
    return Number.isNaN(ts) ? null : ts
  }

  let m
  m = clean.match(new RegExp(`${WEEKDAYS.source},\\s*([A-Za-z\u0600-\u06FF]{3,9})\\s+(\\d{1,2}),\\s+(\\d{4})`, "i"))
  if (m) {
    const mo = MONTHS_EN[m[1].substring(0,3).toLowerCase()] ?? MONTHS_AR[m[1]]
    if (mo !== undefined) return withOffsets(mo, +m[2], +m[3])
  }
  m = clean.match(/([A-Za-z\u0600-\u06FF]{3,9})\s+(\d{1,2}),\s+(\d{4})/)
  if (m) {
    const mo = MONTHS_EN[m[1].substring(0,3).toLowerCase()] ?? MONTHS_AR[m[1]]
    if (mo !== undefined) return withOffsets(mo, +m[2], +m[3])
  }
  m = clean.match(/(\d{1,2})\s+([A-Za-z\u0600-\u06FF]{3,9})\s+(\d{4})/)
  if (m) {
    const mo = MONTHS_EN[m[2].substring(0,3).toLowerCase()] ?? MONTHS_AR[m[2]]
    if (mo !== undefined) return withOffsets(mo, +m[1], +m[3])
  }
  m = clean.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return withOffsets(+m[2] - 1, +m[3], +m[1])
  m = clean.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (m) return withOffsets(+m[2] - 1, +m[1], +m[3])

  m = clean.match(/(\d+(?:\.\d+)?)\s*(day|days|hr|hrs|hour|hours|week|weeks|month|months)\s+ago/i)
  if (m) {
    const n = parseFloat(m[1])
    const unit = m[2].toLowerCase()
    const mult = unit.startsWith("week") ? 7 * 86400000
      : unit.startsWith("month") ? 30 * 86400000
      : (unit.startsWith("hr") || unit.startsWith("hour")) ? 3600000
      : 86400000
    return t - n * mult
  }
  m = clean.match(/\+\s*(\d{1,2})\s*(day|days)\s+ago/i)
  if (m) return t - 86400000 * (parseFloat(m[1]) + 1)
  m = clean.match(/\d{1,3}\+?\s*(?:hours|hrs?|days|weeks)\s+ago/i)
  if (m) return null

  m = clean.match(/(منذ|قبل)\s+(\d{1,2})\s*(يوم|ساعة|اسبوع|أسبوع|شهر)/i)
  if (m) {
    const n = +m[2]
    const mult = /يوم/.test(m[3]) ? 86400000 : /ساعة/.test(m[3]) ? 3600000 : /اسبوع|أسبوع/.test(m[3]) ? 7 * 86400000 : 30 * 86400000
    return t - n * mult
  }
  return null
}

export function isWithinWindow(ts, days) {
  if (ts === null || ts === undefined) return null
  const cutoff = now() - days * 86400000
  return ts >= cutoff
}

export function formatDateLong(text) {
  return String(text || "").replace(/\s+/g, " ").trim()
}
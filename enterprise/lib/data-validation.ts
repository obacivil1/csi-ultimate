export interface RecordValidation {
  extractionAccuracy: ExtractionAccuracy
  fieldConfidence: Record<string, FieldConfidence>
  duplicates: DuplicateResult
  reliabilityScore: number
  crawlQuality: CrawlQualityReport
  sellableProductTest: SellableProductTest
}

export interface ExtractionAccuracy {
  totalRecords: number
  missingPhone: number
  missingEmail: number
  missingPrice: number
  missingCategory: number
  missingTitle: number
  missingLocation: number
  phonePct: number
  emailPct: number
  pricePct: number
  categoryPct: number
  titlePct: number
  locationPct: number
  accuracyScore: number
}

export interface FieldConfidence {
  valid: number
  invalid: number
  total: number
  confidence: number
  sample: string[]
}

export interface DuplicateResult {
  exactDuplicates: number
  nearDuplicates: number
  totalDuplicateRecords: number
  duplicatePercentage: number
  nearMatchGroups: { key: string; count: number; records: any[] }[]
}

export interface CrawlQualityReport {
  collected: number
  missing: { field: string; count: number; pct: number }[]
  failedItems: { reason: string; count: number }[]
  improvements: string[]
  unstableSelectors: string[]
}

export interface SellableProductTest {
  trustScore: number
  verdict: "TRUSTED" | "CONDITIONAL" | "NOT TRUSTED"
  strengths: string[]
  weaknesses: string[]
  requirements: string[]
  summary: string
}

function countPct(present: number, total: number): number {
  return total > 0 ? Math.round((present / total) * 100) : 0
}

const PHONE_REGEX = /^[\+\d][\d\s\-\(\)\.]{6,20}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PRICE_REGEX = /^[\d\,\.]+$/

function isValidPhone(v: any): boolean {
  if (!v) return false
  const s = String(v).trim()
  return s.length >= 7 && PHONE_REGEX.test(s)
}

function isValidEmail(v: any): boolean {
  if (!v) return false
  const s = String(v).trim()
  return s.length >= 5 && EMAIL_REGEX.test(s)
}

function isValidPrice(v: any): boolean {
  if (v === null || v === undefined || v === "") return false
  const n = Number(v)
  return !isNaN(n) && n > 0
}

function isValidPhoneArray(arr: any): boolean {
  if (!Array.isArray(arr)) return isValidPhone(arr)
  return arr.some((p: any) => isValidPhone(p))
}

function isValidEmailArray(arr: any): boolean {
  if (!Array.isArray(arr)) return isValidEmail(arr)
  return arr.some((e: any) => isValidEmail(e))
}

export function computeExtractionAccuracy(records: any[]): ExtractionAccuracy {
  const total = records.length
  const missingPhone = records.filter(r => !isValidPhoneArray(r.phones)).length
  const missingEmail = records.filter(r => !isValidEmailArray(r.emails)).length
  const missingPrice = records.filter(r => !isValidPrice(r.price)).length
  const missingCategory = records.filter(r => !r.category).length
  const missingTitle = records.filter(r => !r.title).length
  const missingLocation = records.filter(r => !r.location).length

  const phonePct = countPct(total - missingPhone, total)
  const emailPct = countPct(total - missingEmail, total)
  const pricePct = countPct(total - missingPrice, total)
  const categoryPct = countPct(total - missingCategory, total)
  const titlePct = countPct(total - missingTitle, total)
  const locationPct = countPct(total - missingLocation, total)

  const accuracyScore = Math.round((phonePct + emailPct + pricePct + categoryPct + titlePct + locationPct) / 6)

  return {
    totalRecords: total, missingPhone, missingEmail, missingPrice,
    missingCategory, missingTitle, missingLocation,
    phonePct, emailPct, pricePct, categoryPct, titlePct, locationPct,
    accuracyScore,
  }
}

export function computeFieldConfidence(records: any[]): Record<string, FieldConfidence> {
  const phoneResults = records.map(r => ({ valid: isValidPhoneArray(r.phones), value: r.phones }))
  const emailResults = records.map(r => ({ valid: isValidEmailArray(r.emails), value: r.emails }))
  const priceResults = records.map(r => ({ valid: isValidPrice(r.price), value: r.price }))

  const toConfidence = (results: { valid: boolean; value: any }[], label: string): FieldConfidence => {
    const valid = results.filter(r => r.valid).length
    const invalid = results.filter(r => !r.valid).length
    const total = results.length
    const confidence = total > 0 ? Math.round((valid / total) * 100) : 0
    const invalidSamples = results.filter(r => !r.valid && r.value).slice(0, 3).map(r => String(r.value).slice(0, 50))
    return { valid, invalid, total, confidence, sample: invalidSamples }
  }

  const titleResults = records.map(r => ({ valid: !!r.title && r.title.length >= 3, value: r.title }))
  const locationResults = records.map(r => ({ valid: !!r.location && r.location.length >= 2, value: r.location }))
  const categoryResults = records.map(r => ({ valid: !!r.category, value: r.category }))

  return {
    phone: toConfidence(phoneResults, "phone"),
    email: toConfidence(emailResults, "email"),
    price: toConfidence(priceResults, "price"),
    title: toConfidence(titleResults, "title"),
    location: toConfidence(locationResults, "location"),
    category: toConfidence(categoryResults, "category"),
  }
}

export function detectDuplicates(records: any[]): DuplicateResult {
  const urlSeen = new Set<string>()
  const exactDuplicateIds = new Set<number>()
  const nearDuplicateIds = new Set<number>()

  records.forEach((rec, idx) => {
    const url = rec.url || rec.link || ""
    if (url && urlSeen.has(url)) {
      exactDuplicateIds.add(idx)
    }
    if (url) urlSeen.add(url)
  })

  const titlePhoneMap = new Map<string, number[]>()
  records.forEach((rec, idx) => {
    if (exactDuplicateIds.has(idx)) return
    const title = (rec.title || "").toLowerCase().trim()
    if (title) {
      const phone = Array.isArray(rec.phones) ? rec.phones.join(",") : (rec.phone || "")
      const tpKey = `${title}::${phone}`
      if (!titlePhoneMap.has(tpKey)) titlePhoneMap.set(tpKey, [])
      titlePhoneMap.get(tpKey)!.push(idx)
    }
  })

  const nearMatchGroups: { key: string; count: number; records: any[] }[] = []
  titlePhoneMap.forEach((indices, key) => {
    if (indices.length > 1) {
      indices.forEach((idx, i) => { if (i > 0) nearDuplicateIds.add(idx) })
      nearMatchGroups.push({ key, count: indices.length, records: indices.map(i => records[i]) })
    }
  })

  const exactDupCount = exactDuplicateIds.size
  const nearDupCount = nearDuplicateIds.size
  const totalDuplicateRecords = exactDupCount + nearDupCount
  const duplicatePercentage = records.length > 0 ? Math.round((totalDuplicateRecords / records.length) * 100) : 0

  return {
    exactDuplicates: exactDupCount,
    nearDuplicates: nearDupCount,
    totalDuplicateRecords,
    duplicatePercentage,
    nearMatchGroups: nearMatchGroups.slice(0, 10),
  }
}

export function computeSourceReliability(
  site: string,
  records: any[],
  report: any,
  health: any,
): { extractionSuccess: number; dataCompleteness: number; duplicatePct: number; errorRate: number; fieldConfidenceAvg: number; reliabilityScore: number } {
  const ext = computeExtractionAccuracy(records)
  const conf = computeFieldConfidence(records)
  const dup = detectDuplicates(records)
  const dqScore = report?.metrics?.dataQualityScore || 0
  const healthScore = health?.healthScore || 0
  const extractionRate = report?.metrics?.extractionRate || 0

  const fieldConfidenceAvg = Math.round(
    (conf.phone.confidence + conf.email.confidence + conf.price.confidence + conf.title.confidence + conf.location.confidence + conf.category.confidence) / 6
  )

  const reliabilityScore = Math.round(
    (ext.accuracyScore * 0.25) +
    (dqScore * 0.2) +
    (healthScore * 0.15) +
    (extractionRate * 0.15) +
    (fieldConfidenceAvg * 0.15) +
    ((100 - dup.duplicatePercentage) * 0.1)
  )

  return {
    extractionSuccess: ext.accuracyScore,
    dataCompleteness: dqScore,
    duplicatePct: dup.duplicatePercentage,
    errorRate: 100 - ext.accuracyScore,
    fieldConfidenceAvg,
    reliabilityScore,
  }
}

export function generateCrawlQualityReport(records: any[], report: any): CrawlQualityReport {
  const ext = computeExtractionAccuracy(records)
  const issues = report?.issues || []

  const missing = [
    { field: "phone", count: ext.missingPhone, pct: 100 - ext.phonePct },
    { field: "email", count: ext.missingEmail, pct: 100 - ext.emailPct },
    { field: "price", count: ext.missingPrice, pct: 100 - ext.pricePct },
    { field: "category", count: ext.missingCategory, pct: 100 - ext.categoryPct },
    { field: "location", count: ext.missingLocation, pct: 100 - ext.locationPct },
  ].sort((a, b) => b.pct - a.pct)

  const failedItems = issues.map((i: string) => ({ reason: i, count: 1 }))

  const improvements: string[] = []
  if (ext.phonePct < 80) improvements.push("Phone extraction configuration may need updating — coverage is below 80%")
  if (ext.emailPct < 60) improvements.push("Email extraction is low — consider expanding email selectors")
  if (ext.pricePct < 70) improvements.push("Price extraction below 70% — verify price selectors match current site layout")
  if (ext.categoryPct < 50) improvements.push("Category detection weak — site may have changed its category taxonomy")
  if (ext.locationPct < 60) improvements.push("Location extraction is low — verify location selectors")

  return {
    collected: records.length,
    missing,
    failedItems,
    improvements,
    unstableSelectors: issues.filter((i: string) => i.toLowerCase().includes("selector") || i.toLowerCase().includes("extraction")),
  }
}

export function evaluateSellableProduct(records: any[], report: any, health: any): SellableProductTest {
  const ext = computeExtractionAccuracy(records)
  const conf = computeFieldConfidence(records)
  const dup = detectDuplicates(records)
  const reliability = report?.metrics?.dataQualityScore || 0

  const trustScore = Math.round(
    (ext.accuracyScore * 0.3) +
    (reliability * 0.25) +
    ((conf.phone.confidence + conf.email.confidence + conf.price.confidence) / 3) * 0.25 +
    ((100 - dup.duplicatePercentage) * 0.2)
  )

  const strengths: string[] = []
  const weaknesses: string[] = []
  const requirements: string[] = []

  if (ext.accuracyScore >= 80) strengths.push(`${ext.accuracyScore}% extraction accuracy — field coverage is strong`)
  if (conf.phone.confidence >= 80) strengths.push(`${conf.phone.confidence}% phone validation confidence`)
  if (conf.email.confidence >= 70) strengths.push(`${conf.email.confidence}% email validation confidence`)
  if (dup.duplicatePercentage <= 5) strengths.push(`Only ${dup.duplicatePercentage}% duplicate rate — data is clean`)
  if (reliability >= 80) strengths.push(`${reliability}% data quality score from crawl metrics`)

  if (ext.missingPhone > 0) weaknesses.push(`${ext.missingPhone} records (${100 - ext.phonePct}%) missing phone numbers — reduces lead generation value`)
  if (ext.missingEmail > 0) weaknesses.push(`${ext.missingEmail} records (${100 - ext.emailPct}%) missing email addresses`)
  if (ext.missingPrice > 0) weaknesses.push(`${ext.missingPrice} records (${100 - ext.pricePct}%) missing price data — limits market analysis`)
  if (dup.duplicatePercentage > 10) weaknesses.push(`${dup.duplicatePercentage}% duplicate rate — exceeds acceptable threshold for clean data delivery`)
  if (conf.phone.confidence < 70) weaknesses.push(`Phone confidence at ${conf.phone.confidence}% — many numbers may be invalid`)
  if (reliability < 60) weaknesses.push(`Overall data quality score of ${reliability}% is below sellable threshold`)

  if (ext.phonePct < 90) requirements.push("Improve phone coverage to 90%+ for lead generation use cases")
  if (ext.emailPct < 70) requirements.push("Improve email coverage to 70%+ for marketing use cases")
  if (ext.pricePct < 85) requirements.push("Improve price coverage to 85%+ for market analysis use cases")
  if (dup.duplicatePercentage > 5) requirements.push("Reduce duplicate rate below 5% through deduplication pipeline")

  const verdict = trustScore >= 80 ? "TRUSTED" : trustScore >= 60 ? "CONDITIONAL" : "NOT TRUSTED"

  const summary = trustScore >= 80
    ? `Dataset scores ${trustScore}/100 — suitable for交付 to paying customers. ${strengths[0] || "Data quality meets sellable thresholds."}`
    : trustScore >= 60
      ? `Dataset scores ${trustScore}/100 — conditional acceptance. ${weaknesses.slice(0, 2).join(". ")}. Recommend improvements before delivery.`
      : `Dataset scores ${trustScore}/100 — not ready for customer delivery. ${weaknesses.slice(0, 3).join(". ")}. Major improvements required.`

  return { trustScore, verdict, strengths, weaknesses, requirements, summary }
}

export function computeFullValidation(records: any[], report: any, health: any): RecordValidation {
  return {
    extractionAccuracy: computeExtractionAccuracy(records),
    fieldConfidence: computeFieldConfidence(records),
    duplicates: detectDuplicates(records),
    reliabilityScore: computeSourceReliability(report?.site || "", records, report, health).reliabilityScore,
    crawlQuality: generateCrawlQualityReport(records, report),
    sellableProductTest: evaluateSellableProduct(records, report, health),
  }
}

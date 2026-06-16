import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { cleanPhone, cleanPrice } from "./canonical-extractor.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_DIR = resolve(__dirname, "..", "state")

export function calculateFieldAccuracy(records) {
  const total = records.length
  if (total === 0) return null

  const fieldDefs = {
    title:    { label: "Title",       sourceCheck: r => r.title && r.title !== "N/A" },
    price:    { label: "Price",       sourceCheck: r => cleanPrice(r.price) !== null },
    phone:    { label: "Phone",       sourceCheck: r => cleanPhone(r.phone, r.url || "", "GB") !== null },
    email:    { label: "Email",       sourceCheck: r => r.email && r.email.trim().length > 0 },
    location: { label: "Location",    sourceCheck: r => r.location && r.location.trim().length > 0 },
    currency: { label: "Currency",    sourceCheck: r => r.currency && r.currency.trim().length > 0 },
  }

  const fields = {}
  for (const [key, def] of Object.entries(fieldDefs)) {
    const present = records.filter(r => def.sourceCheck(r)).length
    fields[key] = {
      label: def.label,
      present,
      empty: total - present,
      accuracy: total > 0 ? Math.round((present / total) * 100) : 0,
    }
  }

  return { total, fields, overallAccuracy: Math.round(Object.values(fields).reduce((s, f) => s + f.accuracy, 0) / Object.keys(fields).length) }
}

export function calculateDuplicateMetrics(records) {
  if (records.length === 0) return { duplicateRate: 0, exactDuplicates: 0, nearDuplicates: 0, uniqueRecords: 0, groups: [] }

  const urlSeen = {}
  const exactDups = []
  for (const r of records) {
    const key = r.url
    if (urlSeen[key]) { exactDups.push(r) }
    else { urlSeen[key] = true }
  }

  const phoneGroups = {}
  for (const r of records) {
    const clean = cleanPhone(r.phone, r.url || "", "GB")
    if (!clean) continue
    const key = clean.replace(/^0+/, "").slice(-10)
    if (!phoneGroups[key]) phoneGroups[key] = []
    phoneGroups[key].push(r)
  }
  const nearDups = Object.values(phoneGroups).filter(g => g.length >= 2)
  const nearDupCount = nearDups.reduce((s, g) => s + g.length - 1, 0)

  return {
    exactDuplicates: exactDups.length,
    nearDuplicates: nearDupCount,
    uniqueRecords: records.length - exactDups.length,
    duplicateRate: records.length > 0 ? Math.round(((exactDups.length + nearDupCount) / records.length) * 100) : 0,
    groups: nearDups.map(g => ({ phone: g[0].phone, count: g.length, urls: g.map(r => r.url) })),
  }
}

export function generateAuditSamples(records, sampleSize = 20) {
  if (records.length === 0) return []
  const shuffled = [...records].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(sampleSize, records.length)).map(r => ({
    url: r.url,
    title: r.title,
    extracted: {
      title: r.title || null,
      price: r.price || null,
      phone: r.phone || null,
      email: r.email || null,
      location: r.location || null,
      currency: r.currency || null,
    },
    validation: {
      hasTitle: !!(r.title && r.title !== "N/A"),
      hasPrice: cleanPrice(r.price) !== null,
      hasPhone: cleanPhone(r.phone, r.url || "", "GB") !== null,
      hasEmail: !!(r.email && r.email.trim()),
      hasLocation: !!(r.location && r.location.trim()),
      fieldCount: [cleanPrice(r.price) !== null, cleanPhone(r.phone, r.url || "", "GB") !== null, !!(r.title && r.title !== "N/A"), !!(r.email && r.email.trim()), !!(r.location && r.location.trim())].filter(Boolean).length,
    },
    completeness: Math.round([cleanPrice(r.price) !== null, cleanPhone(r.phone, r.url || "", "GB") !== null, !!(r.title && r.title !== "N/A"), !!(r.email && r.email.trim()), !!(r.location && r.location.trim())].filter(Boolean).length / 5 * 100),
  }))
}

export function calculateTrustScore(fieldAccuracy, duplicateMetrics, auditSamples, crawlStats = {}) {
  if (!fieldAccuracy || fieldAccuracy.total === 0) return { score: 0, explanation: "No data" }

  const fieldWeight = 0.40
  const dupPenalty = 0.20
  const auditWeight = 0.25
  const blockingWeight = 0.15

  const fieldComponent = fieldAccuracy.overallAccuracy * fieldWeight

  const dupScore = duplicateMetrics.duplicateRate > 50 ? 0
    : duplicateMetrics.duplicateRate > 30 ? 25
    : duplicateMetrics.duplicateRate > 15 ? 50
    : duplicateMetrics.duplicateRate > 5 ? 75
    : 100
  const dupComponent = dupScore * dupPenalty

  const auditPass = auditSamples.length > 0
    ? auditSamples.filter(s => s.completeness >= 40).length / auditSamples.length * 100
    : 0
  const auditComponent = auditPass * auditWeight

  const blocked = crawlStats.blockedPages || 0
  const attempted = crawlStats.linksAttempted || fieldAccuracy.total
  const blockRate = attempted > 0 ? blocked / attempted : 0
  const blockScore = blockRate > 0.5 ? 0 : blockRate > 0.3 ? 30 : blockRate > 0.1 ? 60 : blockRate > 0 ? 80 : 100
  const blockComponent = blockScore * blockingWeight

  const score = Math.round(fieldComponent + dupComponent + auditComponent + blockComponent)

  return {
    score,
    fieldComponent: Math.round(fieldComponent),
    dupComponent: Math.round(dupComponent),
    auditComponent: Math.round(auditComponent),
    blockComponent: Math.round(blockComponent),
    formula: "TS = fieldAccuracy(40%) + nonDupRate(20%) + auditPassRate(25%) + nonBlockRate(15%)",
    fieldWeight: 0.40,
    dupWeight: 0.20,
    auditWeight: 0.25,
    blockingWeight: 0.15,
    fieldAccuracy: fieldAccuracy.overallAccuracy,
    duplicateRate: duplicateMetrics.duplicateRate,
    auditPassRate: Math.round(auditPass),
    blockRate: Math.round(blockRate * 100),
    grade: score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F",
    color: score >= 75 ? "#16a34a" : score >= 50 ? "#ca8a04" : "#dc2626",
  }
}

export function generateSiteVerification(site, category, records, crawlStats = {}) {
  const fieldAccuracy = calculateFieldAccuracy(records)
  const duplicateMetrics = calculateDuplicateMetrics(records)
  const auditSamples = generateAuditSamples(records)
  const trustScore = calculateTrustScore(fieldAccuracy, duplicateMetrics, auditSamples, crawlStats)

  const blockedPages = crawlStats.blockedPages || 0
  const totalAttempted = crawlStats.linksAttempted || records.length
  const blockRate = totalAttempted > 0 ? Math.round((blockedPages / totalAttempted) * 100) : 0
  const extractionRate = records.length > 0 && totalAttempted > 0 ? Math.round((records.length / totalAttempted) * 100) : 0

  const hasEnoughData = records.length >= 5
  const hasGoodAccuracy = fieldAccuracy && fieldAccuracy.overallAccuracy >= 50
  const lowBlockRate = blockRate < 30

  let certification
  if (!hasEnoughData) certification = "UNVERIFIED"
  else if (blockRate >= 80) certification = "BLOCKED"
  else if (hasGoodAccuracy && lowBlockRate) certification = "CERTIFIED"
  else certification = "PARTIALLY_VERIFIED"

  return {
    site,
    category,
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    recordsAttempted: totalAttempted,
    certification,
    extractionRate,
    blockRate,
    fieldAccuracy,
    duplicates: duplicateMetrics,
    auditSampleSize: auditSamples.length,
    auditPassRate: auditSamples.length > 0
      ? Math.round(auditSamples.filter(s => s.completeness >= 40).length / auditSamples.length * 100)
      : 0,
    trustScore,
  }
}

export function loadCrawlRecords(jobId) {
  const fp = resolve(STATE_DIR, "records", `${jobId}.json`)
  if (!existsSync(fp)) return null
  return JSON.parse(readFileSync(fp, "utf8"))
}

export function listCrawlRecords() {
  const dir = resolve(STATE_DIR, "records")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""))
}

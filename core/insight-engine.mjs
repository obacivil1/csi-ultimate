import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_DIR = resolve(__dirname, "..", "state")
mkdirSync(STATE_DIR, { recursive: true })

const INSIGHTS_FILE = resolve(STATE_DIR, "insights.json")

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, "utf8")) } catch { return null }
}

function normalizePhone(p) {
  if (!p) return null
  return p.replace(/[\s\-\(\)]/g, "").replace(/^0+/, "").replace(/^\+44/, "0").slice(-10)
}

function normalizeCompany(name) {
  if (!name) return null
  return name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
}

export function generateInsights(records, site, category) {
  const insights = []
  const id = () => `insight_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  // ── 1. Duplicate Detection: same phone, same company, similar title ──
  const phoneGroups = {}
  for (const r of records) {
    const phone = normalizePhone(r.phone)
    if (!phone) continue
    if (!phoneGroups[phone]) phoneGroups[phone] = []
    phoneGroups[phone].push(r)
  }
  for (const [phone, group] of Object.entries(phoneGroups)) {
    if (group.length < 2) continue
    const companies = [...new Set(group.map(r => r.company || r.title?.split(" - ")[0]?.trim() || "Unknown").filter(Boolean))]
    const titles = [...new Set(group.map(r => r.title?.split(" - ")[0]?.trim() || "N/A"))]
    const priceRange = group.filter(r => r.price).map(r => r.price).join(", ")
    const totalPrice = group.filter(r => r.price).length
    insights.push({
      id: id(),
      type: "duplicate_listings",
      severity: group.length >= 5 ? "high" : group.length >= 3 ? "medium" : "low",
      title: `${group.length} listings share phone ${phone.slice(0, 5)}**** — possible bulk posting`,
      "so_what": (group.length >= 5
        ? (companies.length > 1
          ? companies.slice(0, 3).join(", ") + " appear to be the same entity"
          : (companies[0] || "Same entity") + " has flooded the platform with " + group.length + " nearly identical posts") + ". This suggests a single operator posting the same opportunity across multiple categories to maximize visibility, which may violate platform ToS and wastes searcher time."
        : companies.join(", ") + " posted " + group.length + " similar listings — may be legitimate multi-location posting but warrants a closer look."),
      evidence: group.map(r => r.url),
      count: group.length,
      companies,
      priceCoverage: `${totalPrice}/${group.length} have prices`,
      phone,
      avgPrice: totalPrice > 0 ? priceRange : "N/A",
    })
  }

  // ── 2. Missing critical fields ──
  const missingPrice = records.filter(r => !r.price)
  const missingPhone = records.filter(r => !r.phone)
  const missingEmail = records.filter(r => !r.email)
  const missingLocation = records.filter(r => !r.location)

  if (missingPrice.length > records.length * 0.3) {
    insights.push({
      id: id(),
      type: "missing_field",
      severity: missingPrice.length > records.length * 0.7 ? "high" : "medium",
      title: `${missingPrice.length}/${records.length} (${Math.round(missingPrice.length/records.length*100)}%) listings are missing price information`,
      "so_what": "Listings without prices require manual outreach to even qualify leads, increasing time-to-value by 3-5x. Focus on listings WITH prices for immediate ROI.",
      evidence: missingPrice.slice(0, 10).map(r => r.url),
      count: missingPrice.length,
      field: "price",
    })
  }

  if (missingEmail.length > records.length * 0.7) {
    insights.push({
      id: id(),
      type: "missing_field",
      severity: missingEmail.length === records.length ? "high" : "medium",
      title: `${missingEmail.length}/${records.length} (${Math.round(missingEmail.length/records.length*100)}%) listings are missing email contact`,
      "so_what": "Platforms increasingly hide email addresses to keep transactions on-site. Phone-based outreach is the default — ensure your team is prepared for voice calls, not just emails.",
      evidence: missingEmail.slice(0, 5).map(r => r.url),
      count: missingEmail.length,
      field: "email",
    })
  }

  // ── 3. Pricing anomalies ──
  const withPrice = records.filter(r => r.price && r.price.replace(/[,\s]/g, "").match(/^\d+$/))
  if (withPrice.length >= 3) {
    const prices = withPrice.map(r => parseInt(r.price.replace(/[,\s]/g, "")))
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length
    const sorted = [...prices].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const outliers = withPrice.filter(r => {
      const p = parseInt(r.price.replace(/[,\s]/g, ""))
      return p > median * 5 || p < median * 0.1
    })
    if (outliers.length > 0) {
      insights.push({
        id: id(),
        type: "price_anomaly",
        severity: outliers.length >= 3 ? "high" : "medium",
        title: `${outliers.length} listings have prices deviating significantly from median (${median} ${records[0]?.currency || ""})`,
        "so_what": outliers.length >= 3
          ? `Outliers may indicate data entry errors, premium scam listings, or genuinely high-value opportunities. Median price ${median} vs outlier range ${Math.min(...outliers.map(r => parseInt(r.price.replace(/[,\s]/g, ""))))}-${Math.max(...outliers.map(r => parseInt(r.price.replace(/[,\s]/g, ""))))}. Investigate before engaging.`
          : `Unusual pricing detected — median ${median} vs outlier ${outliers.map(r => `${r.title}: ${r.price}`).join(", ")}. May require human review.`,
        evidence: outliers.map(r => r.url),
        count: outliers.length,
        median,
        outlierPrices: outliers.map(r => ({ title: r.title, price: r.price, url: r.url })),
      })
    }
  }

  // ── 4. High-value records (phone + price + location) ──
  const highValue = records.filter(r => r.phone && r.price && r.location)
  if (highValue.length > 0) {
    insights.push({
      id: id(),
      type: "high_value",
      severity: "info",
      title: `${highValue.length}/${records.length} (${Math.round(highValue.length/records.length*100)}%) listings have phone + price + location — ready to engage`,
      "so_what": `These ${highValue.length} listings are fully actionable: you can call immediately with a qualified lead. Prioritize these for your sales team. No need to request additional information.`,
      evidence: highValue.slice(0, 15).map(r => r.url),
      count: highValue.length,
    })
  }

  // ── 5. Company concentration ──
  const companyMap = {}
  for (const r of records) {
    const c = normalizeCompany(r.company || r.title?.split(" - ")[0]?.trim() || r.title?.split(" at ")[1]?.trim() || "Unknown")
    if (!companyMap[c]) companyMap[c] = []
    companyMap[c].push(r)
  }
  const topCompanies = Object.entries(companyMap)
    .map(([name, list]) => ({ name, count: list.length, examples: list.slice(0, 3).map(r => r.title) }))
    .filter(c => c.name !== "Unknown" && c.count >= 3)
    .sort((a, b) => b.count - a.count)

  if (topCompanies.length > 0) {
    insights.push({
      id: id(),
      type: "concentration",
      severity: topCompanies[0]?.count > records.length * 0.3 ? "high" : "medium",
      title: `${topCompanies[0]?.name} accounts for ${topCompanies[0]?.count}/${records.length} (${Math.round(topCompanies[0]?.count/records.length*100)}%) of listings`,
      "so_what": `Heavy concentration by ${topCompanies.slice(0, 3).map(c => c.name).join(", ")} suggests these are either large-scale recruiters or spammers. ${topCompanies[0]?.count > 10 ? "This level of repetition may indicate auto-posting software or a single campaign flooding the category." : "Monitor these posters for quality — they may be your best sourcing partners or your biggest noise generators."}`,
      evidence: topCompanies.flatMap(c => c.examples.map((t, i) => companyMap[Object.keys(companyMap).find(k => companyMap[k][0]?.title === t)]?.[i]?.url).filter(Boolean)),
      count: topCompanies.length,
      topCompanies,
    })
  }

  // ── 6. Currency spread (for multi-currency sites) ──
  const currencies = [...new Set(records.map(r => r.currency).filter(Boolean))]
  if (currencies.length > 1) {
    insights.push({
      id: id(),
      type: "currency_spread",
      severity: "info",
      title: `Listings span ${currencies.length} currencies: ${currencies.join(", ")}`,
      "so_what": "Multi-currency listings on a single site may indicate international scammers or a truly global marketplace. Verify location before engaging.",
      evidence: records.filter(r => r.currency === currencies[0]).slice(0, 5).map(r => r.url),
      count: currencies.length,
      currencies,
    })
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    site,
    category,
    totalRecords: records.length,
    insightCount: insights.length,
    highSeverity: insights.filter(i => i.severity === "high").length,
    mediumSeverity: insights.filter(i => i.severity === "medium").length,
    lowSeverity: insights.filter(i => i.severity === "low").length,
    infoSeverity: insights.filter(i => i.severity === "info").length,
  }

  return { metadata, insights }
}

export function saveInsights(data) {
  writeFileSync(INSIGHTS_FILE, JSON.stringify(data, null, 2), "utf8")
  return INSIGHTS_FILE
}

export function loadInsights() {
  return readJSON(INSIGHTS_FILE) || { metadata: { generatedAt: null, insightCount: 0 }, insights: [] }
}

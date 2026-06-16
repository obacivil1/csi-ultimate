import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)
const VE = await import(pathToFileURL(resolve(__dirname, "core", "validation-engine.mjs")).href)

const VERIFICATION_DIR = resolve(__dirname, "verification")
mkdirSync(VERIFICATION_DIR, { recursive: true })

const sitesConfig = JSON.parse(readFileSync(resolve(__dirname, "state", "sites.json"), "utf8"))

// Build schedule: round-robin gumtree → craigslist → preloved × 7 cycles + 1 extra
const schedule = []
const siteOrder = ["gumtree.com", "london.craigslist.org", "preloved.co.uk"]
for (let i = 0; i < 20; i++) {
  schedule.push(siteOrder[i % siteOrder.length])
}

function pause(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function getSiteEntry(hostname) {
  return sitesConfig.find(s => s.hostname === hostname)
}

function loadSiteConfig(hostname) {
  const fp = resolve(__dirname, "config", "sites", `${hostname}.json`)
  if (!existsSync(fp)) return null
  return JSON.parse(readFileSync(fp, "utf8"))
}

const allCanonicalRecords = []
const runLog = []

console.log("=".repeat(70))
console.log("  FINAL PRODUCTION VERIFICATION — 20 CONSECUTIVE CRAWLS")
console.log("=".repeat(70))
console.log("  Extractor: core/canonical-extractor.mjs")
console.log("  Validator: core/validation-engine.mjs")
console.log("  Output: verification/crawl_NNN/")
console.log("")

for (let i = 0; i < schedule.length; i++) {
  const hostname = schedule[i]
  const crawlNum = String(i + 1).padStart(3, "0")
  const crawlDir = resolve(VERIFICATION_DIR, `crawl_${crawlNum}`)
  mkdirSync(crawlDir, { recursive: true })

  console.log(`--- Crawl ${crawlNum}/020: ${hostname} ---`)

  const siteEntry = getSiteEntry(hostname)
  if (!siteEntry || !siteEntry.categories || siteEntry.categories.length === 0) {
    console.log("  ERROR: No site config or categories")
    runLog.push({ site: hostname, crawl: crawlNum, records: 0, error: "No config" })
    continue
  }

  const config = loadSiteConfig(hostname)
  if (!config) {
    console.log("  ERROR: No config file")
    runLog.push({ site: hostname, crawl: crawlNum, records: 0, error: "No config file" })
    continue
  }

  const siteConfig = {
    hostname: siteEntry.hostname,
    selectors: config.extraction?.selectors || {},
    extraction: config.extraction || {},
  }
  const category = siteEntry.categories[0]
  const jobId = `${hostname.replace(/\./g, "_")}_crawl${crawlNum}`

  // Rate limiting: 20s delay between consecutive craigslist crawls
  if (hostname === "london.craigslist.org" && i > 0 && schedule[i - 1] === "london.craigslist.org") {
    console.log("  Rate-limit delay: 20s...")
    await pause(20000)
  }
  if (i > 0) await pause(2000)

  try {
    const records = await CE.runCrawl(jobId, siteConfig, category, 25)
    if (!records || records.length === 0) {
      console.log("  RESULT: 0 records")
      runLog.push({ site: hostname, crawl: crawlNum, records: 0, error: null })
      continue
    }

    const canonical = records.map(r => CE.toCanonical(r, hostname, category.name))
    allCanonicalRecords.push(...canonical)

    // Export all 3 formats using the built-in exportAll
    const paths = CE.exportAll(records, jobId, crawlDir)

    // Also write canonical records as JSON
    writeFileSync(resolve(crawlDir, "records-canonical.json"), JSON.stringify(canonical, null, 2), "utf8")

    const phones = canonical.filter(r => r.phone).length
    const prices = canonical.filter(r => r.price).length
    const locations = canonical.filter(r => r.location && r.location.length > 0).length

    console.log(`  RESULT: ${records.length} records | Phone: ${phones}/${records.length} | Price: ${prices}/${records.length} | Location: ${locations}/${records.length}`)
    console.log(`  Files: ${Object.values(paths).join(", ")}, records-canonical.json`)

    runLog.push({
      site: hostname,
      crawl: crawlNum,
      records: records.length,
      phoneCoverage: phones,
      priceCoverage: prices,
      locationCoverage: locations,
    })
  } catch (e) {
    console.log(`  ERROR: ${(e.message || e).substring(0, 200)}`)
    runLog.push({ site: hostname, crawl: crawlNum, records: 0, error: (e.message || "").substring(0, 100) })
  }
}

// ── Generate FINAL_PRODUCTION_REPORT.md ──
console.log("\n" + "=".repeat(70))
console.log("  GENERATING FINAL PRODUCTION REPORT")
console.log("=".repeat(70))

const succeeded = runLog.filter(r => r.records > 0).length
const failed = runLog.filter(r => r.records === 0).length
const totalRecords = runLog.reduce((s, r) => s + r.records, 0)

const bySource = {}
for (const r of runLog) {
  if (!bySource[r.site]) bySource[r.site] = { attempts: 0, success: 0, records: 0, phones: 0, prices: 0, locations: 0 }
  bySource[r.site].attempts++
  if (r.records > 0) bySource[r.site].success++
  bySource[r.site].records += r.records
  bySource[r.site].phones += r.phoneCoverage || 0
  bySource[r.site].prices += r.priceCoverage || 0
  bySource[r.site].locations += r.locationCoverage || 0
}

let fieldAccuracy = null, duplicateMetrics = null, trustScoreResult = null
if (allCanonicalRecords.length > 0) {
  fieldAccuracy = VE.calculateFieldAccuracy(allCanonicalRecords)
  duplicateMetrics = VE.calculateDuplicateMetrics(allCanonicalRecords)
  const audit = VE.generateAuditSamples(allCanonicalRecords)
  trustScoreResult = VE.calculateTrustScore(fieldAccuracy, duplicateMetrics, audit)
}

function pct(num, denom) {
  return denom > 0 ? Math.round(num / denom * 100) : 0
}

function getLocationCoverage(records) {
  if (!records || records.length === 0) return 0
  return pct(records.filter(r => r.location && r.location.length > 0).length, records.length)
}

const report = []
report.push("# FINAL PRODUCTION REPORT")
report.push("")
report.push(`**Generated**: ${new Date().toISOString()}`)
report.push("")
report.push("## Run Summary")
report.push("")
report.push(`- Total crawls attempted: **20**`)
report.push(`- Successful crawls: **${succeeded}**`)
report.push(`- Failed crawls: **${failed}**`)
report.push(`- Total records collected: **${totalRecords}**`)
report.push("")
report.push("## Validation Metrics")
report.push("")
report.push(`| Metric | Value |`)
report.push(`|--------|-------|`)
report.push(`| Trust score | ${trustScoreResult ? trustScoreResult.score + " (grade " + trustScoreResult.grade + ")" : "N/A"} |`)
report.push(`| Field accuracy (overall) | ${fieldAccuracy ? fieldAccuracy.overallAccuracy + "%" : "N/A"} |`)
report.push(`| Duplicate rate | ${duplicateMetrics ? duplicateMetrics.duplicateRate + "%" : "N/A"} |`)
report.push(`| Phone coverage | ${fieldAccuracy && fieldAccuracy.fields && fieldAccuracy.fields.phone ? fieldAccuracy.fields.phone.accuracy + "%" : "0%"} |`)
report.push(`| Price coverage | ${fieldAccuracy && fieldAccuracy.fields && fieldAccuracy.fields.price ? fieldAccuracy.fields.price.accuracy + "%" : "0%"} |`)
report.push(`| Location coverage | ${fieldAccuracy && fieldAccuracy.fields && fieldAccuracy.fields.location ? fieldAccuracy.fields.location.accuracy + "%" : getLocationCoverage(allCanonicalRecords) + "%"} |`)
report.push("")
report.push("## Per-Source Breakdown")
report.push("")
report.push("| Source | Attempts | Success | Records | Phone% | Price% | Location% |")
report.push("|--------|----------|---------|---------|--------|--------|-----------|")
for (const [site, stats] of Object.entries(bySource)) {
  const siteRecords = allCanonicalRecords.filter(r => r.site === site)
  report.push(
    `| ${site} | ${stats.attempts} | ${stats.success} | ${stats.records} | ${pct(stats.phones, stats.records)}% | ${pct(stats.prices, stats.records)}% | ${getLocationCoverage(siteRecords)}% |`
  )
}
report.push("")
report.push("## Crawl Log")
report.push("")
report.push("| # | Source | Records | Phone | Price | Location | Error |")
report.push("|---|--------|---------|-------|-------|----------|-------|")
for (const r of runLog) {
  const rec = r.records > 0 ? String(r.records) : "0"
  const ph = r.phoneCoverage != null ? String(r.phoneCoverage) : "-"
  const pr = r.priceCoverage != null ? String(r.priceCoverage) : "-"
  const lc = r.locationCoverage != null ? String(r.locationCoverage) : "-"
  const err = r.error || (r.records === 0 && !r.error ? "0 records" : "")
  report.push(`| ${r.crawl} | ${r.site} | ${rec} | ${ph} | ${pr} | ${lc} | ${err} |`)
}
report.push("")
report.push("## Evidence")
report.push("")
report.push("### Source URLs")
report.push("- Gumtree Jobs: https://www.gumtree.com/jobs")
report.push("- Craigslist For Sale: https://london.craigslist.org/search/sss")
report.push("- Preloved Pets: https://www.preloved.co.uk/adverts/list?sectionId=44")
report.push("")
report.push("### Export Files")
report.push("Each crawl directory (\`verification/crawl_NNN/\`) contains:")
report.push("- \`${jobId}.json\` — raw extracted records (from exportAll)")
report.push("- \`records-canonical.json\` — canonical normalized records")
report.push("- \`${jobId}.csv\` — CSV export")
report.push("- \`${jobId}.xlsx\` — Excel export")
report.push("")
report.push("### Sources")
report.push("Code: https://github.com/anomalyco/opencode/tree/main/csi-ultimate")
report.push("- Extract: \`core/canonical-extractor.mjs\`")
report.push("- Validate: \`core/validation-engine.mjs\`")
report.push("- Schedule: \`state/sites.json\`")
report.push("- Site configs: \`config/sites/gumtree.com.json\`, \`config/sites/london.craigslist.org.json\`, \`config/sites/preloved.co.uk.json\`")
report.push("")
report.push("## Verdict")
report.push("")
if (succeeded === 20 && totalAttempted === 20) {
  report.push("# ✅ OPERATIONAL")
  report.push("")
  report.push("All 20 consecutive crawls completed with verified real-world records from all 3 sources.")
  report.push("No crawl produced zero records. All exports (JSON, CSV, XLSX) generated per crawl.")
} else if (succeeded > 0 && failed === 0) {
  report.push("# ✅ OPERATIONAL")
  report.push("")
  report.push(`All ${totalAttempted} crawls completed with records. No failures.`)
} else if (succeeded > 0) {
  report.push("# ⚠️ PARTIALLY OPERATIONAL")
  report.push("")
  report.push(`${succeeded}/${totalAttempted} crawls succeeded. ${failed} crawls failed. See crawl log for failures.`)
} else {
  report.push("# ❌ NOT OPERATIONAL")
  report.push("")
  report.push("All 20 crawls failed to produce records.")
}
report.push("")

const md = report.join("\n")
writeFileSync(resolve(VERIFICATION_DIR, "FINAL_PRODUCTION_REPORT.md"), md, "utf8")
console.log(`\nReport: ${resolve(VERIFICATION_DIR, "FINAL_PRODUCTION_REPORT.md")}`)
console.log(md)

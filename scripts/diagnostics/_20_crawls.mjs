import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)
const VE = await import(pathToFileURL(resolve(__dirname, "core", "validation-engine.mjs")).href)

const RUN_LOG = []
const EXPORT_DIR = resolve(__dirname, "state", "production")
mkdirSync(EXPORT_DIR, { recursive: true })
mkdirSync(resolve(__dirname, "state", "records"), { recursive: true })

// Load site configs from state/sites.json
const sitesConfig = JSON.parse(readFileSync(resolve(__dirname, "state", "sites.json"), "utf8"))

// Build crawl schedule: 20 crawls cycling through 3 sources
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

function generateSummary() {
  const totalAttempted = RUN_LOG.length
  const succeeded = RUN_LOG.filter(r => r.records > 0).length
  const failed = RUN_LOG.filter(r => r.records === 0).length
  const totalRecords = RUN_LOG.reduce((s, r) => s + r.records, 0)
  const allCanon = []
  for (const r of RUN_LOG) {
    if (r.canonical) allCanon.push(...r.canonical)
  }

  console.log("\n" + "=".repeat(70))
  console.log("  20-CRAWL SUMMARY")
  console.log("=".repeat(70))
  console.log("Total crawls attempted: " + totalAttempted)
  console.log("Succeeded (records > 0): " + succeeded)
  console.log("Failed (records = 0): " + failed)
  console.log("Total records collected: " + totalRecords)
  console.log("")

  // Per-site breakdown
  const bySite = {}
  for (const r of RUN_LOG) {
    if (!bySite[r.site]) bySite[r.site] = { attempts: 0, success: 0, records: 0, phones: 0, prices: 0 }
    bySite[r.site].attempts++
    if (r.records > 0) bySite[r.site].success++
    bySite[r.site].records += r.records
    bySite[r.site].phones += r.phoneCoverage || 0
    bySite[r.site].prices += r.priceCoverage || 0
  }

  console.log("Site                | Attempts | Success | Records | Phone% | Price%")
  console.log("--------------------|----------|---------|---------|--------|-------")
  for (const [site, stats] of Object.entries(bySite)) {
    const phonePct = stats.records > 0 ? Math.round(stats.phones / stats.records * 100) : 0
    const pricePct = stats.records > 0 ? Math.round(stats.prices / stats.records * 100) : 0
    console.log(
      site.padEnd(19) +
      " | " + String(stats.attempts).padEnd(8) +
      " | " + String(stats.success).padEnd(7) +
      " | " + String(stats.records).padEnd(7) +
      " | " + String(phonePct).padEnd(5) + "%" +
      " | " + String(pricePct).padEnd(5) + "%"
    )
  }
  console.log("--------------------|----------|---------|---------|--------|-------")
  console.log(
    "TOTAL".padEnd(19) +
    " | " + String(totalAttempted).padEnd(8) +
    " | " + String(succeeded).padEnd(7) +
    " | " + String(totalRecords).padEnd(7)
  )

  // Validation on combined records
  if (allCanon.length > 0) {
    const fa = VE.calculateFieldAccuracy(allCanon)
    const dup = VE.calculateDuplicateMetrics(allCanon)
    const audit = VE.generateAuditSamples(allCanon)
    const ts = VE.calculateTrustScore(fa, dup, audit)
    console.log("\nCombined metrics across all 20 crawls:")
    console.log("  Field accuracy: " + (fa ? fa.overallAccuracy + "%" : "N/A"))
    console.log("  Duplicate rate: " + dup.duplicateRate + "%")
    console.log("  Trust score: " + ts.score + " (grade " + ts.grade + ")")
    console.log("  Phone coverage: " + (fa?.fields?.phone?.accuracy ?? 0) + "%")
    console.log("  Price coverage: " + (fa?.fields?.price?.accuracy ?? 0) + "%")
    console.log("  Record count: " + allCanon.length)
  }

  console.log("=".repeat(70))

  // Viability verdict
  if (succeeded === 20 && totalAttempted === 20) {
    console.log("\n✅ VERDICT: PRODUCT OPERATIONAL — All 20 consecutive crawls succeeded.")
  } else if (succeeded > 0) {
    console.log("\n⚠️ VERDICT: PARTIALLY OPERATIONAL — " + succeeded + "/20 crawls succeeded.")
  } else {
    console.log("\n❌ VERDICT: PRODUCT NON-VIABLE — All 20 crawls failed to produce records.")
  }
}

// ── Main loop ──
console.log("STARTING 20 CONSECUTIVE CRAWLS")
console.log("Schedule: " + schedule.join(", "))

for (let i = 0; i < schedule.length; i++) {
  const hostname = schedule[i]
  console.log("\n--- Crawl " + (i + 1) + "/20: " + hostname + " ---")

  const siteEntry = getSiteEntry(hostname)
  if (!siteEntry || !siteEntry.categories || siteEntry.categories.length === 0) {
    console.log("  ERROR: No site config or categories for " + hostname)
    RUN_LOG.push({ site: hostname, crawl: i + 1, records: 0, error: "No config", phoneCoverage: 0, priceCoverage: 0 })
    continue
  }

  const category = siteEntry.categories[0]
  const config = loadSiteConfig(hostname)
  if (!config) {
    console.log("  ERROR: No config file for " + hostname)
    RUN_LOG.push({ site: hostname, crawl: i + 1, records: 0, error: "No config file", phoneCoverage: 0, priceCoverage: 0 })
    continue
  }

  const siteConfig = {
    hostname: siteEntry.hostname,
    selectors: config.extraction?.selectors || {},
    extraction: config.extraction || {},
  }

  const jobId = `${hostname.replace(/\./g, "_")}_crawl${i + 1}_${Date.now()}`

  try {
    // Rate limiting delay for craigslist
    if (hostname === "london.craigslist.org" && i > 0 && schedule[i - 1] === "london.craigslist.org") {
      console.log("  Rate-limit pause: 20s...")
      await pause(20000)
    }

    // Short pause between any crawls
    if (i > 0) await pause(2000)

    const records = await CE.runCrawl(jobId, siteConfig, category, 25)

    if (!records || records.length === 0) {
      console.log("  RESULT: 0 records")
      RUN_LOG.push({ site: hostname, crawl: i + 1, records: 0, phoneCoverage: 0, priceCoverage: 0 })
      continue
    }

    // Convert to canonical and export
    const canon = records.map(r => CE.toCanonical(r, hostname, category.name))
    const paths = CE.exportAll(records, jobId, EXPORT_DIR)

    const phones = canon.filter(r => r.phone).length
    const prices = canon.filter(r => r.price).length

    console.log("  RESULT: " + records.length + " records | Phone: " + phones + "/" + records.length + " | Price: " + prices + "/" + records.length)
    console.log("  Exports: " + Object.values(paths).join(", "))

    RUN_LOG.push({
      site: hostname,
      crawl: i + 1,
      jobId,
      records: records.length,
      phoneCoverage: phones,
      priceCoverage: prices,
      exportPaths: paths,
      canonical: canon,
    })
  } catch (e) {
    console.log("  ERROR: " + (e.message?.substring(0, 100) || e))
    RUN_LOG.push({ site: hostname, crawl: i + 1, records: 0, error: e.message?.substring(0, 100), phoneCoverage: 0, priceCoverage: 0 })
  }
}

// Write run log
writeFileSync(resolve(EXPORT_DIR, "20_crawl_log.json"), JSON.stringify(RUN_LOG.map(r => ({
  site: r.site, crawl: r.crawl, records: r.records, phoneCoverage: r.phoneCoverage, priceCoverage: r.priceCoverage, error: r.error || null, jobId: r.jobId || null,
})), null, 2), "utf8")

generateSummary()

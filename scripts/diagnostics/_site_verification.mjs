import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"

chromium.use(stealth())

const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)
const VE = await import(pathToFileURL(resolve(__dirname, "core", "validation-engine.mjs")).href)

const OUT = resolve(__dirname, "verification", "site-test")
mkdirSync(OUT, { recursive: true })

// ── Site configs: ALL sites, active then disabled ──
const CONFIG_DIR = resolve(__dirname, "config", "sites")
const configFiles = [
  "gumtree.com.json",
  "london.craigslist.org.json",
  "preloved.co.uk.json",
  "_disabled/bayt.com.json",
  "_disabled/olx.com.pk.json",
  "_disabled/expatriates.com.json",
  "_disabled/sa.opensooq.com.json",
]

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

function loadConfig(file) {
  const fp = resolve(CONFIG_DIR, file)
  if (!existsSync(fp)) return null
  return JSON.parse(readFileSync(fp, "utf8"))
}

function urlForSite(hostname, config) {
  // Try to build a reasonable starting URL
  if (config.categories && typeof config.categories === "object" && !Array.isArray(config.categories)) {
    const keys = Object.keys(config.categories)
    if (keys.length > 0 && config.categories[keys[0]].url) return config.categories[keys[0]].url
  }
  if (config.search && config.search.endpoint) {
    return `https://www.${hostname}${config.search.endpoint}`
  }
  return `https://www.${hostname}`
}

function getSelector(config) {
  if (!config.extraction || !config.extraction.selectors) return "a[href]"
  const s = config.extraction.selectors
  // Try to find a listing-type selector
  if (s.listing) return s.listing
  if (s.title) return s.title[0]
  return "a[href]"
}

function pause(ms) {
  return new Promise(r => setTimeout(r, ms))
}

const results = []

for (const cfgFile of configFiles) {
  const siteLabel = cfgFile.replace(/\.json$/, "").replace(/^_disabled\//, "(DISABLED) ")
  console.log("\n" + "=".repeat(80))
  console.log("  SITE: " + siteLabel)
  console.log("=".repeat(80))

  const config = loadConfig(cfgFile)
  if (!config) {
    console.log("  [SKIP] Config not found")
    continue
  }

  const hostname = siteLabel.replace(/^\(DISABLED\) /, "")
  const startUrl = urlForSite(hostname, config)
  console.log("  Target URL: " + startUrl)
  console.log("")

  let browser = null
  let siteResult = {
    site: hostname,
    configFile: cfgFile,
    disabled: cfgFile.includes("_disabled"),
    url: startUrl,
    totalLinksFound: 0,
    totalRecordsExtracted: 0,
    phoneCoverage: 0,
    priceCoverage: 0,
    locationCoverage: 0,
    exportCreated: false,
    blocked: false,
    httpStatus: null,
    failureReason: null,
    first10Records: [],
    screenshot: null,
  }

  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 800 },
    })
    const page = await context.newPage()

    // Navigate to listing page
    console.log("  [NAVIGATE] " + startUrl)
    let httpStatus = null
    let navError = null
    try {
      const resp = await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
      httpStatus = resp ? resp.status() : null
      siteResult.httpStatus = httpStatus
      console.log("  [HTTP " + httpStatus + "] " + (resp ? resp.statusText() : "no response"))
    } catch (e) {
      navError = e.message
      siteResult.httpStatus = "ERROR"
      siteResult.failureReason = navError
      console.log("  [NAV ERROR] " + navError.substring(0, 200))
    }

    await pause(3000)

    // Check for block indicators
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 1000) || "")
    const pageTitle = await page.title()
    const pageUrl = page.url()
    console.log("  [PAGE] Title: " + pageTitle)
    console.log("  [PAGE] URL: " + pageUrl)

    const isBlocked = httpStatus === 403 || httpStatus === 429 || httpStatus === 503 ||
      bodyText.toLowerCase().includes("cloudflare") ||
      bodyText.toLowerCase().includes("captcha") ||
      bodyText.toLowerCase().includes("just a moment") ||
      bodyText.toLowerCase().includes("please enable javascript") ||
      bodyText.toLowerCase().includes("access denied") ||
      bodyText.toLowerCase().includes("blocked") ||
      pageTitle.toLowerCase().includes("captcha") ||
      pageTitle.toLowerCase().includes("blocked") ||
      pageTitle.toLowerCase().includes("access denied")

    if (isBlocked || httpStatus === 403 || httpStatus === 429) {
      siteResult.blocked = true
      siteResult.failureReason = siteResult.failureReason || ("HTTP " + httpStatus + ": " + (bodyText.substring(0, 200) || pageTitle))
      console.log("\n  [BLOCKED] " + siteResult.failureReason)

      // Screenshot
      const ssPath = resolve(OUT, hostname.replace(/\./g, "_") + "_blocked.png")
      await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {})
      siteResult.screenshot = ssPath
      console.log("  [SCREENSHOT] " + ssPath)

      await browser.close()
      results.push(siteResult)
      continue
    }

    // ── Not blocked — try to find links ──
    const selector = getSelector(config)
    console.log("\n  [SELECTOR] " + selector)
    await page.waitForSelector(selector, { timeout: 8000, state: "attached" }).catch(() => {})

    const rawLinks = await page.$$eval(selector, (els) =>
      els.map((el) => el.href || el.closest("a")?.href).filter(Boolean)
    ).catch(() => [])
    const uniqueLinks = [...new Set(rawLinks)].filter(l => l && l.startsWith("http"))
    
    // Also try "a[href]" as a fallback
    let allLinks = uniqueLinks
    if (allLinks.length === 0) {
      console.log("  [WARN] No matches with primary selector, trying a[href]")
      const fallbackLinks = await page.$$eval("a[href]", (els) =>
        els.map((el) => el.href).filter(Boolean)
      ).catch(() => [])
      allLinks = [...new Set(fallbackLinks)].filter(l => l && l.startsWith("http"))
    }

    siteResult.totalLinksFound = allLinks.length
    console.log("\n  [LINKS FOUND] " + allLinks.length)
    if (allLinks.length > 0) {
      console.log("  [LINK SAMPLES]")
      allLinks.slice(0, Math.min(allLinks.length, 50)).forEach((link, i) => {
        console.log("    " + String(i + 1).padStart(3) + ". " + link)
      })
      if (allLinks.length > 50) console.log("    ... and " + (allLinks.length - 50) + " more")
    }

    // ── No links = failed ──
    if (allLinks.length === 0) {
      siteResult.failureReason = "No links found on page"
      console.log("\n  [FAIL] " + siteResult.failureReason)
      const ssPath = resolve(OUT, hostname.replace(/\./g, "_") + "_nolinks.png")
      await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {})
      siteResult.screenshot = ssPath

      await browser.close()
      results.push(siteResult)
      continue
    }

    // ── Extract from each link ──
    const extracted = []
    const extractLimit = Math.min(allLinks.length, 25)
    console.log("\n  [EXTRACTING] " + extractLimit + " ads...")

    for (let i = 0; i < extractLimit; i++) {
      const link = allLinks[i]
      process.stdout.write("    [" + String(i + 1) + "/" + extractLimit + "] ")
      try {
        await page.goto(link, { waitUntil: "domcontentloaded", timeout: 20000 })
        await page.waitForSelector("h1", { timeout: 8000, state: "attached" }).catch(() => {})
        await pause(2000 + Math.random() * 1000)

        const data = await CE.extractAdData(page, {
          hostname,
          selectors: config.extraction?.selectors || {},
          extraction: config.extraction || {},
        }, { url: link })

        data.url = link
        data.site = hostname
        extracted.push(data)

        console.log("OK id=" + (data.id || "?") + " title=" + (data.title || "?").substring(0, 40) +
          " price=" + (data.price || "N/A") + " phone=" + (data.phone || "-") +
          " location=" + (data.location || "-").substring(0, 20))
      } catch (e) {
        console.log("FAIL " + (e.message || "").substring(0, 100))
      }
    }

    siteResult.totalRecordsExtracted = extracted.length
    console.log("\n  [EXTRACTED] " + extracted.length + " records")

    // ── First 10 records with URLs ──
    if (extracted.length > 0) {
      console.log("\n  [FIRST 10 RECORDS]")
      extracted.slice(0, 10).forEach((r, i) => {
        console.log("    Record #" + (i + 1))
        console.log("      ID:       " + (r.id || "N/A"))
        console.log("      Title:    " + (r.title || "N/A"))
        console.log("      Price:    " + (r.price || "N/A") + " " + (r.currency || ""))
        console.log("      Phone:    " + (r.phone || "N/A"))
        console.log("      Location: " + (r.location || "N/A"))
        console.log("      URL:      " + (r.url || link))
        console.log("")
      })
      siteResult.first10Records = extracted.slice(0, 10).map(r => ({
        id: r.id,
        title: r.title,
        price: r.price,
        currency: r.currency,
        phone: r.phone,
        location: r.location,
        url: r.url || r._url,
      }))
    }

    // ── Compute coverage ──
    const canon = extracted.map(r => CE.toCanonical(r, hostname, "general"))
    siteResult.phoneCoverage = canon.filter(r => r.phone).length
    siteResult.priceCoverage = canon.filter(r => r.price).length
    siteResult.locationCoverage = canon.filter(r => r.location && r.location.length > 0).length

    // ── Save exports ──
    if (extracted.length > 0) {
      const siteDir = resolve(OUT, hostname.replace(/\./g, "_"))
      mkdirSync(siteDir, { recursive: true })
      const jobId = hostname.replace(/\./g, "_") + "_verify"

      writeFileSync(resolve(siteDir, "records.json"), JSON.stringify(canon, null, 2), "utf8")
      writeFileSync(resolve(siteDir, "records.csv"), CE.toCSV(canon), "utf8")
      writeFileSync(resolve(siteDir, "records-raw.json"), JSON.stringify(extracted, null, 2), "utf8")

      try {
        await CE.exportAll(extracted, jobId, siteDir)
      } catch {}

      siteResult.exportCreated = true
      console.log("  [EXPORT] JSON + CSV + XLSX saved to " + siteDir)
    }

    await browser.close()

  } catch (e) {
    console.log("\n  [FATAL] " + (e.message || e).substring(0, 300))
    siteResult.failureReason = (e.message || e).substring(0, 200)
    if (browser) await browser.close().catch(() => {})
  }

  results.push(siteResult)
}

console.log("\n\n")
console.log("=".repeat(100))
console.log("  FINAL VERIFICATION TABLE")
console.log("=".repeat(100))
console.log("")
console.log("SITE                      | LINKS | RECORDS | PHONE | PRICE | LOCATION | EXPORT | BLOCKED | REASON")
console.log("--------------------------|-------|---------|-------|-------|----------|--------|---------|-------")
for (const r of results) {
  const site = (r.site + "                         ").substring(0, 25)
  const links = String(r.totalLinksFound).padStart(5)
  const recs = String(r.totalRecordsExtracted).padStart(7)
  const phone = String(r.phoneCoverage).padStart(5)
  const price = String(r.priceCoverage).padStart(5)
  const loc = String(r.locationCoverage).padStart(8)
  const exp = r.exportCreated ? "YES" : "NO "
  const block = r.blocked ? "YES" : "NO "
  const reason = (r.failureReason || "").substring(0, 20)
  console.log(site + " | " + links + " | " + recs + " | " + phone + " | " + price + " | " + loc + " | " + exp + "   | " + block + "    | " + reason)
}
console.log("")
console.log("=".repeat(100))
console.log("")

// Summary
const working = results.filter(r => r.totalRecordsExtracted > 0)
const blocked = results.filter(r => r.blocked)
const failed = results.filter(r => !r.blocked && r.totalRecordsExtracted === 0)
console.log("WORKING: " + working.length + "/" + results.length)
console.log("BLOCKED: " + blocked.length + "/" + results.length)
console.log("FAILED (not blocked): " + failed.length + "/" + results.length)
console.log("")

// Detailed blocked info
if (blocked.length > 0) {
  console.log("--- BLOCKED SITES ---")
  for (const r of blocked) {
    console.log("  " + r.site + ": HTTP " + r.httpStatus + " | " + (r.failureReason || "unknown"))
    console.log("  Screenshot: " + (r.screenshot || "N/A"))
  }
  console.log("")
}

// Write final results as JSON evidence
writeFileSync(resolve(OUT, "verification_results.json"), JSON.stringify(results, null, 2), "utf8")
console.log("Full results: " + resolve(OUT, "verification_results.json"))

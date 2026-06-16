import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { writeFileSync, existsSync, mkdirSync } from "fs"

chromium.use(stealth())

const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

// Planning Engineer keywords (English + Arabic)
const PLANNING_KEYWORDS = [
  "planning engineer", "مهندس تخطيط", "planner", "تخطيط",
  "planning eng", "plan. eng", "planning"
]

function isPlanningAd(title) {
  const t = title.toLowerCase()
  return PLANNING_KEYWORDS.some(kw => t.includes(kw.toLowerCase()))
}

function parseExpatDate(dateText) {
  if (!dateText) return null
  // Format: "Saturday, Jun 13, 2026, 10:51:26 PM"
  const match = dateText.match(/(\w+),?\s+(\w+)\s+(\d+),?\s+(\d{4})/)
  if (!match) return null
  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6,
    aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5, july: 6,
    august: 7, september: 8, october: 9, november: 10, december: 11
  }
  const month = months[match[2].toLowerCase()]
  if (month === undefined) return null
  return new Date(parseInt(match[4]), month, parseInt(match[3]))
}

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000
const now = new Date()

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-web-security"],
})
const ctx = await browser.newContext({
  userAgent: UA,
  viewport: { width: 1920, height: 1080 },
  locale: "en-US",
})
const page = await ctx.newPage()
await page.setExtraHTTPHeaders({
  "Accept-Language": "en-US,en;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
})

const siteConfig = {
  hostname: "expatriates.com",
  extraction: { adIdPattern: "/cls/(\\d+)", phoneRegion: "GCC" },
  selectors: {
    title: ["h1"],
    phone: ["a[href^='tel:']"],
    email: ["a[href^='mailto:']"],
    location: ["[class*='location']", "[class*='city']"],
    price: ["[class*='salary']", "[class*='price']"],
  },
}

// Pages to scan (0 = index.html, 100 = index100.html, etc.)
const PAGE_OFFSETS = [0, 100, 200, 300, 400, 500]
const MAX_PAGES = PAGE_OFFSETS.length
const PLANNING_ADS_PER_PAGE = {}
let totalAdsFound = 0
let planningAds = []  // { url, title, listingTitle }

console.log("=".repeat(70))
console.log("  Searching expatriates.com for Planning Engineer ads")
console.log("  Last 2 weeks: " + new Date(now.getTime() - TWO_WEEKS_MS).toLocaleDateString() + " to " + now.toLocaleDateString())
console.log("=".repeat(70))

for (let pi = 0; pi < MAX_PAGES; pi++) {
  const offset = PAGE_OFFSETS[pi]
  const pageUrl = offset === 0
    ? "https://www.expatriates.com/classifieds/riyadh/job-seekers/"
    : `https://www.expatriates.com/classifieds/riyadh/job-seekers/index${offset}.html`

  console.log("\n--- Page " + (pi + 1) + "/" + MAX_PAGES + " (offset " + offset + ") ---")
  console.log("  URL: " + pageUrl)

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
    await new Promise(r => setTimeout(r, 2000))
  } catch (e) {
    console.log("  ERROR loading page: " + e.message.substring(0, 60))
    break
  }

  const adLinks = await page.$$eval("a[href*='/cls/'][href$='.html']", els =>
    els.map(el => ({ href: el.href, text: el.innerText?.trim()?.substring(0, 120) }))
      .filter(a => a.href && a.text.length > 3)
  ).catch(() => [])

  console.log("  Ads on page: " + adLinks.length)
  if (adLinks.length === 0) break

  totalAdsFound += adLinks.length

  // Find planning-related ads
  const planningOnPage = adLinks.filter(a => isPlanningAd(a.text))
  console.log("  Planning-related: " + planningOnPage.length)
  PLANNING_ADS_PER_PAGE["page_" + pi] = planningOnPage.length

  planningOnPage.forEach(a => {
    planningAds.push({ url: a.href, listingTitle: a.text })
  })
}

console.log("\n" + "=".repeat(70))
console.log("  Total ads scanned: " + totalAdsFound)
console.log("  Total planning-related: " + planningAds.length)
console.log("=".repeat(70))

// Now open each planning ad, check date, and extract
const results = []

for (let i = 0; i < planningAds.length; i++) {
  const ad = planningAds[i]
  console.log("\n--- Ad " + (i + 1) + "/" + planningAds.length + " ---")
  console.log("  URL: " + ad.url.substring(0, 70))
  console.log("  Listing: " + ad.listingTitle.substring(0, 60))

  try {
    await page.goto(ad.url, { waitUntil: "domcontentloaded", timeout: 20000 })
    await new Promise(r => setTimeout(r, 2000))

    // Extract date
    const dateStr = await page.evaluate(() => {
      const body = document.body.innerText
      const match = body.match(/Posted:\s*(.+)/)
      return match ? match[1].trim() : null
    })

    const postDate = parseExpatDate(dateStr)
    const ageDays = postDate ? Math.round((now - postDate) / (24 * 60 * 60 * 1000)) : null

    console.log("  Posted: " + (dateStr || "N/A") + " (" + (ageDays !== null ? ageDays + " days ago" : "unknown") + ")")

    // Check if within 2 weeks
    if (postDate && (now - postDate) > TWO_WEEKS_MS) {
      console.log("  SKIPPED: older than 2 weeks")
      continue
    }

    // Extract full data
    const rawData = await CE.extractAdData(page, siteConfig, { url: ad.url })
    const canonical = CE.toCanonical(rawData, "expatriates.com", "Job Seekers")

    // Add date info
    canonical.postedDate = dateStr || ""
    canonical.daysAgo = ageDays !== null ? ageDays : -1

    results.push(canonical)
    console.log("  EXTRACTED ✓")
    console.log("    Title:    " + (canonical.title || "N/A").substring(0, 50))
    console.log("    Email:    " + (canonical.email || "N/A"))
    console.log("    Phone:    " + (canonical.phone || "N/A"))
    console.log("    Location: " + (canonical.location || "N/A"))
    console.log("    Price:    " + (canonical.price || "N/A"))

  } catch (e) {
    console.log("  ERROR: " + (e.message || "").substring(0, 80))
  }
}

await browser.close()

// Export results
const outputDir = resolve(__dirname, "output")
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

const label = "expatriates_planning_engineer_" + new Date().toISOString().split("T")[0]
const files = CE.exportAll(results, label, outputDir)

console.log("\n" + "=".repeat(70))
console.log("  RESULTS SUMMARY")
console.log("=".repeat(70))
console.log("  Planning ads found: " + planningAds.length)
console.log("  Within 2 weeks: " + results.length)
console.log("  Exported to:")
console.log("    JSON: " + files.json)
console.log("    CSV:  " + files.csv)
console.log("    XLSX: " + files.xlsx)
console.log("")

if (results.length > 0) {
  console.log("  ADS FOUND:")
  results.forEach((r, i) => {
    console.log("  " + (i + 1) + ". " + r.title.substring(0, 50))
    console.log("     Email: " + (r.email || "N/A") + " | Phone: " + (r.phone || "N/A"))
    console.log("     Posted: " + (r.postedDate || "N/A") + " | Location: " + (r.location || "N/A"))
  })
} else {
  console.log("  NO ADS FOUND within the last 2 weeks.")
  console.log("  Check if more pages need to be scanned or keywords expanded.")
}

console.log("\nDONE")

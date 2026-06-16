import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"

chromium.use(stealth())

const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

async function extractFromSite(name, listingUrl, waitMs, getAdLinks, siteConfig) {
  console.log("\n" + "=".repeat(70))
  console.log("  " + name)
  console.log("=".repeat(70))

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-web-security"],
  })
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  })
  const page = await ctx.newPage()
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  })

  await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, waitMs || 3000))

  // Scroll to trigger lazy loads
  await page.evaluate(() => window.scrollTo(0, 500))
  await new Promise(r => setTimeout(r, 1500))
  await page.evaluate(() => window.scrollTo(0, 1000))
  await new Promise(r => setTimeout(r, 1500))

  // Get ad links
  const adLinks = await getAdLinks(page)
  console.log("  Ad links found: " + adLinks.length)

  if (adLinks.length === 0) {
    console.log("  [NO ADS FOUND]")
    await browser.close()
    return { success: false, reason: "no_ads" }
  }

  adLinks.slice(0, 5).forEach((url, i) => {
    const short = url.length > 90 ? url.substring(0, 90) + "..." : url
    console.log("  " + (i+1) + ". " + short)
  })

  // Extract from first 3-5 ads
  const results = []
  for (let i = 0; i < Math.min(5, adLinks.length); i++) {
    const url = adLinks[i]
    console.log("\n  --- Ad " + (i+1) + " ---")
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })
      await new Promise(r => setTimeout(r, 2000))
      const adTitle = await page.title()
      console.log("  Page: " + adTitle.substring(0, 60))

      const data = await CE.extractAdData(page, siteConfig, { url })
      console.log("    ID:       " + (data.id || "N/A"))
      console.log("    Title:    " + (data.title || "N/A").substring(0, 50))
      console.log("    Price:    " + (data.price || "N/A"))
      console.log("    Phone:    " + (data.phone || "N/A"))
      console.log("    Email:    " + (data.email || "N/A"))
      console.log("    Location: " + (data.location || "N/A"))
      results.push(data)
    } catch (e) {
      console.log("  ERROR: " + (e.message || "").substring(0, 100))
    }
  }

  await browser.close()

  const successCount = results.filter(r => r && (r.title || r.id)).length
  console.log("\n  === SUMMARY: " + successCount + "/" + results.length + " ads extracted ===")
  return { success: successCount > 0, count: successCount, total: results.length }
}

// ═══ OLX.COM.PK ═══
await extractFromSite(
  "OLX.com.pk",
  "https://www.olx.com.pk/",
  5000,
  async (page) => {
    // Wait for ad cards to be visible
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 2000))
    // Extract links from article cards
    return await page.evaluate(() => {
      const seen = new Set()
      return Array.from(document.querySelectorAll("article a[href]"))
        .map(a => a.href)
        .filter(h => h && h.includes("/item/") && !seen.has(h) && seen.add(h))
    })
  },
  {
    hostname: "olx.com.pk",
    selectors: {
      title: ["h1", "[data-testid='ad-title']"],
      phone: ["a[href^='tel:']", "[class*='phone']"],
      email: ["a[href^='mailto:']"],
      location: ["[class*='location']", "[class*='_95eae']"],
      price: ["[class*='price']", "[data-testid='ad-price']"],
    },
    extraction: {
      phoneRegion: "PK",
      countryCodes: [92],
      currencies: ["PKR"],
      adIdPattern: "-iid-(\\d+)$",
    },
  }
)

// ═══ SA.OPENSOOQ.COM (Toyota cars) ═══
await extractFromSite(
  "OpenSooq.com (Toyota cars)",
  "https://sa.opensooq.com/en/cars/cars-for-sale/toyota",
  4000,
  async (page) => {
    // Wait for page to render
    await new Promise(r => setTimeout(r, 2000))
    return await page.evaluate(() => {
      const seen = new Set()
      return Array.from(document.querySelectorAll("a[href*='/en/search/']"))
        .map(a => a.href)
        .filter(h => {
          // Only numeric search IDs (individual ads), not category pages
          const match = h.match(/\/en\/search\/(\d+)/)
          return match && !seen.has(h) && seen.add(h)
        })
    })
  },
  {
    hostname: "sa.opensooq.com",
    selectors: {
      title: ["h1", "[class*='post-title']", "[class*='title']"],
      phone: ["a[href^='tel:']"],
      email: ["a[href^='mailto:']"],
      location: ["[class*='location']", "[class*='address']"],
      price: ["[class*='price']", "[class*='Price']"],
    },
    extraction: {
      phoneRegion: "SA",
      countryCodes: [966],
      currencies: ["SAR"],
      adIdPattern: "/search/(\\d+)",
    },
  }
)

console.log("\n\nDONE")

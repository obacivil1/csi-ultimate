import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"

chromium.use(stealth())

const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()

async function testSite(name, listingUrl, adSelector, adUrlTemplate, siteConfig) {
  console.log("\n" + "=".repeat(60))
  console.log("  " + name)
  console.log("=".repeat(60))

  // Step 1: Test listing page
  console.log("  [LISTING] " + listingUrl)
  const resp = await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 2000))
  const title = await page.title()
  console.log("  HTTP: " + (resp ? resp.status() : "null"))
  console.log("  Title: " + title.substring(0, 80))

  const isBlocked = title.toLowerCase().includes("just a moment") || title.toLowerCase().includes("captcha")
  if (isBlocked) {
    console.log("  [BLOCKED] Cloudflare challenge on listing page")
    return { blocked: true }
  }

  const links = await page.$$eval(adSelector, els =>
    els.map(el => ({ href: el.href, text: el.innerText?.trim()?.substring(0, 80) }))
      .filter(a => a.href && a.text.length > 0)
  )
  console.log("  Ad links: " + links.length)
  if (links.length === 0) {
    console.log("  [NO ADS] Selector didn't match any links")
    return { blocked: false, linksFound: 0 }
  }

  // Step 2: Test a few individual ads
  const testUrls = links.slice(0, 3).map(l => l.href)
  for (const url of testUrls) {
    console.log("\n  [AD] " + url)
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })
      await new Promise(r => setTimeout(r, 1500))
      const adTitle = await page.title()
      console.log("  Title: " + adTitle.substring(0, 80))

      const data = await CE.extractAdData(page, siteConfig, { url })
      console.log("    Title:    " + (data.title || "N/A").substring(0, 40))
      console.log("    Price:    " + (data.price || "N/A"))
      console.log("    Phone:    " + (data.phone || "N/A"))
      console.log("    Email:    " + (data.email || "N/A"))
      console.log("    Location: " + (data.location || "N/A"))
      console.log("    ID:       " + (data.id || "N/A"))
    } catch (e) {
      console.log("  ERROR: " + (e.message || "").substring(0, 100))
    }
  }

  return { blocked: false, linksFound: links.length }
}

// Test bayt.com
await testSite(
  "bayt.com",
  "https://www.bayt.com/en/jobs/",
  "a[href*='/en/job/'], a[href*='/job/']",
  null,
  {
    hostname: "bayt.com",
    selectors: {
      title: ["h1", ".job-title", "[class*='title']"],
      phone: ["a[href^='tel:']", "[class*='phone']"],
      email: ["a[href^='mailto:']"],
      location: ["[class*='location']", ".job-location", "[class*='Location']"],
      price: ["[class*='salary']", ".job-salary", "[class*='Salary']"],
    },
    extraction: { adIdPattern: "/(\\d+)", phoneRegion: "AE", countryCodes: [971], currencies: ["AED"] },
  }
)

// Test olx.com.pk
await testSite(
  "olx.com.pk",
  "https://www.olx.com.pk/",
  "a[href*='olx.com.pk/item']",
  null,
  {
    hostname: "olx.com.pk",
    selectors: {
      title: ["h1", "[class*='title']"],
      phone: ["a[href^='tel:']", "[class*='phone']"],
      email: ["a[href^='mailto:']"],
      location: ["[class*='location']", "[class*='_95eae']"],
      price: ["[class*='price']", "[class*='_95eae']"],
    },
    extraction: { phoneRegion: "PK", countryCodes: [92], currencies: ["PKR"] },
  }
)

// Test sa.opensooq.com
await testSite(
  "sa.opensooq.com",
  "https://sa.opensooq.com/en",
  "a[href*='/en/']:not([href='/en/'])",
  null,
  {
    hostname: "sa.opensooq.com",
    selectors: {
      title: ["h1", ".post-title", "[class*='title']"],
      phone: ["a[href^='tel:']", "[class*='phone']", "[class*='Phone']"],
      email: ["a[href^='mailto:']"],
      location: ["[class*='location']", ".post-address", "[class*='Location']"],
      price: ["[class*='price']", ".post-price", "[class*='Price']"],
    },
    extraction: { phoneRegion: "SA", countryCodes: [966], currencies: ["SAR"], adIdPattern: "[/-](\\d+)" },
  }
)

await browser.close()
console.log("\n\nALL TESTS COMPLETE")

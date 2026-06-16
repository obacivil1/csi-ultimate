import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"

chromium.use(stealth())

const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
})
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()

// Test individual ad pages
const adUrls = [
  "https://www.expatriates.com/cls/63470440.html",
  "https://www.expatriates.com/cls/63447876.html",
  "https://www.expatriates.com/cls/63404633.html",
]

const siteConfig = {
  hostname: "expatriates.com",
  selectors: {
    title: ["h1", ".ptitle", "[class*='title']"],
    phone: ["a[href^='tel:']", "[class*='phone']", "[class*='Phone']"],
    email: ["a[href^='mailto:']"],
    location: ["[class*='location']", "[class*='city']", "[class*='Location']"],
    price: ["[class*='price']", "[class*='salary']", "[class*='Price']"],
  },
  extraction: {
    phoneRegion: "SA",
    countryCodes: [966, 1],
    currencies: ["SAR", "USD"],
    adIdPattern: "/cls/(\\d+)",
  },
}

for (const url of adUrls) {
  console.log("\n" + "=".repeat(60))
  console.log("  URL: " + url)
  console.log("=".repeat(60))

  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })
    console.log("  HTTP: " + (resp ? resp.status() : "null"))

    // Check for Cloudflare
    const title = await page.title()
    console.log("  Title: " + title)

    if (title.toLowerCase().includes("just a moment") || title.toLowerCase().includes("captcha")) {
      console.log("  [BLOCKED] Cloudflare challenge detected")
      continue
    }

    await new Promise(r => setTimeout(r, 2000))

    // Show page content
    const body = await page.evaluate(() => document.body?.innerText?.substring(0, 1000) || "N/A")
    console.log("  Body preview: " + body.substring(0, 200))

    const data = await CE.extractAdData(page, siteConfig, { url })
    console.log("  Extracted:")
    console.log("    Title:    " + (data.title || "N/A"))
    console.log("    Price:    " + (data.price || "N/A") + " " + (data.currency || ""))
    console.log("    Phone:    " + (data.phone || "N/A"))
    console.log("    Email:    " + (data.email || "N/A"))
    console.log("    Location: " + (data.location || "N/A"))
    console.log("    ID:       " + (data.id || "N/A"))
    console.log("    Category: " + (data.category || "N/A"))
  } catch (e) {
    console.log("  ERROR: " + (e.message || "").substring(0, 150))
  }
}

// Also test the listing page with the correct selector
console.log("\n\n" + "=".repeat(60))
console.log("  TESTING LISTING PAGE WITH CORRECT SELECTOR")
console.log("=".repeat(60))

const listingUrl = "https://www.expatriates.com/classifieds/riyadh/job-seekers/"
await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 2000))
console.log("Title: " + (await page.title()))

// Use the correct selector for expatriates
const links = await page.$$eval("a[href*='/cls/'][href$='.html']", els =>
  els.map(el => ({ href: el.href, text: el.innerText?.trim()?.substring(0, 80) })).filter(a => a.text.length > 0)
)
console.log("Ad links found: " + links.length)
links.slice(0, 5).forEach((a, i) => console.log("  " + (i+1) + ". " + a.text + " -> " + a.href))

await browser.close()
console.log("\nDONE")

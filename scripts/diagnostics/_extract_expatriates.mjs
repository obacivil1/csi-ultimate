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

// Step 1: Visit classifieds listing
console.log("=== Visiting classifieds ===")
await page.goto("https://www.expatriates.com/classifieds/", { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 2000))
console.log("Title: " + (await page.title()))
console.log("URL: " + page.url())

// Find all links that look like individual ads
const allLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map(a => a.href)
    .filter(h => h && h.startsWith("http"))
)

// Look for individual ad detail links (not category pages)
const adLinks = allLinks.filter(h => {
  const path = h.replace("https://www.expatriates.com", "")
  // Individual ads typically have an ID pattern or deeper path
  // Exclude top-level category links
  return /classifieds\/[^\/]+\/[^\/]+\/[^\/]+/.test(h) && !h.endsWith("/")
})

console.log("\nAd links found: " + adLinks.length)
if (adLinks.length > 0) {
  adLinks.slice(0, 15).forEach((l, i) => console.log("  " + (i+1) + ". " + l))
} else {
  // Try to find individual ads — look for links with numbers or specific patterns
  const detailLinks = allLinks.filter(h => {
    const p = new URL(h).pathname
    return p.split("/").length >= 4 && !p.endsWith("/") && p.length > 30
  })
  console.log("Deep links (potential ads): " + detailLinks.length)
  detailLinks.slice(0, 15).forEach((l, i) => console.log("  " + (i+1) + ". " + l))
}

// Step 2: Try a specific location
console.log("\n\n=== Trying Riyadh classifieds ===")
await page.goto("https://www.expatriates.com/classifieds/riyadh/", { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 2000))
console.log("Title: " + (await page.title()))

const riyadhLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map(a => ({ href: a.href, text: a.innerText?.trim()?.substring(0, 80) }))
    .filter(a => !a.text.includes("Home") && !a.text.includes("Subscribe") && !a.text.includes("Contact") && a.href.startsWith("http"))
)

// Look for links that go to actual ads (not categories)
const actualAds = riyadhLinks.filter(a => {
  const path = a.href.replace("https://www.expatriates.com", "")
  // Individual ad patterns: has text content, path deeper than 3 levels
  return a.text.length > 10 && path.split("/").filter(Boolean).length >= 3
})

console.log("Potential ads in Riyadh: " + actualAds.length)
actualAds.slice(0, 10).forEach((a, i) => console.log("  " + (i+1) + ". " + a.text + " | " + a.href))

// Step 3: Try to extract from an ad page if we found one
if (actualAds.length > 0) {
  const adUrl = actualAds[0].href
  console.log("\n\n=== Extracting from: " + adUrl + " ===")
  await page.goto(adUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
  await new Promise(r => setTimeout(r, 2000))
  console.log("Title: " + (await page.title()))

  const data = await CE.extractAdData(page, {
    hostname: "expatriates.com",
    selectors: {
      title: ["h1", ".ptitle", "[class*='title']"],
      phone: ["a[href^='tel:']", "[class*='phone']"],
      email: ["a[href^='mailto:']"],
      location: ["[class*='location']", "[class*='city']"],
      price: ["[class*='price']"],
    },
    extraction: { phoneRegion: "US", countryCodes: [1], currencies: ["USD"] },
  }, { url: adUrl })

  console.log("Extracted:")
  Object.entries(data).forEach(([k, v]) => console.log("  " + k + ": " + (v ? String(v).substring(0, 100) : "null")))
}

await browser.close()

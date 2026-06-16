import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"
const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const context = await browser.newContext({
  userAgent: "Mozilla/5.0",
  viewport: { width: 1280, height: 800 }
})
const page = await context.newPage()

const category = {
  name: "Pets",
  url: "https://www.preloved.co.uk/adverts/list?sectionId=44",
  selector: "a[href*='/adverts/show/']",
}

console.time("listing")
await page.goto(category.url, { waitUntil: "domcontentloaded", timeout: 30000 })
console.timeEnd("listing")
console.log("Title:", await page.title())

const links = await page.$$eval(category.selector, els => 
  els.map(el => el.href || el.closest("a")?.href).filter(Boolean)
)
const unique = [...new Set(links)]
console.log(`Links: ${unique.length} unique from ${links.length} total`)

const link = unique[0]

// Test ad page with precise timings
console.log(`\nVisiting: ${link.substring(0, 80)}`)
console.time("goto")
await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30000 })
console.timeEnd("goto")
console.log("Title after goto:", await page.title())

// Check for h1
console.time("h1_wait")
try {
  const h1 = await page.waitForSelector("h1", { timeout: 15000, state: "attached" })
  console.timeEnd("h1_wait")
  if (h1) {
    const h1Text = await h1.textContent()
    console.log("h1 text:", h1Text?.substring(0, 50))
  }
} catch(e) {
  console.timeEnd("h1_wait")
  console.log("h1 not found:", e.message?.substring(0, 100))
}

// Check what title shows after 2 more seconds
console.time("wait2s")
await page.waitForTimeout(2000)
console.timeEnd("wait2s")
console.log("Title after +2s:", await page.title())

// Check loading state
const loading = await page.evaluate(() => document.title.includes("Loading"))
console.log("Still loading:", loading)

// Try extracting with the wait
console.time("extract")
const data = await CE.extractAdData(page, { hostname: "preloved.co.uk", selectors: { title: ["h1"], phone: ["a[href^='tel:']"], email: ["a[href^='mailto:']"], location: ["[class*='location']", "[class*='city']", ".classified__location"], price: [".classified__price", "[class*='price']", ".price"] }, extraction: { phoneRegion: "UK", countryCodes: [44], currencies: ["GBP", "EUR"], adIdPattern: "/(\\d+)/" } }, { url: link })
console.timeEnd("extract")
console.log("Data:", JSON.stringify(data, null, 2).substring(0, 300))

await browser.close()

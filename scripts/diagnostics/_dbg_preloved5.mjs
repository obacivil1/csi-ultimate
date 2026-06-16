import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"
const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } })
const page = await context.newPage()

const category = {
  name: "Pets",
  url: "https://www.preloved.co.uk/adverts/list?sectionId=44",
  selector: "a[href*='/adverts/show/']",
}
const config = {
  hostname: "preloved.co.uk",
  selectors: {
    title: ["h1", "[class*='title']"],
    phone: ["a[href^='tel:']", "[class*='phone']"],
    email: ["a[href^='mailto:']"],
    location: ["[class*='location']", "[class*='city']", ".classified__location"],
    price: [".classified__price", "[class*='price']", ".price"],
  },
  extraction: {
    phoneRegion: "UK",
    countryCodes: [44],
    currencies: ["GBP", "EUR"],
    adIdPattern: "/(\\d+)/",
  },
}

console.log("Step 1: Visit listing page")
await page.goto(category.url, { waitUntil: "domcontentloaded", timeout: 30000 })
await page.waitForSelector(category.selector, { timeout: 10000 })
const links = await page.$$eval(category.selector, els => 
  els.map(el => el.href || el.closest("a")?.href).filter(Boolean)
)
const unique = [...new Set(links)]
console.log(`Found ${unique.length} unique links from ${links.length} matches`)

for (let i = 0; i < Math.min(unique.length, 3); i++) {
  console.log(`Step 2.${i}: Visit ad page ${i+1}: ${unique[i].substring(0, 80)}`)
  try {
    await page.goto(unique[i], { waitUntil: "domcontentloaded", timeout: 15000 })
    console.log(`  Loaded: ${await page.title()}`)
    
    console.log("  Extracting...")
    const data = await CE.extractAdData(page, config, { url: unique[i] })
    console.log(`  Data: id=${data.id}, title=${data.title?.substring(0, 30)}, price=${data.price}, location=${data.location?.substring(0, 30)}`)
  } catch (e) {
    console.log(`  ERROR: ${e.message?.substring(0, 200)}`)
  }
}

await browser.close()
console.log("DONE")

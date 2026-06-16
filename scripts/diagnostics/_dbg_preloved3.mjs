import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

chromium.use(stealth())
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } })
const page = await context.newPage()

const config = JSON.parse(readFileSync(resolve(__dirname, "config", "sites", "preloved.co.uk.json"), "utf8"))

// Test direct ad page visit
const adUrl = "https://www.preloved.co.uk/adverts/show/123084717/celestial-parrotlets-celestial-parrotlets?link=search"
console.log("Visiting preloved ad:", adUrl)
try {
  await page.goto(adUrl, { waitUntil: "domcontentloaded", timeout: 15000 })
  await page.waitForTimeout(2000)
  console.log("Title:", await page.title())
  console.log("URL:", page.url())

  const siteCfg = {
    hostname: "preloved.co.uk",
    selectors: config.extraction.selectors || {},
    extraction: config.extraction || {},
  }
  const data = await CE.extractAdData(page, siteCfg, { url: adUrl })
  console.log("Extracted data:", JSON.stringify(data, null, 2))
} catch (e) {
  console.log("ERROR:", e.message?.substring(0, 200))
}

await browser.close()

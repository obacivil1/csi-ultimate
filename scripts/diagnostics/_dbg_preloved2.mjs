import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } })
const page = await context.newPage()

console.log("=== preloved.co.uk listing page ===")
await page.goto("https://www.preloved.co.uk/adverts/list?sectionId=44", { waitUntil: "domcontentloaded", timeout: 15000 })
await page.waitForTimeout(3000)

const title = await page.title()
console.log("Title:", title)
console.log("URL:", page.url())

const totalLinks = await page.evaluate(() => document.querySelectorAll("a[href]").length)
console.log("Total links:", totalLinks)

// Test the selector
const matchingLinks = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("a[href*='/adverts/show/']")).map(a => a.href).slice(0, 5)
})
console.log("Matching `a[href*='/adverts/show/']`:", matchingLinks.length)
if (matchingLinks.length > 0) {
  console.log("Samples:", JSON.stringify(matchingLinks))
} else {
  // Try to find any ad-like links
  const allHrefs = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map(a => a.href))
  const adLike = allHrefs.filter(h => h.includes("advert") || h.includes("show") || /\d{6,}/.test(h))
  console.log("Ad-like links:", JSON.stringify(adLike.slice(0, 10)))
  
  // Check body for redirect/block
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500))
  console.log("Body:", bodyText.substring(0, 300))
}

await browser.close()

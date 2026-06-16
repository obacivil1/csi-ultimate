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

// Visit a subcategory that should have individual ads
const categoryUrl = "https://www.expatriates.com/classifieds/riyadh/electronics/"
console.log("=== Visiting: " + categoryUrl + " ===")
await page.goto(categoryUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 2000))
console.log("Title: " + (await page.title()))

// Find all links
const allLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map(a => ({ href: a.href, text: a.innerText?.trim()?.substring(0, 100) }))
    .filter(a => a.href.startsWith("http") && a.text.length > 0)
)

// Identify individual ad links (not navigation)
const ads = allLinks.filter(a => {
  const p = a.href.replace("https://www.expatriates.com", "")
  // Skip navigation/utility links
  if (a.text.includes("Place an Ad") || a.text.includes("Home") || a.text.includes("Subscribe") || a.text.includes("Contact")) return false
  if (a.text === "Job Seekers" || a.text === "Items For Sale" || a.text === "Items Wanted") return false
  // Category links end with /
  if (a.href.endsWith("/") && !a.href.includes(".htm") && !a.href.includes(".epl")) return false
  // A real ad link should have meaningful text
  return a.text.length > 15
})

console.log("\nCategory links: " + allLinks.length)
console.log("Potential individual ads: " + ads.length)
ads.slice(0, 10).forEach((a, i) => console.log("  " + (i+1) + ". [" + a.text.substring(0, 60) + "] " + a.href))

// If no individual ads found in this category, try the main classified listing
if (ads.length === 0) {
  console.log("\n=== Trying main classifieds listings ===")
  // Look for listing pages (not category pages)
  const listingPages = allLinks.filter(a => {
    const p = a.href.replace("https://www.expatriates.com", "")
    return /\/classifieds\/[^\/]+\/[^\/]+\//.test(p) && !a.href.endsWith("/")
  })
  console.log("Listing-type pages: " + listingPages.length)
  
  // Try to find any page with individual ad listings
  // First let's try a job seekers page
  await page.goto("https://www.expatriates.com/classifieds/riyadh/job-seekers/", { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 2000))
  console.log("\nJob seekers page title: " + (await page.title()))
  
  const jobLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map(a => ({ href: a.href, text: a.innerText?.trim()?.substring(0, 100) }))
      .filter(a => a.href.startsWith("http"))
  )
  
  // Look for links with IDs (individual ad links)
  const individual = jobLinks.filter(a => /\d{5,}/.test(a.href) && a.text.length > 10)
  console.log("Individual job ads: " + individual.length)
  individual.slice(0, 10).forEach((a, i) => console.log("  " + (i+1) + ". " + a.text.substring(0, 60) + " | " + a.href))
  
  // If still nothing, show all links
  if (individual.length === 0) {
    console.log("\nAll job page links (first 15):")
    jobLinks.slice(0, 15).forEach((a, i) => console.log("  " + (i+1) + ". " + (a.text || "(no text)").substring(0, 50) + " -> " + a.href))
  }
}

await browser.close()

import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

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

console.log("=".repeat(70))
console.log("  STEP 1: Visit expatriates.com homepage")
console.log("=".repeat(70))

const resp = await page.goto("https://www.expatriates.com/", { waitUntil: "domcontentloaded", timeout: 30000 })
console.log("HTTP: " + (resp ? resp.status() : "null"))
console.log("Title: " + (await page.title()))
console.log("URL: " + page.url())
await new Promise(r => setTimeout(r, 2000))

// Check for blocks
const body = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "")
console.log("Body start: " + body.substring(0, 200))

// Find all links on the page
const allLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map(a => a.href)
    .filter(h => h && h.startsWith("http"))
)
console.log("\nTotal links: " + allLinks.length)

// Find classified/job links
const classifiedLinks = allLinks.filter(h =>
  h.includes("classified") || h.includes("/jobs/") || h.includes("/ads/") ||
  h.includes("/show/") || h.includes("/detail/") || h.includes("/listing/") ||
  h.includes("expatriates.com") && /\d{4,}/.test(h)
)
console.log("Classified-type links: " + classifiedLinks.length)
if (classifiedLinks.length > 0) {
  classifiedLinks.slice(0, 10).forEach((l, i) => console.log("  " + (i+1) + ". " + l))
} else {
  // Try to find any ad-like links
  const adLike = allLinks.filter(h => !h.includes("facebook") && !h.includes("twitter") && !h.includes("google") && h.includes("expatriates"))
  console.log("Expatriates internal links (sample):")
  adLike.slice(0, 20).forEach((l, i) => console.log("  " + (i+1) + ". " + l))
}

// Also check HTML structure
console.log("\n--- Page elements ---")
const headings = await page.evaluate(() =>
  Array.from(document.querySelectorAll("h1, h2, h3, h4")).map(h => h.tagName + ": " + h.innerText?.trim())
)
headings.slice(0, 10).forEach(h => console.log("  " + h))

// Check for classified/jobs sections
const sections = await page.evaluate(() => {
  const divs = Array.from(document.querySelectorAll("div[class*='classified'], div[class*='listing'], div[class*='job'], div[class*='ad'], div[class*='post'], div[class*='item'], div[class*='offer']"))
  return divs.length
})
console.log("Potential listing divs: " + sections)

// Try common classified URLs
console.log("\n" + "=".repeat(70))
console.log("  STEP 2: Try known classified sections")
console.log("=".repeat(70))

const sectionURLs = [
  "https://www.expatriates.com/classifieds/",
  "https://www.expatriates.com/jobs/",
  "https://www.expatriates.com/ads/",
]

for (const url of sectionURLs) {
  try {
    const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 })
    await new Promise(r2 => setTimeout(r2, 2000))
    const t = await page.title()
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map(a => a.href)
        .filter(h => h && h.startsWith("http") && !h.includes("facebook") && !h.includes("twitter"))
    )
    console.log("\n" + url)
    console.log("  HTTP: " + (r ? r.status() : "null"))
    console.log("  Title: " + t)
    console.log("  Internal links: " + links.length)
    if (links.length > 0) {
      links.slice(0, 5).forEach(l => console.log("    " + l))
    }
  } catch (e) {
    console.log("\n" + url + " - ERROR: " + e.message.substring(0, 100))
  }
}

await browser.close()
console.log("\nDONE")

import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()

// ─── BAYT.COM: Find actual job links ───
console.log("=".repeat(60))
console.log("  BAYT.COM — deep dive")
console.log("=".repeat(60))

await page.goto("https://www.bayt.com/en/jobs/", { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 5000)) // Wait for JS rendering

console.log("Title: " + (await page.title()))

// Check all links with "job" in them
const allLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map(a => a.href)
    .filter(h => h && h.includes("bayt.com"))
)
const jobLinks = allLinks.filter(h => h.includes("/job/") || h.includes("-job-") || /\d{6,}/.test(h))
console.log("Job-like links: " + jobLinks.length)
jobLinks.slice(0, 10).forEach((l, i) => console.log("  " + (i+1) + ". " + l))

// Try scrolling
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await new Promise(r => setTimeout(r, 3000))
const moreLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map(a => a.href)
    .filter(h => h && h.includes("bayt.com") && (h.includes("/job/") || /\d{5,}/.test(h)))
)
console.log("Job links after scroll: " + moreLinks.length)
moreLinks.slice(0, 10).forEach((l, i) => console.log("  " + (i+1) + ". " + l))

// Show all link patterns
const patterns = {}
for (const h of allLinks) {
  const p = h.replace(/https?:\/\/[^\/]+/, "").split("/").slice(0, 4).join("/")
  patterns[p] = (patterns[p] || 0) + 1
}
console.log("\nLink patterns:")
Object.entries(patterns).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([p, c]) => {
  if (c >= 2) console.log("  " + p + " (" + c + ")")
})

// ─── OLX.COM.PK: Find actual ad links ───
console.log("\n" + "=".repeat(60))
console.log("  OLX.COM.PK — deep dive")
console.log("=".repeat(60))

await page.goto("https://www.olx.com.pk/", { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 5000))
console.log("Title: " + (await page.title()))

const olxLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map(a => a.href)
    .filter(h => h && h.startsWith("http"))
)
console.log("Total links: " + olxLinks.length)
const itemLinks = olxLinks.filter(h => h.includes("/item/") || h.includes("/ad/") || /\d{8,}/.test(h))
console.log("Item links: " + itemLinks.length)
itemLinks.slice(0, 10).forEach((l, i) => console.log("  " + (i+1) + ". " + l))

// Show OLX internal patterns
const olxPatterns = {}
for (const h of olxLinks) {
  if (h.includes("olx")) {
    const p = h.replace(/https?:\/\/[^\/]+/, "").split("/").slice(0, 4).join("/")
    olxPatterns[p] = (olxPatterns[p] || 0) + 1
  }
}
console.log("\nOLX link patterns:")
Object.entries(olxPatterns).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([p, c]) => {
  if (c >= 2) console.log("  " + p + " (" + c + ")")
})

// ─── SA.OPENSOOQ.COM: Find actual ad links ───
console.log("\n" + "=".repeat(60))
console.log("  SA.OPENSOOQ.COM — deep dive")
console.log("=".repeat(60))

// Visit a subcategory
await page.goto("https://sa.opensooq.com/en/autos", { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))
console.log("Title: " + (await page.title()))

const osLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map(a => ({ href: a.href, text: a.innerText?.trim()?.substring(0, 60) }))
    .filter(a => a.href && a.href.startsWith("http") && !a.href.includes("facebook") && !a.href.includes("twitter"))
)
console.log("Total internal links: " + osLinks.length)

// Find links that look like individual ads (not categories)
const adLike = osLinks.filter(a => {
  const path = a.href.replace("https://sa.opensooq.com", "")
  // Individual ads typically have deeper paths with IDs
  return /\/en\/[^\/]+\/[^\/]+/.test(path) && path.split("/").filter(Boolean).length >= 3
})
console.log("Ad-like links: " + adLike.length)
adLike.slice(0, 10).forEach((a, i) => console.log("  " + (i+1) + ". " + a.text.substring(0, 40) + " | " + a.href))

// Show OpenSooq patterns
const osPatterns = {}
for (const a of osLinks) {
  const p = a.href.replace(/https?:\/\/[^\/]+/, "").split("/").slice(0, 5).join("/")
  osPatterns[p] = (osPatterns[p] || 0) + 1
}
console.log("\nOpenSooq link patterns:")
Object.entries(osPatterns).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([p, c]) => {
  if (c >= 2) console.log("  " + p + " (" + c + ")")
})

await browser.close()
console.log("\nDONE")

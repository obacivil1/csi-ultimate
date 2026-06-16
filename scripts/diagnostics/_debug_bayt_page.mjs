import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()

await page.goto("https://www.bayt.com/en/saudi-arabia/jobs/planning-engineer-jobs/", { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))

console.log("Title:", await page.title())
console.log("URL:", page.url())

// Get page structure
const struct = await page.evaluate(() => {
  const allElements = Array.from(document.querySelectorAll("*"))
  const classes = new Set()
  const ids = new Set()
  const tagCounts = {}
  allElements.forEach(el => {
    if (el.className && typeof el.className === "string") {
      el.className.split(/\s+/).forEach(c => { if (c && c.length > 2) classes.add(c) })
    }
    if (el.id) ids.add(el.id)
    tagCounts[el.tagName] = (tagCounts[el.tagName] || 0) + 1
  })
  return {
    tagCounts: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20),
    sampleClasses: Array.from(classes).filter(c => /job|card|title|company|employ|location/i.test(c)).slice(0, 30),
    ids: Array.from(ids).slice(0, 20),
    bodyStart: document.body?.innerText?.substring(0, 1000),
  }
})

console.log("Tags:", JSON.stringify(struct.tagCounts, null, 2))
console.log("Job-related classes:", JSON.stringify(struct.sampleClasses, null, 2))
console.log("IDs:", JSON.stringify(struct.ids, null, 2))
console.log("Body start:", struct.bodyStart)

// Check for actual job links
const jobLinks = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("a[href]"))
    .filter(a => a.href.includes("/job/") || a.href.includes("/jobs/"))
    .map(a => ({ text: a.innerText?.trim()?.substring(0, 80), href: a.href?.substring(0, 100), isVisible: a.offsetParent !== null }))
    .slice(0, 20)
})
console.log("\nJob links:", JSON.stringify(jobLinks, null, 2))

await browser.close()

import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

async function explore() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    viewport: { width: 1920, height: 1080 }
  })
  const page = await ctx.newPage()

  // Check main listing page structure
  await page.goto("https://www.expatriates.com/classifieds/riyadh/job-seekers/", { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))

  // Show all links to find pagination
  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a"))
      .map(a => ({ href: a.href, text: a.innerText?.trim()?.substring(0, 40) }))
      .filter(a => a.href)
  })

  // Find pagination links
  const pageLinks = allLinks.filter(l => /page=\d+|page\/\d+|\d{2,}/.test(l.href) && !l.href.includes("/cls/"))
  console.log("Pagination-like links:")
  pageLinks.slice(0, 10).forEach(l => console.log("  " + l.text + " -> " + l.href.substring(0, 80)))

  // Also look for "next" or page numbers
  const navTexts = allLinks.filter(l => /next|older|previous|newer|\d+|التالي|السابق/i.test(l.text))
  console.log("\nNavigation links:")
  navTexts.slice(0, 10).forEach(l => console.log("  \"" + l.text + "\" -> " + l.href.substring(0, 80)))

  // Check if there's a "last 2 weeks" filter
  const filterLinks = allLinks.filter(l => /week|day|month|hour|بحث|تصنيف/i.test(l.text))
  console.log("\nFilter links:")
  filterLinks.slice(0, 10).forEach(l => console.log("  \"" + l.text + "\" -> " + l.href.substring(0, 80)))

  // Also try the search URL on the main site (not cls subdomain)
  console.log("\n=== MAIN SITE SEARCH ===")
  await page.goto("https://www.expatriates.com/classifieds/search/planning+engineer", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 3000))
  console.log("URL: " + page.url())
  console.log("Title: " + (await page.title()).substring(0, 80))

  // Check a single ad for the date field
  console.log("\n=== SINGLE AD DATE CHECK ===")
  await page.goto("https://www.expatriates.com/cls/63475155.html", { waitUntil: "domcontentloaded", timeout: 20000 })
  await new Promise(r => setTimeout(r, 2000))

  const dateInfo = await page.evaluate(() => {
    // Find anything that looks like a date
    const body = document.body.innerText
    const dates = body.match(/\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/gi)
    const dates2 = body.match(/\d{1,2}\/\d{1,2}\/\d{4}/g)
    const dates3 = body.match(/\d{4}-\d{2}-\d{2}/g)
    return { dates: dates || [], dates2: dates2 || [], dates3: dates3 || [] }
  })
  console.log("Dates found: " + JSON.stringify(dateInfo))

  // Show posted/posted date element
  const posted = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"))
    return all
      .filter(el => /post|date|Posted|Date|added|Added|Published|published/i.test(el.innerText?.trim()?.substring(0, 20)))
      .map(el => el.innerText?.trim()?.substring(0, 80))
      .filter(Boolean)
      .slice(0, 10)
  })
  console.log("Posted/date elements: " + JSON.stringify(posted))

  await browser.close()
}
explore().catch(e => console.log("ERROR: " + e.message))

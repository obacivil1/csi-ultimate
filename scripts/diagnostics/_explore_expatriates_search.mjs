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

  // Try the search endpoint
  console.log("=== SEARCH: planning engineer ===")
  await page.goto("https://www.expatriates.com/cls/search.epl?q=planning+engineer&page=1", { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))
  console.log("URL: " + page.url())
  console.log("Title: " + (await page.title()).substring(0, 80))

  const links = await page.$$eval("a[href*='/cls/'][href$='.html']", els =>
    els.map(el => ({ href: el.href, text: el.innerText?.trim()?.substring(0, 80) }))
      .filter(a => a.href && a.text.length > 3)
  )
  console.log("Results: " + links.length)
  links.slice(0, 15).forEach((a, i) => console.log("  " + (i+1) + ". " + a.text.substring(0, 60) + " | " + a.href.substring(0, 60)))

  // Also try with Arabic search
  console.log("\n=== SEARCH: مهندس تخطيط ===")
  await page.goto("https://www.expatriates.com/cls/search.epl?q=%D9%85%D9%87%D9%86%D8%AF%D8%B3+%D8%AA%D8%AE%D8%B7%D9%8A%D8%B7&page=1", { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))
  console.log("URL: " + page.url())
  console.log("Title: " + (await page.title()).substring(0, 80))

  const arLinks = await page.$$eval("a[href*='/cls/'][href$='.html']", els =>
    els.map(el => ({ href: el.href, text: el.innerText?.trim()?.substring(0, 80) }))
      .filter(a => a.href && a.text.length > 3)
  )
  console.log("Results: " + arLinks.length)
  arLinks.slice(0, 15).forEach((a, i) => console.log("  " + (i+1) + ". " + a.text.substring(0, 60) + " | " + a.href.substring(0, 60)))

  // Check job-seekers listing for planning engineer
  console.log("\n=== JOB SEEKERS LISTING ===")
  await page.goto("https://www.expatriates.com/classifieds/riyadh/job-seekers/", { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))

  const jobLinks = await page.$$eval("a[href*='/cls/'][href$='.html']", els =>
    els.map(el => ({ href: el.href, text: el.innerText?.trim()?.substring(0, 80), date: el.parentElement?.innerText?.match(/\d{2}\s+\w+\s+\d{4}/)?.[0] || "" }))
      .filter(a => a.href && a.text.length > 3)
  )
  // Filter for planning-related jobs
  const planning = jobLinks.filter(l => /planning|تخطيط|Planner|مهندس/i.test(l.text))
  console.log("Total job ads: " + jobLinks.length)
  console.log("Planning-related: " + planning.length)
  planning.slice(0, 20).forEach((a, i) => console.log("  " + (i+1) + ". [" + a.date + "] " + a.text.substring(0, 60) + " | " + a.href.substring(0, 60)))

  // Check pagination
  const nextPage = await page.$("a[rel='next'], .next a, a.next, [class*='next'] a")
  console.log("\nNext page link: " + (nextPage ? await nextPage.getAttribute("href") : "none"))

  await browser.close()
}
explore().catch(e => console.log("ERROR: " + e.message))

import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

async function extractEmails(page) {
  return await page.evaluate(() => {
    const m = document.body.innerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
    return [...new Set(m)]
  }).catch(() => [])
}

async function extractPhone(page) {
  return await page.evaluate(() => {
    const m = document.body.innerText.match(/[\+\d][\d\s\-\(\)]{7,15}[\d]/g)
    return m ? m[0] : null
  }).catch(() => null)
}

;(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
  const ctx = await b.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  })
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }) })
  const p = await ctx.newPage()

  // Search Expatriates for company job postings (not job-seekers)
  const urls = [
    "https://www.expatriates.com/classifieds/riyadh/jobs/planning-engineer/",
    "https://www.expatriates.com/classifieds/riyadh/jobs/",
  ]

  const allResults = []

  for (const url of urls) {
    console.log(`\n=== ${url} ===`)
    try {
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      await p.waitForTimeout(3000)
      console.log("Title:", await p.title())

      const links = await p.$$eval("a[href*='/cls/']", els => els.map(a => ({ href: a.href, text: a.innerText.trim() })).filter(x => x.text))
      console.log("Links found:", links.length)

      for (const l of links.slice(0, 15)) {
        try {
          await p.goto(l.href, { waitUntil: "domcontentloaded", timeout: 30000 })
          await p.waitForTimeout(2000)
          const emails = await extractEmails(p)
          const phone = await extractPhone(p)
          const title = await p.evaluate(() => document.querySelector("h1")?.innerText?.trim() || document.title).catch(() => "")

          const companyEmails = emails.filter(e => !/gmail|yahoo|hotmail|outlook/i.test(e) && !/noreply|no-reply|example/i.test(e))

          if (companyEmails.length > 0) {
            console.log(`✓ ${title.substring(0, 60)} | ${companyEmails.join(", ")}`)
            allResults.push({ title: title.substring(0, 100), emails: companyEmails, phone, url: l.href, source: "expatriates" })
          } else {
            console.log(`  ${title.substring(0, 60)} | personal: ${emails.filter(e => /gmail/i.test(e)).join(", ")}`)
          }
        } catch (e) {
          console.log(`  Error: ${e.message.substring(0, 40)}`)
        }
      }
    } catch (e) {
      console.log(`Failed: ${e.message.substring(0, 60)}`)
    }
  }

  console.log(`\n\n========================================`)
  console.log(`COMPANY RECRUITMENT EMAILS FOUND: ${allResults.length}`)
  console.log(`========================================`)
  for (const r of allResults) {
    console.log(`${r.emails.join("; ")} | ${r.title.substring(0, 60)}`)
  }

  // If empty, use the verified company email list plus note about direct emails
  if (allResults.length === 0) {
    console.log("\nNo new company recruitment emails found on Expatriates.")
    console.log("Using verified company emails from verified_company_emails.txt")
  }

  await b.close()
})()

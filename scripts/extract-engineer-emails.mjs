import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { writeFileSync } from "fs"

chromium.use(stealth())

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 },
})
const page = await ctx.newPage()

const results = []
const seen = new Set()
const ENGINEER_KEYWORDS = /engineer|مهندس|planning|project manager|site engineer|civil|mechanical|electrical|structural|qa.?qc|hse|safety|construction|architect|surveyor|supervisor|foreman|technician/i
const EXCLUDED = /accountant|driver|cook|cleaner|sales|cashier|barista|waiter|receptionist|secretary|hr\b|nurse|doctor|teacher|chef|guard|helper|tailor|butcher|baker/i

async function extractCategory(url, label) {
  console.log(`\n=== ${label}: ${url} ===`)
  for (let pg = 0; pg < 10; pg++) {
    const pageUrl = pg === 0 ? url : url.replace(/\/?$/, `/index${pg * 100}.html`)
    console.log(`  Page ${pg + 1}...`)
    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
      await new Promise(r => setTimeout(r, 2000))
    } catch { break }

    const ads = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href*='/cls/']"))
        .map(a => ({ href: a.href, text: a.innerText?.trim() }))
        .filter(a => a.href && !a.href.includes("search.epl") && a.text?.length > 5)
    )
    if (ads.length === 0) break

    const engineering = ads.filter(a => ENGINEER_KEYWORDS.test(a.text) && !EXCLUDED.test(a.text))
    console.log(`    Ads: ${ads.length}, Engineering: ${engineering.length}`)

    for (const ad of engineering) {
      if (seen.has(ad.href)) continue
      seen.add(ad.href)
      try {
        await page.goto(ad.href, { waitUntil: "domcontentloaded", timeout: 20000 })
        await new Promise(r => setTimeout(r, 1500))
        const data = await page.evaluate(() => {
          const body = document.body?.innerText || ""
          const dm = body.match(/Posted:\s*(.+)/)
          const emails = body.match(/[\w.-]+@[\w.-]+\.\w+/g) || []
          const phoneEl = document.querySelector("a[href^='tel:']")
          return {
            title: document.querySelector("h1")?.innerText?.trim() || "",
            dateText: dm ? dm[1].trim() : "",
            email: emails.find(e => !e.includes("expatriates.com") && !e.includes("example")) || "",
            phone: phoneEl?.href?.replace("tel:", "") || "",
            region: (body.match(/Region:\s*(.+)/) || [])[1]?.trim() || "",
            description: (body.split("Chat on WhatsApp")[1]?.split("Back Next")[0]?.trim() || "").substring(0, 300),
          }
        })
        if (data.email || data.phone) {
          results.push({
            title: data.title,
            email: data.email,
            phone: data.phone,
            region: data.region,
            date: data.dateText,
            url: ad.href,
            source: label,
          })
          console.log(`    ${data.email ? "✓" : " "} ${data.title?.substring(0, 50)} | ${data.email || data.phone}`)
        }
      } catch { }
    }

    const next = await page.evaluate(() => {
      const n = Array.from(document.querySelectorAll("a")).find(a => /next/i.test(a.innerText))
      return n?.href || null
    })
    if (!next) break
  }
}

await extractCategory("https://www.expatriates.com/classifieds/riyadh/job-seekers/", "Expatriates Job Seekers")

await browser.close()

// Deduplicate by email
const deduped = []
const seenEmail = new Set()
for (const r of results) {
  const key = r.email || r.phone || r.url
  if (!seenEmail.has(key)) { seenEmail.add(key); deduped.push(r) }
}

const output = { extractedAt: new Date().toISOString(), total: deduped.length, results: deduped }
const outPath = "data/engineer_emails.json"
writeFileSync(outPath, JSON.stringify(output, null, 2))

// Print CSV-ready format
console.log("\n\n=== EMAILS CSV ===")
console.log("Email\tPhone\tTitle\tRegion")
deduped.forEach(r => console.log(`${r.email || ""}\t${r.phone || ""}\t${r.title}\t${r.region || ""}`))

console.log(`\nTotal: ${deduped.length} engineers extracted`)
console.log(`محفوظ في: ${outPath}`)

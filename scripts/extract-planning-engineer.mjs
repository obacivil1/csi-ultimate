import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { writeFileSync } from "fs"

chromium.use(stealth())

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000
const CUTOFF = Date.now() - TWO_WEEKS_MS

function parseDate(text) {
  if (!text) return null
  const m = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
  // "Monday, Jun 15, 2026" or "Jun 15, 2026"
  let r = text.match(/(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/i)
  if (!r) r = text.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/)
  if (r) {
    const ms = r[1].substring(0, 3).toLowerCase()
    if (m[ms] !== undefined) return new Date(+r[3], m[ms], +r[2]).getTime()
  }
  // "15 June 2026"
  r = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/)
  if (r) {
    const ms = r[2].substring(0, 3).toLowerCase()
    if (m[ms] !== undefined) return new Date(+r[3], m[ms], +r[1]).getTime()
  }
  return null
}

async function extractFromCategory(categoryPath, ctx) {
  const page = await ctx.newPage()
  const results = []
  const seen = new Set()

  for (let pg = 0; pg < 10; pg++) {
    const pageUrl = pg === 0
      ? `https://www.expatriates.com/classifieds/${categoryPath}/`
      : `https://www.expatriates.com/classifieds/${categoryPath}/index${pg * 100}.html`

    console.log(`  --- Page ${pg + 1}: ${pageUrl} ---`)
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
    await new Promise(r => setTimeout(r, 2500))

    const ads = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href*='/cls/']"))
        .map(a => ({ href: a.href, text: a.innerText?.trim() }))
        .filter(a => a.href && !a.href.includes("search.epl") && !a.href.includes("poststep") && a.text?.length > 5)
    )

    if (ads.length === 0) { console.log("    No ads, stopping."); break }
    console.log(`    Ads: ${ads.length}`)

    const planning = ads.filter(a => /planning\s*(engineer|eng|مهندس)|planner.*engineer|مهندس.*تخطيط/i.test(a.text))
    console.log(`    Planning-related: ${planning.length}`)

    for (const ad of planning) {
      if (seen.has(ad.href)) continue
      seen.add(ad.href)
      try {
        await page.goto(ad.href, { waitUntil: "domcontentloaded", timeout: 20000 })
        await new Promise(r => setTimeout(r, 1500))
        const data = await page.evaluate(() => {
          const body = document.body?.innerText || ""
          const dm = body.match(/Posted:\s*(.+)/)
          return {
            title: document.querySelector("h1")?.innerText?.trim() || "",
            dateText: dm ? dm[1].trim() : "",
            phone: document.querySelector("a[href^='tel:']")?.href?.replace("tel:", "") || "",
            email: document.querySelector("a[href^='mailto:']")?.href?.replace("mailto:", "") || "",
            description: body.split("Chat on WhatsApp")[1]?.split("Back Next")[0]?.trim()?.substring(0, 1000) || "",
            region: (body.match(/Region:\s*(.+)/) || [])[1]?.trim() || "",
            category: (body.match(/Category:\s*(.+)/) || [])[1]?.trim() || "",
            postingId: (body.match(/Posting ID:\s*(\d+)/) || [])[1] || "",
          }
        })
        const ts = parseDate(data.dateText)
        const recent = ts && ts >= CUTOFF
        if (recent || !ts) {
          results.push({
            title: data.title, url: ad.href, phone: data.phone, email: data.email,
            description: data.description, category: data.category, region: data.region,
            postingId: data.postingId, date: data.dateText || "unknown", postedWithin2Weeks: !!recent,
          })
          console.log(`    ${recent ? "\u2713" : "?"} ${data.title?.substring(0, 50)} [${(data.dateText || "").substring(0, 25)}]`)
        }
      } catch (e) { console.log(`    \u2717 ${e.message?.substring(0, 80)}`) }
    }

    // Check for "Next" link
    const nextLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"))
      return links.find(a => /next/i.test(a.innerText))?.href || null
    })
    if (!nextLink) { console.log("    No next page, stopping."); break }
  }

  await page.close()
  return results
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 },
})

console.log("=== Category: job-seekers ===")
const jobSeekers = await extractFromCategory("job-seekers", ctx)

console.log("\n=== Category: jobs ===")
const jobsOffered = await extractFromCategory("jobs", ctx)

// Also try temp-jobs
console.log("\n=== Category: temp-jobs ===")
const tempJobs = await extractFromCategory("temp-jobs", ctx)

await browser.close()

const allResults = [...jobSeekers, ...jobsOffered, ...tempJobs]

// Deduplicate by email or postingId
const deduped = []
const dupKey = new Set()
for (const r of allResults) {
  const key = r.email || r.postingId || r.url
  if (!dupKey.has(key)) { deduped.push(r); dupKey.add(key) }
}

const output = {
  extractedAt: new Date().toISOString(),
  query: "Planning Engineer",
  source: "expatriates.com > job-seekers + jobs + temp-jobs",
  cutoffDate: new Date(CUTOFF).toISOString(),
  totalResults: deduped.length,
  results: deduped,
}
const outPath = "data/expat_planning_jobs.json"
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`\nDone. ${deduped.length} results saved to ${outPath}`)

if (deduped.length > 0) {
  console.log("\n=== RESULTS ===")
  deduped.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`)
    console.log(`   ${r.region ? r.region + " | " : ""}${r.phone ? r.phone + " | " : ""}${r.email}`)
    console.log(`   ${r.date}`)
    console.log(`   ${r.url}`)
    console.log()
  })
}

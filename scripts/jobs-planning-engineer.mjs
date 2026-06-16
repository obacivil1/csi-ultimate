import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { writeFileSync } from "fs"

chromium.use(stealth())

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 },
  locale: "en-US",
})
const page = await ctx.newPage()
const results = []
const seen = new Set()

// 1. Google search for Planning Engineer jobs in Saudi Arabia
console.log("=== Google Search ===")
const googleQuery = encodeURIComponent("Planning Engineer job Saudi Arabia 2026")
await page.goto(`https://www.google.com/search?q=${googleQuery}&tbs=qdr:w2`, { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))

const googleJobs = await page.evaluate(() => {
  // Try Google Jobs widget
  const jobCards = document.querySelectorAll("[class*='job-card'], [jsname*='job'], [class*='jobgrid']")
  if (jobCards.length > 0) {
    return Array.from(jobCards).map(card => ({
      title: card.querySelector("[class*='title']")?.innerText?.trim() || "",
      company: card.querySelector("[class*='company']")?.innerText?.trim() || "",
      location: card.querySelector("[class*='location']")?.innerText?.trim() || "",
      url: card.querySelector("a")?.href || "",
    })).filter(j => j.title)
  }
  // Fallback: regular search results
  const results = document.querySelectorAll("div.g, div[class*='search-result'], div[data-hveid]")
  return Array.from(results).map(r => {
    const a = r.querySelector("a[href^='http']")
    const title = r.querySelector("h3")?.innerText?.trim() || ""
    const snippet = r.querySelector("[class*='VwiC3b'], [class*='st'], [class*='snippet']")?.innerText?.trim() || ""
    if (!title || !a?.href) return null
    return { title, url: a.href, snippet: snippet.substring(0, 200) }
  }).filter(Boolean)
})

console.log(`  Google results: ${googleJobs.length}`)
googleJobs.forEach(j => {
  if (!seen.has(j.url)) {
    seen.add(j.url)
    results.push({ ...j, company: j.company || "", location: j.location || "", date: "", source: "Google Jobs" })
    console.log(`  ${results.length}. ${j.title?.substring(0, 70)}`)
  }
})

// 2. Google site-specific search
console.log("\n=== Google: site:bayt.com ===")
const baytQuery = encodeURIComponent("site:bayt.com \"planning engineer\" Saudi")
await page.goto(`https://www.google.com/search?q=${baytQuery}&tbs=qdr:w2`, { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))

const baytResults = await page.evaluate(() => {
  const results = document.querySelectorAll("div.g, div[class*='search-result']")
  return Array.from(results).map(r => {
    const a = r.querySelector("a[href^='http']")
    const title = r.querySelector("h3")?.innerText?.trim() || ""
    const snippet = r.querySelector("[class*='VwiC3b']")?.innerText?.trim() || ""
    const dateEl = r.querySelector("[class*='LEsW6e'], [class*='f']")
    if (!title || !a?.href) return null
    return { title, url: a.href, snippet: snippet.substring(0, 200), date: dateEl?.innerText?.trim() || "" }
  }).filter(Boolean)
})

console.log(`  Bayt results: ${baytResults.length}`)
baytResults.forEach(j => {
  if (!seen.has(j.url)) {
    seen.add(j.url)
    results.push({ ...j, company: "", location: "", source: "Google > Bayt" })
    console.log(`  ${results.length}. ${j.title?.substring(0, 70)}`)
  }
})

// 3. Google: site:linkedin.com
console.log("\n=== Google: site:linkedin.com ===")
const liQuery = encodeURIComponent("site:linkedin.com/jobs \"planning engineer\" Saudi")
await page.goto(`https://www.google.com/search?q=${liQuery}&tbs=qdr:w2`, { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))

const liResults = await page.evaluate(() => {
  const results = document.querySelectorAll("div.g, div[class*='search-result']")
  return Array.from(results).map(r => {
    const a = r.querySelector("a[href^='http']")
    const title = r.querySelector("h3")?.innerText?.trim() || ""
    const snippet = r.querySelector("[class*='VwiC3b']")?.innerText?.trim() || ""
    if (!title || !a?.href) return null
    return { title, url: a.href, snippet: snippet.substring(0, 200) }
  }).filter(Boolean)
})

console.log(`  LinkedIn results: ${liResults.length}`)
liResults.forEach(j => {
  if (!seen.has(j.url)) {
    seen.add(j.url)
    results.push({ ...j, company: "", location: "", date: "", source: "Google > LinkedIn" })
    console.log(`  ${results.length}. ${j.title?.substring(0, 70)}`)
  }
})

// 4. Google: site:naukrigulf.com OR site:gulftalent.com
console.log("\n=== Google: site:naukrigulf.com / gulftalent.com ===")
const ngQuery = encodeURIComponent("(site:naukrigulf.com OR site:gulftalent.com) \"planning engineer\" Saudi")
await page.goto(`https://www.google.com/search?q=${ngQuery}&tbs=qdr:w2`, { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))

const ngResults = await page.evaluate(() => {
  const results = document.querySelectorAll("div.g, div[class*='search-result']")
  return Array.from(results).map(r => {
    const a = r.querySelector("a[href^='http']")
    const title = r.querySelector("h3")?.innerText?.trim() || ""
    const snippet = r.querySelector("[class*='VwiC3b']")?.innerText?.trim() || ""
    if (!title || !a?.href) return null
    return { title, url: a.href, snippet: snippet.substring(0, 200) }
  }).filter(Boolean)
})

console.log(`  NaukriGulf/GulfTalent results: ${ngResults.length}`)
ngResults.forEach(j => {
  if (!seen.has(j.url)) {
    seen.add(j.url)
    results.push({ ...j, company: "", location: "", date: "", source: "Google > NaukriGulf/GulfTalent" })
    console.log(`  ${results.length}. ${j.title?.substring(0, 70)}`)
  }
})

await browser.close()

const output = { extractedAt: new Date().toISOString(), totalResults: results.length, results }
const outPath = "data/planning_engineer_jobs.json"
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`\nDone. ${results.length} results saved to ${outPath}`)

if (results.length > 0) {
  console.log("\n=== PLANNING ENGINEER JOB VACANCIES ===")
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`)
    if (r.company) console.log(`   Company: ${r.company}`)
    if (r.location) console.log(`   Location: ${r.location}`)
    console.log(`   ${r.source}`)
    console.log(`   ${r.url}`)
    if (r.snippet) console.log(`   ${r.snippet?.substring(0, 150)}`)
    console.log()
  })
}

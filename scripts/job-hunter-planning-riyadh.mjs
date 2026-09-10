import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { writeFileSync } from "fs"

chromium.use(stealth())

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const CUTOFF = Date.now() - SEVEN_DAYS_MS
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
const PLANNING_RE = /planning|تخطيط|schedul|planner|controls|مهندس تخطيط|شيتول|اكتشف|التخطيط/i
const BAD_EMAIL_RE = /yahoo|hotmail|outlook|expatriates\.(com|net)|noreply|no-reply|example|domain\.com|site\.com|\.png|\.jpg/i

function parseDate(text) {
  if (!text) return null
  const clean = text.replace(/\s+/g, " ").trim()
  let r = clean.match(/(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/i)
  if (!r) r = clean.match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/i)
  if (r) { const ms = r[1].substring(0,3).toLowerCase(); if (MONTHS[ms] !== undefined) return new Date(+r[3], MONTHS[ms], +r[2]).getTime() }
  r = clean.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/)
  if (r) { const ms = r[2].substring(0,3).toLowerCase(); if (MONTHS[ms] !== undefined) return new Date(+r[3], MONTHS[ms], +r[1]).getTime() }
  return null
}

function isRiyadh(text) {
  if (!text) return false
  return /riyadh|الرياض/i.test(text)
}

function validateEmail(e) {
  if (!e || typeof e !== "string") return false
  const em = e.trim()
  if (em.length < 6 || em.length > 254) return false
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(em)) return false
  if (BAD_EMAIL_RE.test(em)) return false
  return true
}

async function gotoRobust(page, url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 })
      await page.waitForTimeout(2_500)
      const cls = await page.evaluate(() => {
        const bodyLen = document.body.innerText.length
        const clsCount = Array.from(document.querySelectorAll("a")).filter(a => (a.href || "").includes("/cls/")).length
        return { bodyLen, clsCount }
      })
      if (cls.clsCount === 0) { await page.waitForTimeout(5_000); continue }
      return cls
    } catch (e) { await page.waitForTimeout(3_000) }
  }
  return null
}

const results = []
const seenEmail = new Set()
const seenLink = new Set()

function addResult(entry) {
  const emails = (entry.emails || []).filter(validateEmail)
  const uniq = [...new Set(emails.map(e => e.toLowerCase()))]
  if (!isRiyadh(entry.text || entry.title)) return
  if (entry.ts && entry.ts < CUTOFF) return
  if (seenLink.has(entry.url)) return
  seenLink.add(entry.url)
  uniq.forEach(e => seenEmail.add(e))
  entry.emails = uniq
  results.push(entry)
}

function isCompanyCategory(cat) {
  if (!cat) return true
  const c = String(cat).toLowerCase()
  if (c.includes("job seek")) return false
  return true
}

/* ============ Expatriates ============ */
async function scrapeExpatriates(ctx) {
  const page = await ctx.newPage()
  const collected = []
  for (const category of ["jobs", "temp-jobs"]) {
    for (let pg = 0; pg < 7; pg++) {
      const url = pg === 0
        ? `https://www.expatriates.com/classifieds/riyadh/${category}/`
        : `https://www.expatriates.com/classifieds/riyadh/${category}/index${pg * 100}.html`
      const ok = await gotoRobust(page, url)
      if (!ok) { console.log(`[expat] ${category} pg${pg + 1} failed`); continue }
      const cls = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a"))
          .filter(a => (a.href || "").includes("/cls/") && a.innerText.trim().length > 3)
          .map(a => ({ text: (a.innerText || "").replace(/\s+/g, " ").trim(), href: a.href }))
      ).catch(() => [])
      console.log(`[expat] ${category} pg${pg + 1}: ${cls.length} ads`)
      const planning = cls.filter(a => PLANNING_RE.test(a.text))
      collected.push(...planning)
      if (cls.length === 0) break
    }
  }

  const unique = []
  const seenHref = new Set()
  for (const a of collected) {
    if (!seenHref.has(a.href)) { seenHref.add(a.href); unique.push(a) }
  }
  console.log(`[expat] planning ads: ${unique.length}`)

  for (const ad of unique.slice(0, 25)) {
    try {
      const ok = await gotoRobust(page, ad.href, 2)
      if (!ok) continue
      const data = await page.evaluate(() => {
        const body = document.body?.innerText || ""
        const dm = body.match(/Posted:\s*(.+)/)
        const mailto = Array.from(document.querySelectorAll("a[href^='mailto:']")).map(a => (a.href.replace(/^mailto:\s*/i, "").split("?")[0]).trim())
        const tel = Array.from(document.querySelectorAll("a[href^='tel:']")).map(a => a.href.replace("tel:", ""))
        const regM = body.match(/Region:\s*(.+)/)
        const catM = body.match(/Category:\s*(.+)/)
        return {
          title: document.querySelector("h1")?.innerText?.trim() || "",
          dateText: dm ? dm[1].trim() : "",
          region: regM ? regM[1].trim() : (body.match(/riyadh|الرياض/i)?.[0] || ""),
          category: catM ? catM[1].trim() : "",
          body: body.substring(0, 1500),
          mailto,
          tel,
        }
      })
      const bodyEmails = (data.body.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])
      const emails = data.mailto.length > 0 ? data.mailto : bodyEmails
      const ts = parseDate(data.dateText)
      if (!isCompanyCategory(data.category) && emails.some(e => /gmail|yahoo|hotmail|outlook/.test(e))) continue
      addResult({
        title: data.title,
        text: data.title + " " + data.body,
        region: data.region,
        emails,
        ts,
        date: data.dateText,
        url: ad.href,
        source: "Expatriates",
        phones: data.tel,
        category: data.category,
      })
      console.log(`  ${data.title?.substring(0, 60) || "(no h1)"} | ${emails.length > 0 ? emails.join("; ") : "no emails"} | ${data.region || "?"}`)
    } catch (e) { console.log(`  err: ${e.message?.substring(0, 50)}`) }
  }
  await page.close()
}

/* ============ Bayt ============ */
async function scrapeBayt(ctx) {
  const page = await ctx.newPage()
  const url = "https://www.bayt.com/en/saudi-arabia/jobs/planning-engineer-jobs/"
  console.log(`[bayt] ${url}`)
  let ok = false
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      await page.waitForTimeout(4000)
      const body = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "")
      if (/(checking your browser|captcha|cloudflare|enable javascript)/i.test(body)) {
        console.log(`[bayt] blocked (try ${attempt + 1})`)
        await page.waitForTimeout(5000)
        continue
      }
      ok = true
    } catch (e) {
      console.log(`[bayt] err try ${attempt + 1}: ${e.message?.substring(0, 50)}`)
      await page.waitForTimeout(4000)
    }
  }
  if (!ok) { await page.close(); return }

  const jobs = await page.evaluate(() => {
    const out = []
    for (const card of document.querySelectorAll("a, article, li")) {
      const a = card.tagName === "A" ? card : card.querySelector("a")
      if (!a || !a.href) continue
      const title = (a.getAttribute("title") || a.innerText?.split("\n")[0] || "").trim()
      if (title.length > 4 && /planning|schedul|controls/i.test(title) && a.href.includes("/jobs/")) out.push({ title, href: a.href })
    }
    const seen = new Set()
    return out.filter(i => !seen.has(i.href) && seen.add(i.href)).slice(0, 15)
  }).catch(() => [])
  console.log(`  listings: ${jobs.length}`)
  for (const j of jobs) {
    try {
      await page.goto(j.href, { waitUntil: "domcontentloaded", timeout: 25000 })
      await page.waitForTimeout(2000)
      const data = await page.evaluate(() => {
        const body = document.body?.innerText || ""
        const locM = body.match(/location[:\s]*([^\n]+)/i)
        const dateM = body.match(/(?:posted|date)[:\s]*([^\n]{2,60})/i)
        return { text: body.substring(0, 2200), loc: locM?.[1]?.trim() || "", dateText: dateM?.[1]?.trim() || "" }
      })
      const emails = (data.text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []).filter(e => validateEmail(e))
      addResult({ title: j.title, text: j.title + " " + data.text, region: data.loc || j.title, emails, ts: parseDate(data.dateText), date: data.dateText, url: j.href, source: "Bayt" })
      if (emails.length) console.log(`  ${j.title.substring(0, 60)} | ${emails.join("; ")}`)
    } catch { /* continue */ }
  }
  await page.close()
}

/* ============ Indeed ============ */
async function scrapeIndeed(ctx) {
  const page = await ctx.newPage()
  const url = "https://sa.indeed.com/jobs?q=planning+engineer&l=Riyadh&fromage=7"
  console.log(`[indeed] ${url}`)
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(3500)
  } catch (e) { console.log(`[indeed] err: ${e.message?.substring(0, 60)}`); await page.close(); return }
  const body = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => "")
  if (/(checking your browser|captcha|cloudflare|access denied|enable javascript)/i.test(body)) { console.log("[indeed] blocked"); await page.close(); return }

  const jobs = await page.evaluate(() => {
    const out = []
    for (const a of document.querySelectorAll("a")) {
      const href = a.href || ""
      const title = (a.getAttribute("title") || a.innerText?.trim() || "")
      if ((href.includes("rc/clk") || href.includes("/viewjob") || href.includes("jk=")) && /planning|schedul|controls|تخطيط/i.test(title)) {
        out.push({ title, href })
      }
    }
    const seen = new Set()
    return out.filter(i => !seen.has(i.href) && seen.add(i.href)).slice(0, 15)
  }).catch(() => [])
  console.log(`  listings: ${jobs.length}`)
  for (const j of jobs) {
    try {
      await page.goto(j.href, { waitUntil: "domcontentloaded", timeout: 25000 })
      await page.waitForTimeout(1800)
      const data = await page.evaluate(() => {
        const body = document.body?.innerText || ""
        const locM = body.match(/location[:\s]*([^\n]+)/i)
        return { text: body.substring(0, 2200), loc: locM?.[1]?.trim() || "" }
      })
      const emails = (data.text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []).filter(e => validateEmail(e))
      addResult({ title: j.title, text: j.title + " " + data.text, region: data.loc || j.title, emails, ts: null, date: "", url: j.href, source: "Indeed" })
      if (emails.length) console.log(`  ${j.title.substring(0, 60)} | ${emails.join("; ")}`)
    } catch { /* continue */ }
  }
  await page.close()
}

/* ============ Google site-targeted search ============ */
async function scrapeGoogleSites(ctx) {
  const page = await ctx.newPage()
  const queries = [
    { site: "site:gulftalent.com", q: "gulftalent.com planning engineer riyadh" },
    { site: "site:naukrigulf.com", q: "naukrigulf.com planning engineer riyadh" },
    { site: "site:bayt.com", q: "bayt.com planning engineer riyadh saudi" },
  ]
  for (const { site, q } of queries) {
    const gq = encodeURIComponent(`${site} planning engineer riyadh`)
    const url = `https://www.google.com/search?q=${gq}&tbs=qdr:w1`
    console.log(`[gsearch] ${site}`)
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      await page.waitForTimeout(3500)
    } catch (e) { console.log(`  err: ${e.message?.substring(0, 60)}`); continue }
    const body = await page.evaluate(() => document.body.innerText.slice(0, 150)).catch(() => "")
    if (/(unusual traffic|captcha|enable javascript)/i.test(body)) { console.log("  blocked"); continue }
    const results = await page.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll("div.g, div[data-hveid], div[class*='search']")) {
        const a = el.querySelector("a[href^='http']")
        const h3 = el.querySelector("h3")
        if (!a || !h3) continue
        const href = a.href
        const title = h3.innerText.trim()
        const path = href.match(/gulftalent\.com\/[^\s&]+|naukrigulf\.com\/[^\s&]+|bayt\.com\/[^\s&]+/)?.[0] || href.substring(0, 80)
        out.push({ title, href, path })
      }
      const seen = new Set()
      return out.filter(i => i.title && /planning|schedul|controls|تخطيط/i.test(i.title) && !seen.has(i.href) && seen.add(i.href)).slice(0, 8)
    }).catch(() => [])
    console.log(`  links: ${results.length}`)
    for (const r of results) {
      try {
        await page.goto(r.href, { waitUntil: "domcontentloaded", timeout: 25000 })
        await page.waitForTimeout(2500)
        if (/(checking your browser|captcha)/i.test(await page.evaluate(() => document.body.innerText.slice(0, 120)).catch(() => ""))) continue
        const data = await page.evaluate(() => {
          const body = document.body?.innerText || ""
          const emails = body.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []
          const locM = body.match(/riyadh|الرياض/i)
          const dateM = body.match(/(?:posted|date|published)[:\s]*([^\n]{2,50})/i)
          return { text: body.substring(0, 2200), hasRiyadh: !!locM, dateText: dateM?.[1]?.trim() || "", emails }
        })
        const emails = [...new Set(data.emails)].filter(e => validateEmail(e))
        addResult({ title: r.title, text: r.title + " " + data.text, region: data.hasRiyadh ? "Riyadh" : "", emails, ts: parseDate(data.dateText), date: data.dateText, url: r.href, source: "Google > " + site })
        if (data.hasRiyadh && emails.length) console.log(`  ${r.title.substring(0, 60)} | ${emails.join("; ")}`)
      } catch { /* continue */ }
    }
  }
  await page.close()
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 },
  locale: "en-US",
})

console.log("\n===== EXPATRIATES =====")
await scrapeExpatriates(ctx)
console.log("\n===== BAYT =====")
await scrapeBayt(ctx)
console.log("\n===== INDEED =====")
await scrapeIndeed(ctx)
console.log("\n===== GOOGLE SITES =====")
await scrapeGoogleSites(ctx)
await browser.close()

const output = { extractedAt: new Date().toISOString(), query: "Planning Engineer | Riyadh | last 7 days", cutoff: new Date(CUTOFF).toISOString(), total: results.length, results }
const outPath = "data/job_hunter_riyadh_planning.json"
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`\nSaved: ${outPath} (${results.length} entries)`)

console.log("\n===== RESULTS =====")
for (const r of results) {
  console.log(`${r.title?.substring(0, 80)}`)
  console.log(`  ${r.source} | ${r.region || "?"} | ${r.date}`)
  if (r.emails.length) console.log(`  EM: ${r.emails.join("; ")}`)
  console.log(`  ${r.url}`)
}

const withEmail = results.filter(r => r.emails.length > 0)
console.log(`\n===== EMAILS (${withEmail.length} jobs) =====`)
console.log(withEmail.map(r => r.emails.join("; ")).filter(Boolean).join("; "))
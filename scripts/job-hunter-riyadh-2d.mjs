import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { writeFileSync } from "fs"
import { resolveMx } from "node:dns/promises"
import { execSync } from "child_process"

chromium.use(stealth())

const DAYS = 2
const CUTOFF = Date.now() - DAYS * 24 * 60 * 60 * 1000
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
const PLANNING_RE = /planning|تخطيط|schedul|planner|controls|مهندس تخطيط|شيتول|التخطيط|primavera/i
const JOBSEEKER_DOMAIN_RE = /gmail|yahoo|hotmail|outlook|icloud|protonmail/i
const HARD_BAD_EMAIL_RE = /@expatriates\.(com|net)|noreply|no-reply|example|domain\.com|site\.com|yourdomain|mailto|\.png|\.jpg|@\[|unknown/i
const MAIL_CTX_RE = /email|e-mail|mail|contact|send.*cv|cv.*to|apply|recruit|hr\.|تواصل|إيميل|بريد|cv|سيرة|قدم|ترسل|راسل|\bhr\b/i

const results = []
const seenLink = new Set()
let stats = { expatListed: 0, expatVisited: 0, filteredNoRiyadh: 0, filteredOld: 0, filteredNoContact: 0, dupLink: 0 }

function parseDate(text) {
  if (!text) return null
  const clean = text.replace(/\s+/g, " ").trim()
  const now = Date.now()
  if (/\btoday\b/i.test(clean)) return now
  if (/\byesterday\b/i.test(clean)) return now - 86400000
  let r = clean.match(/(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/i)
  if (!r) r = clean.match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/i)
  if (r) { const ms = r[1].substring(0,3).toLowerCase(); if (MONTHS[ms] !== undefined) return new Date(+r[3], MONTHS[ms], +r[2]).getTime() }
  r = clean.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/)
  if (r) { const ms = r[2].substring(0,3).toLowerCase(); if (MONTHS[ms] !== undefined) return new Date(+r[3], MONTHS[ms], +r[1]).getTime() }
  const rel = clean.match(/(\d+)\s*(?:day|days|hr|hrs|hour|hours)\s*ago/i)
  if (rel) return now - (+rel[1] * (/hr|hour/.test(rel[2]) ? 3600 : 86400) * 1000)
  return null
}

function isRiyadh(text) {
  if (!text) return false
  return /riyadh|الرياض/i.test(text)
}

function emailScore(email, context) {
  let s = 0
  if (/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email.trim())) s += 30
  const dom = email.split("@")[1] || ""
  if (/^[a-z0-9\-]+\.[a-z]{2,}$/i.test(dom)) s += 10
  if (HARD_BAD_EMAIL_RE.test(email)) s -= 100
  if (/^(mailto:|www\.)/i.test(email)) s -= 50
  const start = Math.max(0, (context || "").toLowerCase().indexOf(email.toLowerCase()))
  if (start >= 0) {
    const around = (context || "").toLowerCase().substring(start - 120, start + 120)
    if (MAIL_CTX_RE.test(around)) s += 25
  }
  return s
}

function extractEmails(context) {
  if (!context) return []
  const found = context.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []
  const scored = []
  for (const e of found) {
    const em = e.trim().replace(/[,.;)\]}]+$/, "")
    if (emailScore(em, context) >= 30) scored.push(em)
  }
  return [...new Set(scored.map(e => e.toLowerCase()))]
}

async function mxValid(email) {
  const dom = email.split("@")[1] || ""
  try {
    const mx = await resolveMx(dom)
    if (Array.isArray(mx) && mx.length > 0) return true
  } catch { /* fall back to system DNS */ }
  try {
    const out = execSync(`powershell -NoProfile -Command "Resolve-DnsName -Name ${dom.replace(/[^a-zA-Z0-9.\-]/g, "")} -Type MX -ErrorAction SilentlyContinue | Select-Object -ExpandProperty NameExchange"`, { encoding: "utf8", timeout: 30000, windowsHide: true })
    const lines = out.split(/\r?\n/).map(l => l.trim()).filter(l => l && /\./i.test(l))
    return lines.length > 0
  } catch {
    return false
  }
}

function validateEmail(e) {
  if (!e || typeof e !== "string") return false
  const em = e.trim()
  if (em.length < 6 || em.length > 254) return false
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(em)) return false
  if (HARD_BAD_EMAIL_RE.test(em)) return false
  return true
}

async function gotoRobust(page, url, tries = 2, minBody = 300) {
  for (let i = 0; i < tries; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 })
      await page.waitForTimeout(1_300 + i * 500)
      const info = await page.evaluate(() => ({ bodyLen: document.body.innerText.length, clsCount: Array.from(document.querySelectorAll("a")).filter(a => (a.href || "").includes("/cls/")).length }))
      if (info.bodyLen < minBody || info.clsCount === 0) { await page.waitForTimeout(2_500); continue }
      return info
    } catch (e) { await page.waitForTimeout(2_000) }
  }
  return null
}

function addResult(entry, regionGuess) {
  const emails = (entry.emails || []).filter(validateEmail)
  const uniq = [...new Set(emails.map(e => e.toLowerCase()))]
  if (regionGuess && !isRiyadh(regionGuess) && !isRiyadh(entry.text || entry.title)) { stats.filteredNoRiyadh++; return }
  if (entry.ts && entry.ts < CUTOFF) { stats.filteredOld++; return }
  if (entry.ts === null && !isRiyadh(entry.text || entry.title)) { stats.filteredNoContact++; return }
  if (entry.ts === null) { stats.filteredNoContact++ }
  if (seenLink.has(entry.url)) { stats.dupLink++; return }
  seenLink.add(entry.url)
  entry.pending = true
  entry.emails = uniq
  results.push(entry)
}

function isCompanyCategory(cat) {
  if (!cat) return true
  return !String(cat).toLowerCase().includes("job seek")
}

/* ============ Expatriates ============ */
async function scrapeExpatriates(ctx) {
  const page = await ctx.newPage()
  const collected = []
  const seenHref = new Set()
  const started = Date.now()
  const limits = { jobs: 6, "temp-jobs": 4 }
  for (const category of ["jobs", "temp-jobs"]) {
    for (let pg = 0; pg < limits[category]; pg++) {
      if (Date.now() - started > 420_000) break
      const url = pg === 0
        ? `https://www.expatriates.com/classifieds/riyadh/${category}/`
        : `https://www.expatriates.com/classifieds/riyadh/${category}/index${pg * 100}.html`
      const ok = await gotoRobust(page, url)
      if (!ok) { console.log(`[expat] ${category} pg${pg + 1} empty/failed`); continue }
      const cls = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a"))
          .filter(a => (a.href || "").includes("/cls/") && a.innerText.trim().length > 3)
          .map(a => ({ text: (a.innerText || "").replace(/\s+/g, " ").trim(), href: a.href }))
      ).catch(() => [])
      if (!cls.length) break
      const planning = cls.filter(a => PLANNING_RE.test(a.text))
      console.log(`[expat] ${category} pg${pg + 1}: ${cls.length} ads, ${planning.length} planning`)
      for (const a of planning) if (!seenHref.has(a.href)) { seenHref.add(a.href); collected.push(a) }
      await page.waitForTimeout(600)
    }
  }
  stats.expatListed = collected.length
  console.log(`[expat] planning ads (deduped): ${collected.length}`)

  const visitStart = Date.now()
  for (const ad of collected) {
    if (Date.now() - visitStart > 240_000) { console.log("  (visit budget exceeded)"); break }
    try {
      const ok = await gotoRobust(page, ad.href, 3)
      if (!ok) { console.log(`  (unreachable) ${ad.href}`); continue }
      stats.expatVisited++
      const data = await page.evaluate(() => {
        const body = document.body?.innerText || ""
        const dm = body.match(/Posted:\s*(.+)/)
        const mailto = Array.from(document.querySelectorAll("a[href^='mailto:']")).map(a => (a.href.replace(/^mailto:\s*/i, "").split("?")[0]).trim()) || []
        const tel = Array.from(document.querySelectorAll("a[href^='tel:']")).map(a => a.href.replace("tel:", "")) || []
        const regM = body.match(/Region:\s*(.+)/)
        const catM = body.match(/Category:\s*(.+)/)
        const title = document.querySelector("h1")?.innerText?.trim() || ""
        return {
          title, dateText: dm ? dm[1].trim() : "",
          region: regM ? regM[1].trim() : (body.match(/riyadh|الرياض/i)?.[0] || ""),
          category: catM ? catM[1].trim() : "",
          body: body.substring(0, 2500), mailto, tel,
        }
      })
      let emails = []
      if (data.mailto.length > 0) {
        emails = data.mailto
      } else if (/email|e-mail|mail|بريد|إيميل|تواصل/i.test(data.body)) {
        emails = extractEmails(data.body)
      }
      if (!isCompanyCategory(data.category) && emails.some(e => JOBSEEKER_DOMAIN_RE.test(e))) emails = []
      const ts = parseDate(data.dateText)
      addResult({
        title: data.title, text: data.title + " " + data.body, region: data.region, emails, ts,
        date: data.dateText, url: ad.href, source: "Expatriates", phones: data.tel, category: data.category,
      }, data.region)
      console.log(`  ${data.title?.substring(0, 55) || "(no h1)"} | ${emails.length ? emails.join("; ") : "no-emails"} | ${data.region || "?"} | ${data.dateText || "?"}`)
    } catch (e) { console.log(`  err: ${e.message?.substring(0, 50)}`) }
  }
  await page.close()
}

/* ============ Direct boards ============ */
async function scrapeBoard(ctx, name, url) {
  const page = await ctx.newPage()
  console.log(`[${name}] ${url}`)
  let ok = false
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      await page.waitForTimeout(4000)
      const body = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "")
      if (/(checking your browser|captcha|cloudflare|access denied|enable javascript|unusual traffic)/i.test(body)) {
        console.log(`[${name}] blocked (try ${attempt + 1})`); await page.waitForTimeout(5000); continue
      }
      ok = true
    } catch (e) { console.log(`[${name}] err try ${attempt + 1}: ${e.message?.substring(0, 50)}`); await page.waitForTimeout(4000) }
  }
  if (!ok) { await page.close(); return }
  const jobs = await page.evaluate(() => {
    const out = []
    for (const card of document.querySelectorAll("a, article, li, div[class*='job']")) {
      const a = card.tagName === "A" ? card : card.querySelector("a")
      if (!a || !a.href) continue
      const title = (a.getAttribute("title") || a.innerText?.split("\n")[0] || "").trim()
      if (title.length > 4 && /planning|schedul|controls|تخطيط|primavera/i.test(title) && /(jobs|viewjob|rc\/clk|jk=)/i.test(a.href)) out.push({ title, href: a.href })
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
        const dateM = body.match(/(?:posted|date|published)[:\s]*([^\n]{2,60})/i)
        const mailto = Array.from(document.querySelectorAll("a[href^='mailto:']")).map(a => (a.href.replace(/^mailto:\s*/i, "").split("?")[0]).trim()) || []
        return { text: body.substring(0, 2200), loc: locM?.[1]?.trim() || "", dateText: dateM?.[1]?.trim() || "", mailto }
      })
      const emails = data.mailto.length ? data.mailto : extractEmails(data.text)
      const ts = parseDate(data.dateText)
      addResult({ title: j.title, text: j.title + " " + data.text, region: isRiyadh(data.loc) ? "Riyadh" : "", emails, ts, date: data.dateText, url: j.href, source: name }, data.loc)
      if (emails.length) console.log(`  ${j.title.substring(0, 55)} | ${emails.join("; ")}`)
      else console.log(`  ${j.title.substring(0, 55)} | no-email | ${data.loc || "?"}`)
    } catch { /* continue */ }
  }
  await page.close()
}

/* ============ Search engines ============ */
async function bing(page, q) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=25`
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.waitForTimeout(3000)
  const body = await page.evaluate(() => document.body.innerText.slice(0, 150)).catch(() => "")
  if (/(captcha|enable javascript|unusual traffic)/i.test(body)) { console.log("  [bing] blocked"); return [] }
  const out = await page.evaluate(() => {
    const res = []
    for (const li of document.querySelectorAll("li.b_algo")) {
      const a = li.querySelector("h2 a")
      const sn = li.querySelector(".b_caption p, p.b_lineclamp2, .b_caption") 
      if (!a) continue
      res.push({ title: (a.innerText || "").trim(), href: a.href, sn: (sn?.innerText || "").trim().substring(0, 400) })
    }
    return res
  }).catch(() => [])
  return out
}

async function ddg(page, q) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.waitForTimeout(2500)
  const body = await page.evaluate(() => document.body.innerText.slice(0, 150)).catch(() => "")
  if (/(anomaly|captcha|email us)/i.test(body)) { console.log("  [ddg] blocked/empty"); return [] }
  const out = await page.evaluate(() => {
    const res = []
    for (const r of document.querySelectorAll(".result")) {
      const a = r.querySelector("a.result__a")
      const sn = r.querySelector(".result__snippet")
      if (!a || !a.href) continue
      res.push({ title: (a.innerText || "").trim(), href: a.href, sn: (sn?.innerText || "").trim().substring(0, 400) })
    }
    return res
  }).catch(() => [])
  return out
}

async function searchDiscovery(ctx) {
  const page = await ctx.newPage()
  const started = Date.now()
  const queries = [
    'site:linkedin.com "planning engineer" Riyadh',
    'site:linkedin.com "scheduling engineer" Riyadh',
    'site:gulftalent.com planning engineer Riyadh',
    'site:naukrigulf.com planning engineer Riyadh',
    'site:bayt.com planning engineer Riyadh',
    'site:linkedin.com "مهندس تخطيط" الرياض',
  ]
  for (const q of queries) {
    if (Date.now() - started > 300_000) break
    console.log(`\n[search] ${q}`)
    let hits = []
    hits = await bing(page, q)
    if (!hits.length) hits = await ddg(page, q)
    if (!hits.length) { console.log(`  [search] 0 links`); continue }
    console.log(`  [search] ${hits.length} links`)
    for (const r of hits.filter(h => /linkedin|gulftalent|naukrigulf|bayt/i.test(h.href)).slice(0, 6)) {
      try {
        await page.goto(r.href, { waitUntil: "domcontentloaded", timeout: 25000 })
        await page.waitForTimeout(2200)
        const body = await page.evaluate(() => document.body.innerText.slice(0, 150)).catch(() => "")
        if (/(checking your browser|captcha|sign in to view|join linkedin|to continue, please sign)/i.test(body)) {
          console.log(`  login-wall: ${r.title.substring(0, 55)}`)
          const m = r.sn.match(/(\d+)\s*(day|days|hour|hours|week|weeks)\s*ago|posted\s*(.+?)(?:\u00b7|$)/i)
          continue
        }
        const data = await page.evaluate(() => {
          const body = document.body?.innerText || ""
          const locM = body.match(/riyadh|الرياض/i)
          const dateM = body.match(/(?:posted|date|published|updated)[:\s]*([^\n]{2,60})/i)
          const mailto = Array.from(document.querySelectorAll("a[href^='mailto:']")).map(a => (a.href.replace(/^mailto:\s*/i, "").split("?")[0]).trim()) || []
          return { text: body.substring(0, 2200), hasRiyadh: !!locM, dateText: dateM?.[1]?.trim() || "", mailto }
        })
        const emails = data.mailto.length ? data.mailto : extractEmails(data.text)
        const ts = parseDate(data.dateText)
        if (!data.hasRiyadh) { stats.filteredNoRiyadh++; console.log(`  skip-notRiyadh: ${r.title.substring(0, 55)}`); continue }
        addResult({ title: r.title, text: r.title + " " + data.text, region: "Riyadh", emails, ts, date: data.dateText, url: r.href, source: "LinkedIn/jobs" })
        console.log(`  ${r.title.substring(0, 55)} | riyadh=yes | mail=${emails.length} | ${data.dateText || "?"}`)
      } catch { /* continue */ }
    }
  }
  await page.close()
}

/* ============ RUN ============ */
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 }, locale: "en-US",
})

console.log("\n===== EXPATRIATES =====")
await scrapeExpatriates(ctx)
console.log("\n===== BAYT =====")
await scrapeBoard(ctx, "bayt", "https://www.bayt.com/en/saudi-arabia/jobs/planning-engineer-jobs/")
console.log("\n===== INDEED =====")
await scrapeBoard(ctx, "indeed", "https://sa.indeed.com/jobs?q=planning+engineer&l=Riyadh&fromage=2")
console.log("\n===== SEARCH DISCOVERY (LinkedIn/GulfTalent/NaukriGulf/Bayt) =====")
await searchDiscovery(ctx)
await browser.close()

const pending = results
const verified = {}
for (const e of [...new Set(pending.flatMap(r => r.emails))]) {
  const v = await mxValid(e)
  verified[e] = v === true ? "MX" : (v === null ? "?" : "NO-MX")
}
for (const r of results) {
  r.emails = r.emails.filter(e => verified[e] !== "NO-MX")
  r.verified = r.emails.map(e => verified[e])
  delete r.pending
}

const output = {
  extractedAt: new Date().toISOString(),
  query: "Planning Engineer | Riyadh | today + yesterday",
  windowDays: DAYS, cutoff: new Date(CUTOFF).toISOString(),
  sources: { expatriates: true, bayt: true, indeed: true, linkedin: true, searchDiscovery: true },
  stats: { ...stats, finalResults: results.length },
  verify: verified,
  total: results.length, results,
}
const outPath = "data/job_hunter_riyadh_planning_2d.json"
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`\nSaved: ${outPath} (${results.length} entries)`)
console.log("STATS:", JSON.stringify(stats))

console.log("\n===== RESULTS =====")
for (const r of results) {
  console.log(`${r.title?.substring(0, 80)}`)
  console.log(`  ${r.source} | ${r.region || "?"} | ${r.date}`)
  if (r.emails.length) console.log(`  EM: ${r.emails.join("; ")} (${r.verified.join("/")})`)
  console.log(`  ${r.url}`)
}

const withEmail = results.filter(r => r.emails.length > 0)
console.log(`\n===== EMAILS (${withEmail.length} jobs, MX-checked) =====`)
console.log(withEmail.map(r => r.emails.join("; ")).filter(Boolean).join("; "))
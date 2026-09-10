import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

import { JOB_DEFAULTS, PLANNING_RE } from "./config.mjs"
import { Session } from "./nav.mjs"
import { parseDate, isWithinWindow } from "./dates.mjs"
import { extractEmails, extractPhones } from "./contacts.mjs"
import { parseBingResults } from "./nav.mjs"
import { Deduper } from "./deduper.mjs"
import { Advisor } from "./advisor.mjs"
import { fetchIndeedJobs } from "../../core/indeed-api.mjs"

export class Engine {
  constructor({ budgetMs = JOB_DEFAULTS.globalBudgetMs } = {}) {
    this.budgetMs = budgetMs
    this.deadline = Date.now() + budgetMs
    this.deduper = new Deduper()
    this.advisor = new Advisor()
  }

  timeLeft() { return this.deadline - Date.now() }

  async init() {
    const b = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"], defaultViewport: null })
    this.browser = b
    this.session = new Session(b)
    await this.session.freshContext(false)
    return this
  }

  async fetch(url, opts) {
    if (this.timeLeft() < 1000) return { ok: false, skipped: "budget" }
    const res = await this.session.go(url, opts)
    return res
  }

  async dispose() { for (const b of [this.browser]) try { await b.close() } catch {} }
}

export async function runJobHunt(existingResults, { budgetMs, verbose = true } = {}) {
  const eng = new Engine({ budgetMs })
  await eng.init()
  const out = []
  const seen = new Set(existingResults.map(r => r.link).filter(Boolean))
  const log = (...a) => { if (verbose) { const t = new Date().toLocaleTimeString(); console.log(`[${t}]`, ...a) } }

  try {
    // partner-agnostic: expatriates listing
    for (const cat of Object.keys(JOB_DEFAULTS.expatLimits)) {
      const limit = JOB_DEFAULTS.expatLimits[cat]
      log(`Expatriates: ${cat} (up to ${limit} pages)`)
      for (let pg = 0; pg < limit; pg++) {
        if (eng.timeLeft() < 7000) break
        const url = pg === 0
          ? `https://www.expatriates.com/classifieds/riyadh/${cat}/`
          : `https://www.expatriates.com/classifieds/riyadh/${cat}/index${pg * 100}.html`
        const r = await eng.fetch(url, { host: "www.expatriates.com", tries: 3 })
        if (!r.ok) { log(`[expat] ${cat} pg${pg + 1}: empty/failed`); continue }
        const ads = await r.page.evaluate(() =>
          Array.from(document.querySelectorAll("a"))
            .filter(a => (a.href || "").includes("/cls/") && a.innerText.trim().length > 3)
            .map(a => ({ href: a.href, text: (a.innerText || "").replace(/\s+/g, " ").trim() }))
        ).catch(() => [])
        if (!ads.length) { log(`[expat] ${cat} pg${pg + 1}: no ads -> stop`); break }
        const planning = ads.filter(a => PLANNING_RE.test(a.text))
        log(`[expat] ${cat} pg${pg + 1}: ${ads.length} ads, ${planning.length} planning`)

        for (const a of planning) {
          if (seen.has(a.href)) continue
          if (eng.timeLeft() < 4000) break
          const rv = await eng.fetch(a.href, { host: "www.expatriates.com", tries: 3 })
          if (!rv.ok) { log(`[expat] visit FAILED ${a.href}`); continue }
          const data = await rv.page.evaluate(() => {
            const body = document.body?.innerText || ""
            const dm = body.match(/Posted:\s*(.+)/)
            const mailto = Array.from(document.querySelectorAll("a[href^='mailto:']")).map(a => (a.href.replace(/^mailto:\s*/i, "").split("?")[0]).trim()) || []
            const tel = Array.from(document.querySelectorAll("a[href^='tel:']")).map(a => a.href.replace("tel:", "")) || []
            const regM = body.match(/Region:\s*(.+)/)
            const title = document.querySelector("h1")?.innerText?.trim() || ""
            return { title, post: dm ? dm[1].trim() : "", region: regM ? regM[1].trim() : "", body: body.substring(0, 3000), mailto, tel }
          }).catch(() => ({ title: "", post: "", region: "", body: "", mailto: [], tel: [] }))
          const region = data.region || (data.body.match(/riyadh|الرياض/i)?.[0] || "")
          const ts = parseDate(data.post)
          if (ts === null || isWithinWindow(ts, JOB_DEFAULTS.days) === false) continue
          let emails = data.mailto.length ? data.mailto : (/email|e-mail|mail|بريد|إيميل|تواصل|cv|سيرة|راسل/i.test(data.body) ? extractEmails(data.body) : [])
          emails = [...new Set(emails.filter(e => !/@expatriates\.(com|net)/i.test(e)))]
          if (!emails.length) { log(`[expat] (${a.href.slice(-12)}) ${data.title || a.text} no-email`); continue }
          const rec = { link: a.href, title: data.title || a.text, emails, phones: data.tel, date: data.post, ts, loc: region, source: "expatriates", match: "recent" }
          eng.advisor.record("expatriates", true, data.title || a.text)
          eng.deduper.mark(a.href)
          out.push(rec); seen.add(a.href)
          log(`[expat] ✓ ${data.title || a.text} | ${emails.join("; ")}`)
        }
        await new Promise(rr => setTimeout(rr, 500))
      }
    }

    // Bing discovery
    if (eng.timeLeft() > 45000) {
      const qs = [
        `site:expatriates.com planning engineer riyadh`,
        `"planning engineer" riyadh job saudi`,
        `"planning engineer" sala saudi abab riyadh email apply cv`,
        `"planning manager" riyadh expatriates mail`,
        `"scheduler" riyadh job expatriates hvac`,
        `planning engineer job riyadh 2026 ar مشروع `,
      ]
      for (const q of qs) {
        if (eng.timeLeft() < 25000) break
        const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`
        const r = await eng.fetch(url, { host: "www.bing.com", tries: 2 })
        if (!r.ok) { log(`Bing FAILED: ${q}`); continue }
        const results = parseBingResults(r.html)
        log(`Bing "${q.slice(0, 44)}": ${results.length}`)
        for (const res of results) {
          if (eng.timeLeft() < 8000) break
          const expatLink = res.url.match(/expatriates\.com\/cls\/(\d+)\.html/)
          const isPlanner = PLANNING_RE.test(res.title + " " + res.snippet)
          if (!expatLink || !isPlanner || seen.has(res.url)) continue
          const rv = await eng.fetch(res.url, { host: "www.expatriates.com", tries: 3 })
          if (!rv.ok) continue
          const data = await rv.page.evaluate(() => { const b = document.body?.innerText || ""; const dm = b.match(/Posted:\s*(.+)/); return { body: b.substring(0, 3000), post: dm ? dm[1].trim() : "" } }).catch(() => ({ body: "", post: "" }))
          const ts = parseDate(data.post)
          if (ts === null || isWithinWindow(ts, JOB_DEFAULTS.days) === false) continue
          const emails = extractEmails(data.body).filter(e => !/@expatriates\.(com|net)/i.test(e))
          if (emails.length) {
            const rec = { link: res.url, title: res.title, emails, phones: [], date: data.post, ts, loc: "Riyadh", source: "bing", match: "recent" }
            eng.advisor.record("bing", true, res.title)
            eng.deduper.mark(res.url)
            out.push(rec); seen.add(res.url)
            log(`[bing] ✓ ${res.title} | ${emails.join("; ")}`)
          }
        }
      }
    }

    // Indeed via core API (4-strategy chain bypasses the HTML block)
    if (eng.timeLeft() > 35000) {
      log("[indeed] trying core indeed-api chain…")
      const jobs = await fetchIndeedJobs("planning engineer", "Riyadh").catch(() => [])
      log(`[indeed] API chain returned ${jobs?.length || 0} jobs`)
      for (const job of jobs || []) {
        if (seen.has(job.url)) continue
        const title = job.title || ""
        const isPlanner = PLANNING_RE.test(title + " " + (job.description || ""))
        if (!isPlanner || !/riyadh|الرياض/i.test((job.location || "") + title)) continue
        seen.add(job.url)
        eng.advisor.record("indeed", true, title)
        out.push({ link: job.url, title, emails: [], phones: [], date: job.postedAt || "", ts: job.postedAt ? Date.parse(job.postedAt) : null, loc: job.location || "Riyadh", source: "indeed", match: "recent", note: "via core indeed-api; no direct email on Indeed" })
        log(`[indeed] ${title} | ${job.location}`)
      }
    }
  } finally {
    await eng.dispose()
  }

  await eng.advisor.persist()
  return out
}

export default runJobHunt
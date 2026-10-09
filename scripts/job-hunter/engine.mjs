import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

import { JOB_DEFAULTS, PLANNING_RE, regionGate, isJobSeeker, isServiceOffer, isTargetRole, NON_ROLE_RE } from "./config.mjs"
import { normalizeLoc, OFF_DOMAIN_RE } from "../../core/job-scan.mjs"
import { Session } from "./nav.mjs"
import { parseDate, isWithinWindow } from "./dates.mjs"
import { extractEmails, extractPhones } from "./contacts.mjs"
import { parseBingResults } from "./nav.mjs"
import { Deduper } from "./deduper.mjs"
import { Advisor } from "./advisor.mjs"
import { harvestBoards } from "./boards.mjs"

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

export async function runJobHunt(existingResults, { budgetMs, verbose = true, concurrency = JOB_DEFAULTS.concurrency, skipIndeed = false } = {}) {
  const eng = new Engine({ budgetMs })
  const CONC = Math.max(1, Math.min(6, parseInt(concurrency, 10) || 1))
  await eng.init()
  const out = []
  const seen = new Set(existingResults.map(r => r.link).filter(Boolean))
  const log = (...a) => { if (verbose) { const t = new Date().toLocaleTimeString(); console.log(`[${t}]`, ...a) } }
  log(`[ENGINE] budget=${budgetMs}ms concurrency=${CONC} skipIndeed=${skipIndeed}`)

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

        // Visit planning ads with bounded parallelism (JOB_DEFAULTS.concurrency)
        // Shared page budget: never start a visit without enough time left.
        const visitOne = async (a) => {
          if (seen.has(a.href)) return
          if (eng.timeLeft() < 4000 * CONC) return
          const rv = await eng.fetch(a.href, { host: "www.expatriates.com", tries: 3 })
          if (!rv.ok) { eng.advisor.record("expatriates", false, "visit-failed"); log(`[expat] visit FAILED ${a.href}`); return }
          const data = await rv.page.evaluate(() => {
            const body = document.body?.innerText || ""
            const dm = body.match(/Posted:\s*(.+)/)
            const mailto = Array.from(document.querySelectorAll("a[href^='mailto:']")).map(a => (a.href.replace(/^mailto:\s*/i, "").split("?")[0]).trim()) || []
            const tel = Array.from(document.querySelectorAll("a[href^='tel:']")).map(a => a.href.replace("tel:", "")) || []
            const regM = body.match(/Region:\s*(.+)/)
            const title = document.querySelector("h1")?.innerText?.trim() || ""
            return { title, post: dm ? dm[1].trim() : "", region: regM ? regM[1].trim() : "", body: body.substring(0, 3000), mailto, tel }
          }).catch(() => ({ title: "", post: "", region: "", body: "", mailto: [], tel: [] }))
          const region = normalizeLoc(data.region || (data.body.match(/riyadh|الرياض/i)?.[0] || ""))
          const ts = parseDate(data.post)
          if (ts === null || isWithinWindow(ts, JOB_DEFAULTS.days) === false) return
          if (isJobSeeker(data.title || a.text)) { log(`[expat] SKIP job-seeker (${a.href.slice(-12)})`); return }
          if (isServiceOffer(data.title || a.text)) { log(`[expat] SKIP service-offer (${a.href.slice(-12)})`); return }
          if (NON_ROLE_RE.test((data.title || a.text) + " " + data.body.substring(0, 300))) { log(`[expat] SKIP non-role (${a.href.slice(-12)})`); return }
          if (OFF_DOMAIN_RE.test((data.title || a.text) + " " + data.body.substring(0, 300))) { eng.advisor.record("expatriates", false, "off-domain"); log(`[expat] SKIP off-domain (${a.href.slice(-12)}) ${(data.title || a.text).slice(0, 50)}`); return }
          const gate = regionGate(region + " " + data.body + " " + data.title)
          if (!gate.ok) { eng.advisor.record("expatriates", false, gate.reason); log(`[expat] SKIP other-city (${a.href.slice(-12)}) ${gate.reason}`); return }
          let emails = data.mailto.length ? data.mailto : (/email|e-mail|mail|بريد|إيميل|تواصل|cv|سيرة|راسل/i.test(data.body) ? extractEmails(data.body) : [])
          emails = [...new Set(emails.filter(e => !/@expatriates\.(com|net)/i.test(e)))]
          if (!emails.length) { log(`[expat] (${a.href.slice(-12)}) ${data.title || a.text} no-email`); return }
          const rec = { link: a.href, title: data.title || a.text, emails, phones: data.tel, date: data.post, ts, loc: region, source: "expatriates", match: "recent" }
          eng.advisor.record("expatriates", true, data.title || a.text)
          eng.deduper.mark(a.href)
          out.push(rec); seen.add(a.href)
          log(`[expat] ✓ ${data.title || a.text} | ${emails.join("; ")}`)
        }

        // Worker pool: N concurrent visits, respecting the budget
        const queue = [...planning]
        const workers = Array.from({ length: CONC }, async () => {
          while (queue.length) {
            if (eng.timeLeft() < 4000) break
            const a = queue.shift()
            await visitOne(a).catch(() => {})
          }
        })
        await Promise.all(workers)
        await new Promise(rr => setTimeout(rr, 500))
      }
    }

    // Bing discovery
    if (eng.timeLeft() > 45000) {
      const qs = [
        `site:expatriates.com planning engineer riyadh`,
        `"planning engineer" riyadh job saudi`,
        `"senior planning engineer" riyadh job` ,
        `"planning manager" riyadh expatriates`,
        `"project control" lead riyadh job`,
        `"scheduler" riyadh job expatriates`,
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
          const isNoise = NON_ROLE_RE.test(res.title + " " + (res.snippet || ""))
          if (expatLink && isPlanner && !isNoise && !seen.has(res.url) && !isJobSeeker(res.title)) {
            const rv = await eng.fetch(res.url, { host: "www.expatriates.com", tries: 3 })
            if (!rv.ok) { eng.advisor.record("bing", false, "visit-failed"); continue }
            const data = await rv.page.evaluate(() => { const b = document.body?.innerText || ""; const dm = b.match(/Posted:\s*(.+)/); const regM = b.match(/Region:\s*(.+)/); return { body: b.substring(0, 3000), post: dm ? dm[1].trim() : "", region: regM ? regM[1].trim() : "" } }).catch(() => ({ body: "", post: "", region: "" }))
            const ts = parseDate(data.post)
            if (ts === null || isWithinWindow(ts, JOB_DEFAULTS.days) === false) continue
            if (isServiceOffer(res.title + " " + data.body)) { log(`[bing] SKIP service-offer ${res.url}`); continue }
            if (NON_ROLE_RE.test(res.title + " " + data.body)) { log(`[bing] SKIP non-role ${res.url}`); continue }
            if (OFF_DOMAIN_RE.test(res.title + " " + data.body)) { eng.advisor.record("bing", false, "off-domain"); log(`[bing] SKIP off-domain ${res.url}`); continue }
            const loc = normalizeLoc(data.region || (data.body.match(/riyadh|الرياض/i)?.[0] || "Riyadh"))
            const gate = regionGate(loc + " " + data.body + " " + res.title)
            if (!gate.ok) { eng.advisor.record("bing", false, gate.reason); log(`[bing] SKIP other-city ${res.url} (${gate.reason})`); continue }
            const emails = extractEmails(data.body).filter(e => !/@expatriates\.(com|net)/i.test(e))
            if (emails.length) {
              const rec = { link: res.url, title: res.title, emails, phones: [], date: data.post, ts, loc, source: "bing", match: "recent" }
              eng.advisor.record("bing", true, res.title)
              eng.deduper.mark(res.url)
              out.push(rec); seen.add(res.url)
              log(`[bing] ✓ ${res.title} | ${emails.join("; ")}`)
            }
          }
        }
      }
    }

    // Board sources: Bayt, NaukriGulf, GulfTalent via the browser session,
    // Indeed via the FlareSolverr sidecar (its own endpoints answer 403 to plain fetch).
    if (eng.timeLeft() > 60000) {
      const boards = await harvestBoards(eng, log, { skipIndeed })
      for (const rec of boards) {
        if (seen.has(rec.link)) continue
        out.push(rec); seen.add(rec.link)
      }
      log(`[boards] ${boards.length} records (${boards.filter(r => r.emails.length).length} with email)`)
    }
  } finally {
    await eng.dispose()
  }

  await eng.advisor.persist()
  return out
}

export default runJobHunt
import { PLANNING_RE, regionGate, isJobSeeker, isServiceOffer, NON_ROLE_RE, JOB_DEFAULTS } from "./config.mjs"
import { OFF_DOMAIN_RE, normalizeLoc } from "../../core/job-scan.mjs"
import { extractEmails, extractPhones } from "./contacts.mjs"
import { parseDate, isWithinWindow } from "./dates.mjs"
import { fetchWithFlareSolverr, isFlareAvailable } from "../../core/flare-solver.mjs"

const SITE_MAIL = /@(?:bayt|naukrigulf|gulftalent|indeed|expatriates)\.(?:com|net|org)/i
const DAYS = JOB_DEFAULTS.days

const QUERIES = ["planning-engineer-jobs", "planning-jobs", "project-planning-engineer-jobs", "scheduler-jobs"]
const Naukri_QUERIES = ["planning-engineer-jobs-in-riyadh", "planning-jobs-in-riyadh", "planning-manager-jobs-in-riyadh"]

// Shared acceptance gate — mirrors engine.mjs so every source is filtered the same way.
function gate(eng, { source, link, title, blob, locBlob, dateText, ts: tsIn, log }) {
  if (!title || !link) return null
  if (!PLANNING_RE.test(blob)) return null
  // The title itself must carry a planning/controls signal. Boards return long
  // snippets that mention "planning" in passing, which otherwise lets unrelated
  // roles (CRM manager, draftsman, design manager) through.
  if (!PLANNING_RE.test(title)) { eng.advisor.record(source, false, "off-title"); return null }
  if (isJobSeeker(title)) { eng.advisor.record(source, false, "job-seeker"); log(`[${source}] SKIP job-seeker ${title.slice(0, 46)}`); return null }
  if (isServiceOffer(blob)) { eng.advisor.record(source, false, "service-offer"); log(`[${source}] SKIP service-offer ${title.slice(0, 46)}`); return null }
  if (NON_ROLE_RE.test(blob)) { eng.advisor.record(source, false, "non-role"); return null }
  const rg = regionGate(locBlob)
  if (!rg.ok) { eng.advisor.record(source, false, rg.reason || "off-region"); log(`[${source}] SKIP ${rg.reason || "off-region"} ${title.slice(0, 46)}`); return null }
  if (OFF_DOMAIN_RE.test(`${title} ${String(blob).slice(0, 300)}`)) { eng.advisor.record(source, false, "off-domain"); log(`[${source}] SKIP off-domain ${title.slice(0, 46)}`); return null }

  // Sources that ship an exact timestamp (Indeed pubDate) skip relative-text parsing.
  const ts = typeof tsIn === "number" && !Number.isNaN(tsIn) ? tsIn : parseDate(dateText || "")
  if (ts == null) { eng.advisor.record(source, false, "unparseable-date"); log(`[${source}] SKIP no-date ${title.slice(0, 46)}`); return null }
  if (isWithinWindow(ts, DAYS) === false) { eng.advisor.record(source, false, "stale"); return null }

  const emails = extractEmails(blob).filter(e => !SITE_MAIL.test(e))
  return { ts, emails }
}

// ── Bayt: li[data-job-id] cards ───────────────────────────────────────────────
async function bayt(eng, log) {
  const found = []
  const seenLinks = new Set()
  for (const q of QUERIES) {
    if (eng.timeLeft() < 45000) break
    const url = `https://www.bayt.com/en/saudi-arabia/jobs/${q}/`
    const r = await eng.fetch(url, { host: "www.bayt.com", tries: 2 })
    if (!r.ok) { log(`[bayt] list failed ${q}`); continue }
    await eng.session.page.waitForTimeout(1800)
    const cards = await eng.session.page.evaluate(() =>
      Array.from(document.querySelectorAll("li[data-job-id]")).map(li => ({
        href: li.querySelector("h2 a")?.href || "",
        title: (li.querySelector("h2 a")?.getAttribute("title") || li.querySelector("h2 a")?.innerText || "").trim(),
        company: (li.querySelector(".job-company-location-wrapper a")?.innerText || "").trim(),
        loc: (li.querySelector(".jb-tags")?.innerText || "").replace(/\s+/g, " ").trim(),
        summary: (li.querySelector(".jb-descr")?.innerText || "").replace(/\s+/g, " ").trim(),
        date: (li.querySelector(".jb-date")?.innerText || "").replace(/\s+/g, " ").trim(),
      })),
    ).catch(() => [])
    if (!cards.length) log(`[bayt] 0 cards on ${q}`)
    for (const c of cards) {
      if (!c.href || seenLinks.has(c.href) || eng.deduper.has(c.href)) continue
      seenLinks.add(c.href)
      const blob = `${c.title} ${c.company} ${c.summary}`
      const g = gate(eng, { source: "bayt", link: c.href, title: c.title, blob, locBlob: `${c.loc} ${c.title} ${c.company}`, dateText: c.date, log })
      if (!g) continue
      found.push({
        link: c.href, title: c.title, company: c.company, loc: normalizeLoc(c.loc),
        emails: g.emails, phones: extractPhones(c.summary), date: c.date, ts: g.ts,
        source: "bayt", match: "recent",
        note: g.emails.length ? "" : "Bayt — تطبيق عبر المنصة (لا بريد مباشر)",
      })
      eng.advisor.record("bayt", true, c.title)
      eng.deduper.mark(c.href)
      log(`[bayt] ✓ ${c.title} | ${c.loc} | ${g.emails.join("; ") || "apply"}`)
    }
  }
  return found
}

// ── NaukriGulf: div.ng-box.srp-tuple cards ────────────────────────────────────
async function naukri(eng, log) {
  const found = []
  const seenLinks = new Set()
  for (const q of Naukri_QUERIES) {
    if (eng.timeLeft() < 45000) break
    const url = `https://www.naukrigulf.com/${q}`
    const r = await eng.fetch(url, { host: "www.naukrigulf.com", tries: 2 })
    if (!r.ok) { log(`[naukri] list failed ${q}`); continue }
    await eng.session.page.waitForTimeout(2200)
    const cards = await eng.session.page.evaluate(() =>
      Array.from(document.querySelectorAll("div.ng-box.srp-tuple")).map(d => ({
        href: d.querySelector("a.info-position")?.href || "",
        title: (d.querySelector(".designation-title")?.innerText || "").replace(/\s+/g, " ").trim(),
        company: (d.querySelector(".info-org")?.innerText || "").replace(/\s+/g, " ").trim(),
        loc: (d.querySelectorAll(".info-loc span")[1]?.innerText || d.querySelector(".info-loc")?.innerText || "").replace(/\s+/g, " ").trim(),
        summary: (d.querySelector(".description")?.innerText || "").replace(/\s+/g, " ").trim(),
        date: (d.querySelector(".time")?.innerText || "").replace(/\s+/g, " ").trim(),
      })),
    ).catch(() => [])
    if (!cards.length) log(`[naukri] 0 cards on ${q}`)
    for (const c of cards) {
      if (!c.href || seenLinks.has(c.href) || eng.deduper.has(c.href)) continue
      seenLinks.add(c.href)
      const blob = `${c.title} ${c.company} ${c.summary}`
      const g = gate(eng, { source: "naukri", link: c.href, title: c.title, blob, locBlob: `${c.loc} ${c.title} ${c.company}`, dateText: c.date, log })
      if (!g) continue
      found.push({
        link: c.href, title: c.title, company: c.company, loc: normalizeLoc(c.loc),
        emails: g.emails, phones: extractPhones(c.summary), date: c.date, ts: g.ts,
        source: "naukri", match: "recent",
        note: g.emails.length ? "" : "NaukriGulf — تطبيق عبر المنصة (لا بريد مباشر)",
      })
      eng.advisor.record("naukri", true, c.title)
      eng.deduper.mark(c.href)
      log(`[naukri] ✓ ${c.title} | ${c.loc} | ${g.emails.join("; ") || "apply"}`)
    }
  }
  return found
}

// ── GulfTalent: tr.content-visibility-auto table rows ─────────────────────────
// No keyword search exists (`?keywords=` and `/search?q=` are both ignored), and
// the category checkboxes are POST-only. The Riyadh city slug does paginate, so
// we crawl its first pages instead — region gate then does the role filtering.
const GULF_URLS = [1, 2, 3, 4].map(p =>
  p === 1
    ? "https://www.gulftalent.com/saudi-arabia/jobs/city/riyadh"
    : `https://www.gulftalent.com/saudi-arabia/jobs/city/riyadh/${p}`)

async function gulf(eng, log) {
  const found = []
  const seenLinks = new Set()
  for (const url of GULF_URLS) {
    if (eng.timeLeft() < 45000) break
    const r = await eng.fetch(url, { host: "www.gulftalent.com", tries: 2 })
    if (!r.ok) { log(`[gulf] list failed ${url}`); continue }
    await eng.session.page.waitForTimeout(2000)
    const cards = await eng.session.page.evaluate(() =>
      Array.from(document.querySelectorAll("tr.content-visibility-auto")).map(tr => {
        const tds = tr.querySelectorAll("td")
        const a = tr.querySelector("a.ga-job-click, a[href*='/jobs/']")
        return {
          href: a?.href || "",
          title: (a?.innerText || tr.querySelector("p.title")?.innerText || "").replace(/\s+/g, " ").trim(),
          company: (tr.querySelector("td:last-child")?.innerText || "").replace(/\s+/g, " ").trim(),
          loc: (tds[1]?.innerText || "").replace(/\s+/g, " ").trim(),
          date: (tds[2]?.innerText || "").replace(/\s+/g, " ").trim(),
        }
      }),
    ).catch(() => [])
    if (!cards.length) log(`[gulf] 0 cards on ${url}`)
    for (const c of cards) {
      if (!c.href || seenLinks.has(c.href) || eng.deduper.has(c.href)) continue
      seenLinks.add(c.href)
      const blob = `${c.title} ${c.company}`
      const g = gate(eng, { source: "gulf", link: c.href, title: c.title, blob, locBlob: `${c.loc} ${c.title} ${c.company}`, dateText: c.date, log })
      if (!g) continue
      found.push({
        link: c.href, title: c.title, company: c.company, loc: normalizeLoc(c.loc),
        emails: g.emails, phones: [], date: c.date, ts: g.ts,
        source: "gulf", match: "recent",
        note: g.emails.length ? "" : "GulfTalent — تطبيق عبر المنصة (لا بريد مباشر)",
      })
      eng.advisor.record("gulf", true, c.title)
      eng.deduper.mark(c.href)
      log(`[gulf] ✓ ${c.title} | ${c.loc} | ${g.emails.join("; ") || "apply"}`)
    }
  }
  return found
}

// ── Indeed: sa.indeed.com through the FlareSolverr session ───────────────────
// A shared FlareSolverr session keeps the clearance cookie between queries — the
// Turnstile round costs ~80s once instead of once per keyword.
async function flareSession(cmd, payload = {}) {
  const res = await fetch("http://localhost:8191/v1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, ...payload }),
  }).catch(() => null)
  if (!res?.ok) return null
  return res.json().catch(() => null)
}

async function indeedFlare(eng, log) {
  const found = []
  if (!(await isFlareAvailable().catch(() => false))) { log("[indeed] FlareSolverr غير متاح — يتخطى"); return found }
  const session = `jh-${Date.now().toString(36)}`
  await flareSession("sessions.create", { session })
  const queries = ["planning engineer", "scheduling engineer", "planning manager", "project controls engineer"]
  const seenLinks = new Set()
  try {
    for (const q of queries) {
      if (eng.timeLeft() < 70000) break
      const url = `https://sa.indeed.com/jobs?q=${encodeURIComponent(q)}&l=Riyadh%2C+Saudi+Arabia&fromage=${DAYS}`
      const res = await fetchWithFlareSolverr(url, { session, maxTimeout: 130000 }).catch(() => null)
      const html = res?.html || ""
      if (!html) { log(`[indeed] فارغ لـ"${q}"${res?.error ? ` (${res.error})` : ""}`); continue }
      const cards = parseIndeedHtml(html)
      log(`[indeed] "${q}" → ${cards.length} cards`)
      for (const c of cards) {
        if (!c.link || seenLinks.has(c.link) || eng.deduper.has(c.link)) continue
        seenLinks.add(c.link)
        const blob = `${c.title} ${c.company} ${c.summary}`
        const g = gate(eng, { source: "indeed", link: c.link, title: c.title, blob, locBlob: `${c.loc} ${c.title} ${c.company}`, dateText: c.date, ts: c.ts, log })
        if (!g) continue
        found.push({
          link: c.link, title: c.title, company: c.company, loc: normalizeLoc(c.loc),
          emails: g.emails, phones: extractPhones(c.summary), date: c.date, ts: g.ts,
          source: "indeed", match: "recent",
          note: g.emails.length ? "" : "Indeed — تطبيق عبر المنصة (لا بريد مباشر)",
        })
        eng.advisor.record("indeed", true, c.title)
        eng.deduper.mark(c.link)
        log(`[indeed] ✓ ${c.title} | ${c.loc} | ${g.emails.join("; ") || "apply"}`)
      }
    }
  } finally {
    await flareSession("sessions.destroy", { session })
  }
  return found
}

// Indeed renders dates client-side, so the card DOM has no date markup. The real
// data ships as JSON inside <script id="mosaic-data"> under
// window.mosaic.providerData["mosaic-provider-jobcards"], including an exact
// pubDate (epoch ms) — far better than guessing from relative text.
export function parseIndeedHtml(html) {
  const out = []
  const body = (html.match(/<script[^>]*id="mosaic-data"[^>]*>([\s\S]*?)<\/script>/) || [])[1]
  if (!body) return out

  const re = /window\.mosaic\.providerData\["([^"]+)"\]\s*=\s*/g
  let m
  while ((m = re.exec(body)) !== null) {
    const json = sliceValue(body, re.lastIndex)
    if (!json) continue
    let data
    try { data = JSON.parse(json) } catch { continue }
    const results = data?.metaData?.mosaicProviderJobCardsModel?.results
    if (!Array.isArray(results)) continue
    for (const j of results) {
      const jk = j?.jobkey || j?.jobKey
      const title = clean(j?.title)
      if (!jk || !title) continue
      out.push({
        link: `https://sa.indeed.com/viewjob?jk=${jk}`,
        title,
        company: clean(typeof j.company === "string" ? j.company : j.company?.displayName || ""),
        loc: clean(j.formattedLocation || j.jobLocationCity || ""),
        summary: clean(j.snippet || ""),
        date: clean(j.formattedRelativeTime || ""),
        ts: typeof j.pubDate === "number" ? j.pubDate : null,
      })
    }
    break
  }
  return out

  function clean(s) {
    return String(s).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim()
  }
}

// Balanced scan for the JSON value starting at `from` ({ or [), string-aware.
function sliceValue(s, from) {
  const open = s[from]
  if (open !== "{" && open !== "[") return null
  const close = open === "{" ? "}" : "]"
  let depth = 0, inStr = false, esc = false
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === "{" || c === "[") depth++
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return s.slice(from, i + 1) }
  }
  return null
}

// Bayt/Naukri/GulfTalent/Indeed all apply through the platform — no mailbox on the
// listing, so we still harvest them and let run-hunter split them into apply leads.
export async function harvestBoards(eng, log, { skipIndeed = false } = {}) {
  const out = []
  for (const [name, fn] of [["bayt", bayt], ["naukri", naukri], ["gulf", gulf]]) {
    if (eng.timeLeft() < 45000) break
    const rows = await fn(eng, log).catch(e => { log(`[${name}] ERR ${e?.message || e}`); return [] })
    log(`[${name}] kept ${rows.length}`)
    out.push(...rows)
  }
  if (!skipIndeed && eng.timeLeft() > 60000) {
    const rows = await indeedFlare(eng, log).catch(e => { log(`[indeed] ERR ${e?.message || e}`); return [] })
    log(`[indeed] kept ${rows.length}`)
    out.push(...rows)
  }
  return out
}


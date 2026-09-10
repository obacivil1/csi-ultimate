import { Router } from "express"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import { fileURLToPath } from "url"
import { env } from "../../config/env.mjs"
import { logger } from "../../core/logger.mjs"
import { generateSiteVerification, generateAuditSamples, calculateFieldAccuracy, calculateDuplicateMetrics, calculateTrustScore, loadCrawlRecords, listCrawlRecords } from "../../core/validation-engine.mjs"
import { loadInsights } from "../../core/insight-engine.mjs"
import { exportAll as canonicalExport } from "../../core/canonical-extractor.mjs"
import { extractAdData as scrapeAd } from "../../core/extractor.mjs"
import { createPage } from "../../core/anti-detect.mjs"
import { executeSearch } from "../../core/run.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const engineRouter = Router()

const STATE_DIR = path.resolve(__dirname, "../..", "state")
const CRAWLS_DIR = path.join(STATE_DIR, "crawls")
const RECORDS_DIR = path.join(STATE_DIR, "records")
export const ENGINE_PUBLIC_DIR = path.resolve(__dirname, "../../engine/public")

for (const dir of [STATE_DIR, CRAWLS_DIR, RECORDS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")) } catch { return null }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8")
}

const SITES_PATH = path.join(STATE_DIR, "sites.json")
function getSites() {
  return readJSON(SITES_PATH) || []
}
function saveSites(sites) {
  writeJSON(SITES_PATH, sites)
}

function ensureSites() {
  if (fs.existsSync(SITES_PATH)) {
    const existing = getSites()
    if (existing.length > 0) return
  }
  saveSites([
    { hostname: "gumtree.com", name: "Gumtree", language: "en", categories: [{ name: "Jobs", url: "https://www.gumtree.com/jobs", selector: "a[href*='/p/']" }], selectors: { title: "h1", listing: "a[href*='/p/']", location: "[class*='location']" } },
  ])
}

let activeCrawls = {}

function parseAdDate(dateText) {
  if (!dateText) return null
  const match = dateText.match(/(\w+),?\s+(\w+)\s+(\d+),?\s+(\d{4})/)
  if (!match) return null
  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
    january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11 }
  const m = months[match[2].toLowerCase()]
  return m !== undefined ? new Date(parseInt(match[4]), m, parseInt(match[3])) : null
}

const TIME_PERIOD_MS = {
  "24h": 86400000, "3d": 259200000, "1w": 604800000, "2w": 1209600000,
  "1m": 2592000000, "3m": 7776000000, "all": Infinity
}

function broadcastProgress(job, data) {
  if (!job) return
  for (const send of (job.sseClients || [])) {
    try { send(data) } catch {}
  }
}

async function runCrawl(jobId, siteConfig, category) {
  const { browser, context, page } = await createPage()

  try {
    const job = activeCrawls[jobId]
    job.status = "running"
    job.startTime = new Date().toISOString()
    saveCrawl(jobId, job)

    const maxAds = 25
    const seenUrls = new Set()
    const results = []

    await page.goto(category.url, { waitUntil: "domcontentloaded", timeout: 30000 })

    const links = await page.$$eval(category.selector, (els) =>
      els.map((el) => el.href || el.closest("a")?.href).filter(Boolean)
    )
    const uniqueLinks = [...new Set(links)].slice(0, maxAds)
    job.linksFound = uniqueLinks.length
    logger.info(`Crawl ${jobId}: found ${uniqueLinks.length} links`)
    saveCrawl(jobId, job)

    for (let i = 0; i < uniqueLinks.length; i++) {
      if (activeCrawls[jobId]?.status === "stopped") break
      const link = uniqueLinks[i]
      if (seenUrls.has(link)) continue
      seenUrls.add(link)
      try {
        await page.goto(link, { waitUntil: "domcontentloaded", timeout: 20000 })
        await page.waitForTimeout(1000 + Math.random() * 1000)
        const data = await scrapeAd(page, siteConfig)
        data.url = link
        results.push(data)
        job.adsScraped++
      } catch (e) {
        job.adsFailed++
      }
      job.progress = Math.round(((i + 1) / uniqueLinks.length) * 100)
      saveCrawl(jobId, job)
    }

    const recordsFile = path.join(RECORDS_DIR, `${jobId}.json`)
    writeJSON(recordsFile, results)
    logger.info(`Crawl ${jobId}: scraped ${results.length} records`)

    const report = generateReport(siteConfig.hostname, category.name, results)
    const reports = readJSON(path.join(STATE_DIR, "reports.json")) || []
    reports.push(report)
    writeJSON(path.join(STATE_DIR, "reports.json"), reports)

    job.status = "completed"
    job.endTime = new Date().toISOString()
    saveCrawl(jobId, job)
  } catch (e) {
    const job = activeCrawls[jobId]
    if (job) { job.status = "failed"; job.error = e.message; job.endTime = new Date().toISOString(); saveCrawl(jobId, job) }
    logger.error(`Crawl ${jobId} failed: ${e.message}`)
  } finally {
    await browser.close()
  }
}

function generateReport(site, category, records) {
  const totalAds = records.length
  const fields = {
    title: { present: records.filter((r) => r.title && r.title !== "N/A").length, empty: 0 },
    price: { present: records.filter((r) => r.price).length, empty: 0 },
    email: { present: records.filter((r) => r.email).length, empty: 0 },
    phone: { present: records.filter((r) => r.phone).length, empty: 0 },
    location: { present: records.filter((r) => r.location).length, empty: 0 },
  }
  for (const [k, v] of Object.entries(fields)) {
    v.empty = totalAds - v.present
    v.pct = totalAds > 0 ? Math.round((v.present / totalAds) * 100) : 0
  }

  const issues = []
  const missingPrice = records.filter((r) => !r.price)
  if (missingPrice.length > totalAds * 0.3) issues.push(`${missingPrice.length}/${totalAds} listings missing price information`)
  const missingPhone = records.filter((r) => !r.phone)
  if (missingPhone.length > totalAds * 0.5) issues.push(`${missingPhone.length}/${totalAds} listings missing phone contact`)
  const missingEmail = records.filter((r) => !r.email)
  if (missingEmail.length > totalAds * 0.7) issues.push(`${missingEmail.length}/${totalAds} listings missing email contact`)

  const dq = Math.round((fields.title.pct + fields.price.pct + fields.email.pct + fields.phone.pct + fields.location.pct) / 5)
  const extractionRate = totalAds > 0 ? Math.round((records.filter((r) => r.title && r.title !== "N/A").length / totalAds) * 100) : 0

  return {
    reportId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    site: `${site}/${category}`,
    totalAds,
    fields,
    metrics: {
      dataQualityScore: dq,
      siteHealthScore: Math.min(100, dq + 10),
      extractionRate,
      blockedPages: 0,
      cloudflareDetections: 0,
      retries: 0,
    },
    issues,
    configSuggestions: missingPrice.length > totalAds * 0.5 ? ["Consider adjusting price extraction selectors"] : [],
  }
}

function getCrawls() {
  return readJSON(path.join(STATE_DIR, "crawls.json")) || []
}
function saveCrawl(id, data) {
  const crawls = getCrawls()
  const idx = crawls.findIndex((c) => c.id === id)
  if (idx >= 0) crawls[idx] = { ...crawls[idx], ...data }
  else crawls.push({ id, ...data })
  writeJSON(path.join(STATE_DIR, "crawls.json"), crawls)
}
function getCrawl(id) {
  return getCrawls().find((c) => c.id === id) || null
}

engineRouter.get("/sites", (_req, res) => {
  ensureSites()
  res.json(getSites())
})

engineRouter.get("/sites/:hostname", (req, res) => {
  const site = getSites().find((s) => s.hostname === req.params.hostname)
  if (!site) return res.status(404).json({ error: "Not found" })
  res.json(site)
})

engineRouter.get("/sites/:hostname/discover", (req, res) => {
  const site = getSites().find((s) => s.hostname === req.params.hostname)
  if (!site) return res.status(404).json({ error: "Not found" })
  res.json({ hostname: site.hostname, categories: site.categories || [] })
})

engineRouter.post("/crawl", async (req, res) => {
  ensureSites()
  const { url, search } = req.body
  if (!url) return res.status(400).json({ error: "URL required" })

  let targetSite = null
  let targetCategory = null
  for (const site of getSites()) {
    for (const cat of site.categories || []) {
      if (url.includes(cat.url) || cat.url.includes(url) || url.includes(site.hostname)) {
        targetSite = site; targetCategory = cat; break
      }
    }
    if (targetSite) break
  }
  if (!targetSite) {
    targetSite = { hostname: new URL(url).hostname, name: new URL(url).hostname, selectors: { title: "h1", listing: "a[href]", location: null } }
    targetCategory = { name: "general", url, selector: "a[href]" }
  }

  const jobId = crypto.randomUUID()
  const job = { id: jobId, status: "queued", progress: 0, adsScraped: 0, adsFailed: 0, bansDetected: 0, cloudflareDetections: 0, retries: 0, linksFound: 0, startTime: null, endTime: null, error: null, site: targetSite.hostname, category: targetCategory.name, url: targetCategory.url }
  activeCrawls[jobId] = job
  saveCrawl(jobId, job)
  runCrawl(jobId, targetSite, targetCategory)
  res.json({ jobId })
})

engineRouter.post("/search", (req, res) => {
  ensureSites()
  const { siteHostname, categoryName, keyword, timePeriod } = req.body
  if (!siteHostname) return res.status(400).json({ error: "siteHostname is required" })

  const sites = getSites()
  const site = sites.find(s => s.hostname === siteHostname)
  if (!site) return res.status(404).json({ error: "Site not found: " + siteHostname })

  const cat = site.categories?.find(c => c.name === categoryName)
  if (!cat) return res.status(404).json({ error: "Category not found: " + categoryName + " for " + siteHostname })

  const jobId = crypto.randomUUID()
  const job = {
    id: jobId, status: "queued", progress: 0, adsScraped: 0, adsFailed: 0,
    bansDetected: 0, cloudflareDetections: 0, retries: 0, linksFound: 0,
    startTime: null, endTime: null, error: null,
    site: siteHostname, category: categoryName, url: cat.url,
    keyword: keyword || "", timePeriod: timePeriod || "2w",
    searchResults: [], sseClients: [],
  }
  activeCrawls[jobId] = job
  saveCrawl(jobId, job)

  executeSearch(jobId, siteHostname, categoryName, keyword, timePeriod || "2w", (event) => {
    const j = activeCrawls[jobId]
    if (!j) return
    if (event.type === "ad") {
      j.adsScraped = (event.index || 0)
      j.searchResults = j.searchResults || []
      j.searchResults.push(event.data)
      broadcastProgress(j, {
        type: "ad", index: event.index, url: event.data?.url || event.link || "",
        title: (event.data?.title || "N/A").substring(0, 40),
        email: event.data?.email || "N/A",
        phone: event.data?.phone || "N/A",
        location: event.data?.location || "",
        date: event.data?.postedDate || event.data?.extractedAt || "N/A",
        checked: event.checked, total: event.total,
      })
    } else if (event.type === "skip") {
      j.adsFailed = (j.adsFailed || 0) + 1
      broadcastProgress(j, {
        type: "skip", reason: event.reason, url: event.link?.substring(0, 40) || "",
        checked: event.checked, total: event.total,
      })
    }
  }).then(result => {
    const j = activeCrawls[jobId]
    if (!j) return
    j.status = "completed"
    j.progress = 100
    j.endTime = new Date().toISOString()
    j.linksFound = result.stats?.linksFound || 0
    j.adsScraped = result.stats?.totalAds || 0
    saveCrawl(jobId, j)
    broadcastProgress(j, {
      type: "completed",
      totalAds: result.stats?.totalAds || 0,
      skippedKeyword: result.stats?.skippedKeyword || 0,
      skippedDate: result.stats?.skippedDate || 0,
      errors: result.stats?.errors || 0,
      totalChecked: result.stats?.checked || 0,
      elapsed: result.elapsed || 0,
    })
  }).catch(err => {
    const j = activeCrawls[jobId]
    if (j) { j.status = "failed"; j.error = err.message; j.endTime = new Date().toISOString(); saveCrawl(jobId, j); broadcastProgress(j, { type: "failed", error: err.message }) }
    logger.error("executeSearch fatal: " + err.message)
  })

  res.json({
    jobId,
    site: siteHostname,
    category: categoryName,
    keyword: keyword || "",
    timePeriod: timePeriod || "2w",
    status: "queued"
  })
})

engineRouter.get("/search/:id/stream", (req, res) => {
  const job = activeCrawls[req.params.id]
  if (!job) return res.status(404).json({ error: "Job not found" })

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })
  res.write(`data: ${JSON.stringify({ type: "connected", jobId: job.id, status: job.status })}\n\n`)

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {}
  }
  job.sseClients.push(send)

  if (job.status === "completed") {
    const records = readJSON(path.join(RECORDS_DIR, `${job.id}.json`)) || []
    send({ type: "completed", totalAds: records.length, elapsed: 0 })
  } else if (job.status === "failed") {
    send({ type: "failed", error: job.error })
  }

  req.on("close", () => {
    job.sseClients = job.sseClients.filter(s => s !== send)
  })
})

engineRouter.get("/search/:id/results", (req, res) => {
  const job = activeCrawls[req.params.id]
  const records = readJSON(path.join(RECORDS_DIR, `${req.params.id}.json`)) || []
  const crawls = getCrawls()
  const crawl = crawls.find(c => c.id === req.params.id) || {}
  const getNum = (v) => typeof v === "number" ? v : 0
  res.json({
    status: job?.status || crawl?.status || "unknown",
    total: records.length,
    records,
    site: crawl?.site || job?.site || "",
    category: crawl?.category || job?.category || "",
    keyword: job?.keyword || "",
    timePeriod: job?.timePeriod || "",
    totalChecked: getNum(crawl?.linksFound || job?.linksFound),
    skippedKeyword: getNum(job?.skippedKeyword || crawl?.skippedKeyword),
    skippedDate: getNum(job?.skippedDate || crawl?.skippedDate),
    elapsed: getNum(job?.elapsed || crawl?.elapsed),
    generatedAt: job?.endTime || new Date().toISOString()
  })
})

engineRouter.get("/search/:id/export", (req, res) => {
  const records = readJSON(path.join(RECORDS_DIR, `${req.params.id}.json`)) || []
  if (records.length === 0) return res.status(404).json({ error: "No records found" })
  const format = req.query.format || "xlsx"
  const outputDir = path.resolve(__dirname, "../..", "output", "search")
  try {
    const files = canonicalExport(records, `search_${req.params.id}`, outputDir)
    const extMap = { json: "json", csv: "csv", xlsx: "xlsx" }
    const ext = extMap[format] || "xlsx"
    const filePath = files[ext]
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: "Export file not found" })
    const mimeMap = { json: "application/json", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    res.setHeader("Content-Type", mimeMap[format] || "application/octet-stream")
    res.setHeader("Content-Disposition", `attachment; filename="search_results_${req.params.id}.${format}"`)
    res.sendFile(filePath)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

engineRouter.get("/crawl/:id", (req, res) => {
  const job = getCrawl(req.params.id)
  if (!job) return res.status(404).json({ error: "Not found" })
  res.json(job)
})

engineRouter.post("/crawl/:id/stop", (req, res) => {
  const job = activeCrawls[req.params.id]
  if (job) job.status = "stopped"
  res.json({ ok: true })
})

engineRouter.get("/crawl/:id/results", (req, res) => {
  const records = readJSON(path.join(RECORDS_DIR, `${req.params.id}.json`)) || []
  const job = getCrawl(req.params.id)
  res.json({ records, total: records.length, site: job?.site || "unknown", generatedAt: job?.endTime || new Date().toISOString() })
})

engineRouter.get("/crawl/:id/records", (req, res) => {
  const records = readJSON(path.join(RECORDS_DIR, `${req.params.id}.json`)) || []
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 50
  const start = (page - 1) * limit
  res.json({ records: records.slice(start, start + limit), total: records.length, page, limit })
})

engineRouter.get("/reports", (_req, res) => {
  const reports = readJSON(path.join(STATE_DIR, "reports.json")) || []
  res.json(reports)
})

engineRouter.get("/reports/latest", (req, res) => {
  const reports = readJSON(path.join(STATE_DIR, "reports.json")) || []
  const site = req.query.site
  const filtered = site ? reports.filter((r) => r.site.startsWith(site)) : reports
  const sorted = filtered.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))
  res.json(sorted[0] || null)
})

engineRouter.get("/jobs", (_req, res) => res.json(getCrawls()))

engineRouter.get("/schedules", (_req, res) => res.json([]))
engineRouter.post("/schedules", (_req, res) => res.json({ ok: true }))
engineRouter.put("/schedules/:id", (_req, res) => res.json({ ok: true }))
engineRouter.delete("/schedules/:id", (_req, res) => res.json({ ok: true }))
engineRouter.put("/schedules/:id/toggle", (_req, res) => res.json({ ok: true }))
engineRouter.get("/settings", (_req, res) => res.json({}))
engineRouter.put("/settings", (_req, res) => res.json({ ok: true }))

engineRouter.get("/validation/sites", (_req, res) => {
  const crawlIds = listCrawlRecords()
  const results = crawlIds.map((id) => {
    const records = loadCrawlRecords(id)
    if (!records) return null
    const crawls = getCrawls()
    const crawl = crawls.find((c) => c.id === id) || {}
    return generateSiteVerification(crawl.site || "unknown", crawl.category || "unknown", records, { blockedPages: crawl.cloudflareDetections || 0, linksAttempted: crawl.linksFound || records.length })
  }).filter(Boolean)
  res.json({ sites: results, generatedAt: new Date().toISOString() })
})

engineRouter.get("/validation/site/:site", (req, res) => {
  const crawlIds = listCrawlRecords()
  let combined = []
  let crawlMeta = {}
  for (const id of crawlIds) {
    const records = loadCrawlRecords(id)
    if (!records) continue
    const crawls = getCrawls()
    const crawl = crawls.find((c) => c.id === id) || {}
    if (crawl.site === req.params.site || crawl.site?.startsWith(req.params.site)) {
      combined = combined.concat(records)
      crawlMeta = { blockedPages: crawl.cloudflareDetections || 0, linksAttempted: crawl.linksFound || records.length }
    }
  }
  if (combined.length === 0) return res.status(404).json({ error: "No data for site" })
  res.json(generateSiteVerification(req.params.site, "all", combined, crawlMeta))
})

engineRouter.get("/validation/audit/:jobId", (req, res) => {
  const records = loadCrawlRecords(req.params.jobId)
  if (!records) return res.status(404).json({ error: "Crawl not found" })
  const sampleSize = parseInt(req.query.samples) || 20
  res.json({
    jobId: req.params.jobId,
    totalRecords: records.length,
    sampleSize: Math.min(sampleSize, records.length),
    samples: generateAuditSamples(records, Math.min(sampleSize, records.length)),
  })
})

engineRouter.get("/validation/records/:jobId", (req, res) => {
  const records = loadCrawlRecords(req.params.jobId)
  if (!records) return res.status(404).json({ error: "Crawl not found" })
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 50
  const start = (page - 1) * limit
  res.json({
    records: records.slice(start, start + limit),
    total: records.length, page, limit,
    jobId: req.params.jobId,
  })
})

engineRouter.get("/validation/trust", (_req, res) => {
  const crawlIds = listCrawlRecords()
  const allScores = crawlIds.map((id) => {
    const records = loadCrawlRecords(id)
    if (!records) return null
    const crawls = getCrawls()
    const crawl = crawls.find((c) => c.id === id) || {}
    const fa = calculateFieldAccuracy(records)
    const dm = calculateDuplicateMetrics(records)
    const audit = generateAuditSamples(records, 20)
    return {
      jobId: id,
      site: crawl.site || "unknown",
      records: records.length,
      trustScore: calculateTrustScore(fa, dm, audit, { blockedPages: crawl.cloudflareDetections || 0, linksAttempted: crawl.linksFound || records.length }),
      fieldAccuracy: fa,
      duplicates: dm,
    }
  }).filter(Boolean)
  const overall = allScores.length > 0
    ? Math.round(allScores.reduce((s, x) => s + x.trustScore.score, 0) / allScores.length)
    : 0
  res.json({ scores: allScores, overallTrustScore: overall, generatedAt: new Date().toISOString() })
})

engineRouter.get("/crawl/:id/export", (req, res) => {
  const records = loadCrawlRecords(req.params.id)
  if (!records) return res.status(404).json({ error: "Crawl not found" })
  const format = req.query.format || "json"
  const outputDir = path.resolve(__dirname, "../..", "output", "engine")
  try {
    const files = canonicalExport(records, `crawl_${req.params.id}`, outputDir)
    const extMap = { json: "json", csv: "csv", xlsx: "xlsx" }
    const ext = extMap[format] || "json"
    const filePath = files[ext]
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: "Export file not found" })
    const mimeMap = { json: "application/json", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    res.setHeader("Content-Type", mimeMap[format] || "application/octet-stream")
    res.setHeader("Content-Disposition", `attachment; filename="crawl_${req.params.id}.${format}"`)
    res.sendFile(filePath)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

engineRouter.get("/insights", (_req, res) => {
  res.json(loadInsights())
})

engineRouter.get("/evidence/:insightId", (req, res) => {
  const data = loadInsights()
  const insight = data.insights?.find((i) => i.id === req.params.insightId)
  if (!insight) return res.status(404).json({ error: "Insight not found" })
  const records = []
  for (const url of insight.evidence || []) {
    const crawlIds = listCrawlRecords()
    for (const id of crawlIds) {
      const recs = loadCrawlRecords(id)
      if (recs) {
        const found = recs.find((r) => r.url === url)
        if (found) { records.push(found); break }
      }
    }
  }
  res.json({ insight, records, recordCount: records.length })
})
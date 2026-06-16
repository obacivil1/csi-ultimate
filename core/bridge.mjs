/**
 * bridge.mjs — Data Extraction Bridge (UAT + Self-Healing)
 * ─────────────────────────────────────────────────────────
 * Lifecycle tags: [INIT] [NAV] [DOM] [EXT] [VAL] [SAVE] [ERR] [RETRY] [DONE]
 * UAT tags:       [NAV_SUCCESS] [NAV_FAILURE] [EXT_SUCCESS] [EXT_FAILURE]
 *                 [VAL_SUCCESS] [VAL_FAILURE] [WARN] [SELF_HEALING]
 * Error codes: E001..E099
 */
import fs from "fs"
import path from "path"
import { createPage, openAdPage, openAdPageHard, navigateWithRetry } from "./anti-detect.mjs"
import { executeWithStrategy, createStrategyBrowser, closeStrategyBrowser } from "./strategy-engine.mjs"
import { parseRssFeed } from "./rss-reader.mjs"
import { fetchIndeedJobs } from "./indeed-api.mjs"
import { getVerifiedStrategy, getSuccessRate, isBelowThreshold, getHistory, clearHostname } from "./strategy-ledger.mjs"
import { createSessionManager } from "./session-manager.mjs"
import { evaluateStrategies } from "./live-verifier.mjs"
import { runInteractionPipeline, professionalClick, extractHiddenData, detectCaptcha } from "./interaction-engine.mjs"

const STATE_DIR = path.resolve(import.meta.dirname, "..", "state")
const RECORDS_DIR = path.join(STATE_DIR, "records")
if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true })

// ── Logger ─────────────────────────────────────────────────────
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SILENT: 4 }
const LOG_LEVEL = process.env.CSI_LOG_LEVEL || "INFO"
const UAT_MODE = process.env.CSI_UAT === "1"

function log(level, tag, msg, meta) {
  if (LOG_LEVELS[level] < LOG_LEVELS[LOG_LEVEL]) return
  const ts = new Date().toISOString().replace("T", " ").substring(0, 23)
  const m = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[${ts}] [${tag}] ${msg}${m}`)
}

const logInfo  = (t, m, x) => log("INFO", t, m, x)
const logWarn  = (t, m, x) => log("WARN", t, m, x)
const logError = (t, m, x) => log("ERROR", t, m, x)
const logDebug = (t, m, x) => log("DEBUG", t, m, x)

// ── Alert dispatcher ───────────────────────────────────────────
const ALERT_WEBHOOK_URL = process.env.CSI_ALERT_URL || ""

/**
 * sendAlert — Lightweight webhook dispatcher.
 * Logs locally; fires POST to CSI_ALERT_URL if configured.
 * Severity levels: INFO | WARN | CRITICAL
 *
 * Attach Telegram/Slack later via CSI_ALERT_URL env var.
 */
export async function sendAlert(severity, message, meta = {}) {
  const tag = severity === "CRITICAL" ? "[ALERT_CRIT]" : severity === "WARN" ? "[ALERT_WARN]" : "[ALERT_INFO]"
  logWarn(tag, `[${severity}] ${message}`, meta)

  if (!ALERT_WEBHOOK_URL) return

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        severity,
        message,
        timestamp: new Date().toISOString(),
        hostname: meta.hostname || "unknown",
        jobId: meta.jobId || null,
        stats: meta.stats || null,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
  } catch (e) {
    logDebug("[ALERT]", `Webhook send failed: ${e.message.substring(0, 60)}`)
  }
}

// ── UAT-specific structured logger ─────────────────────────────
function uatPass(phase, msg, meta) {
  if (!UAT_MODE) return
  console.log(`[${new Date().toISOString()}] [UAT_PASS] [${phase}] ${msg}${meta ? " " + JSON.stringify(meta) : ""}`)
}
function uatFail(phase, msg, meta) {
  if (!UAT_MODE) return
  console.log(`[${new Date().toISOString()}] [UAT_FAIL] [${phase}] ${msg}${meta ? " " + JSON.stringify(meta) : ""}`)
}
function uatWarn(field, adId, reason) {
  if (!UAT_MODE) return
  console.log(`[${new Date().toISOString()}] [WARNING: Missing Field - ${field} - AdID: ${adId}] ${reason}`)
}
function uatMetric(category, label, value) {
  if (!UAT_MODE) return
  console.log(`[${new Date().toISOString()}] [UAT_METRIC] ${category} | ${label} = ${value}`)
}

// ── Error codes ────────────────────────────────────────────────
const EC = {
  E001: "BROWSER_LAUNCH_FAILED",
  E002: "NAVIGATION_BLOCKED",
  E003: "NAVIGATION_TIMEOUT",
  E004: "SELECTOR_RETURNED_EMPTY",
  E005: "TITLE_EXTRACTION_FAILED",
  E006: "PRICE_EXTRACTION_FAILED",
  E007: "CONTACT_EXTRACTION_FAILED",
  E008: "DATE_PARSE_FAILED",
  E009: "VALIDATION_FAILED",
  E010: "STORAGE_WRITE_FAILED",
  E011: "PIPELINE_TIMEOUT",
  E012: "LISTING_PARSE_FAILED",
  E013: "AD_NAVIGATION_FAILED",
  E014: "DATA_INCOMPLETE",
}

// ── Schema ─────────────────────────────────────────────────────
const AD_SCHEMA = {
  id:        { type: "string", required: true, minLen: 1 },
  title:     { type: "string", required: true, minLen: 2 },
  url:       { type: "string", required: true },
  price:     { type: "string", required: false },
  currency:  { type: "string", required: false },
  phone:     { type: "string", required: false },
  email:     { type: "string", required: false },
  location:  { type: "string", required: false },
  category:  { type: "string", required: false },
  postedDate: { type: "string", required: false },
  daysAgo:   { type: "number", required: false },
  extractedAt: { type: "string", required: true },
}

// ── Validator with UAT hooks ───────────────────────────────────
function validateRecord(record) {
  const errors = []
  const warnings = []

  for (const [field, rules] of Object.entries(AD_SCHEMA)) {
    const val = record[field]
    if (rules.required) {
      if (val === undefined || val === null || val === "") {
        const reason = `Required field "${field}" is missing or empty`
        errors.push({ field, code: "E009", reason })
        uatWarn(field, record.id || "UNKNOWN", reason)
        continue
      }
      if (rules.minLen && typeof val === "string" && val.length < rules.minLen) {
        const reason = `Field "${field}" too short (${val.length} < ${rules.minLen})`
        errors.push({ field, code: "E009", reason })
        uatWarn(field, record.id || "UNKNOWN", reason)
      }
    }
    if (val !== undefined && val !== null && val !== "") {
      if (rules.type === "number" && isNaN(Number(val))) {
        warnings.push({ field, code: "E014", reason: `Field "${field}" expected number, got "${typeof val}"` })
      }
    }
  }

  // Mandatory: at least one contact method
  if (!record.phone && !record.email) {
    warnings.push({ code: "E014", reason: "No contact method (phone or email)" })
    uatWarn("phone+email", record.id || "UNKNOWN", "No contact method (phone or email)")
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    score: errors.length === 0 ? (warnings.length === 0 ? "PASS" : "WARN") : "FAIL",
  }
}

// ── Selector fallback engine ───────────────────────────────────
const FALLBACK_TITLE = [
  (s) => document.querySelector(s)?.innerText?.trim(),
  (s) => { const e = document.querySelector(s); return e?.textContent?.trim() },
  () => document.querySelector("h1")?.innerText?.trim(),
  () => document.title?.split(/[-|–]/)[0]?.trim(),
  () => document.querySelector('[class*="title"] h1')?.innerText?.trim(),
  () => document.querySelector('[data-q="vip-title"]')?.innerText?.trim(),
  () => document.querySelector("meta[property='og:title']")?.content?.trim(),
]
const FALLBACK_PRICE = [
  (s) => document.querySelector(s)?.innerText?.trim(),
  (s) => { const e = document.querySelector(s); return e?.textContent?.trim() },
  () => document.querySelector('[data-aut-id="itemPrice"]')?.innerText?.trim(),
  () => document.querySelector('[class*="price"]')?.innerText?.trim(),
  () => document.querySelector('[class*="salary"]')?.innerText?.trim(),
  () => { const m = document.body.innerText.match(/(?:£|SAR|AED|PKR|\$|€|₹|Rs\.?\s*)\s*[:\-]?\s*([\d,]+)/); return m ? m[1] : null },
]
function _looksLikePhone(num) {
  const digits = num.replace(/\D/g, "")
  if (digits.length < 9 || digits.length > 15) return false
  if (/^(\d)\1{7,}$/.test(digits)) return false
  if (/^\+/.test(num)) return true
  if (/^05\d{8,}$/.test(digits)) return true
  if (/^0[0-9]\d{7,}$/.test(digits)) return true
  if (/^9665\d{8,}$/.test(digits)) return true
  return false
}

const FALLBACK_PHONE = [
  () => Array.from(document.querySelectorAll('a[href^="tel:"]')).map(a => a.href.replace("tel:", "").replace(/[^0-9+]/g, "")).filter(n => _looksLikePhone(n))[0] || null,
  () => { const m = document.body.innerText.match(/[\+\d][\d\s\-\(\)]{7,15}[\d]/); if (m) { const r = m[0].replace(/[^\d+]/g,""); if (_looksLikePhone(r)) return r } return null },
  () => { const m = document.documentElement.innerHTML.match(/tel:([^"']+)/); return m ? (m[1].replace(/[^0-9+]/g,"")).replace(/^0+/, "") : null },
  () => { const all = Array.from(document.querySelectorAll('[class*="phone" i], [class*="mobile" i], [class*="contact" i]')); const t = all.map(e => e.innerText.trim()).filter(Boolean).join(" "); const p = t.match(/[\+\d][\d\s\-\(\)]{7,15}[\d]/); if (p) { const r = p[0].replace(/[^\d+]/g,""); if (_looksLikePhone(r)) return r } return null },
]
const FALLBACK_EMAIL = [
  () => { const m = document.body.innerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/); if (m && !/noreply|no-reply|example\.com/i.test(m[0])) return m[0]; return null },
  () => { const m = document.documentElement.innerHTML.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/); if (m && !/noreply|no-reply|example\.com/i.test(m[0])) return m[0]; return null },
]
const FALLBACK_LOCATION = [
  (s) => document.querySelector(s)?.innerText?.trim(),
  (s) => { const e = document.querySelector(s); return e?.textContent?.trim() },
  () => document.querySelector('[class*="address"]')?.innerText?.trim(),
  () => document.querySelector("address")?.innerText?.trim(),
  () => Array.from(document.querySelectorAll('[class*="location"]')).map(e => e.innerText.trim()).filter(Boolean).join(", ") || null,
  () => Array.from(document.querySelectorAll('[class*="breadcrumb"] a')).map(a => a.innerText.trim()).filter(Boolean).join(" > ") || null,
]

const FALLBACK_DESC = [
  (s) => document.querySelector(s)?.innerText?.trim(),
  () => { const el = document.querySelector('[class*="description"]'); return el?.innerText?.trim() },
  () => { const el = document.querySelector('[class*="desc"]'); return el?.innerText?.trim() },
  () => { const el = document.querySelector('[class*="body"]'); return el?.innerText?.trim() },
  () => { const el = document.querySelector('[class*="content"]'); return el?.innerText?.trim() },
  () => document.querySelector("meta[property='og:description']")?.content?.trim(),
  () => document.querySelector("meta[name='description']")?.content?.trim(),
  () => { const b = document.body?.innerText?.trim(); return b ? b.substring(0, 3000) : null },
]

export const FALLBACK_MAP = {
  title: FALLBACK_TITLE,
  price: FALLBACK_PRICE,
  phone: FALLBACK_PHONE,
  email: FALLBACK_EMAIL,
  location: FALLBACK_LOCATION,
  description: FALLBACK_DESC,
}

async function extractByFallback(page, fallbacks, configSelector, fieldName, adId) {
  const args = configSelector ? [configSelector] : []
  for (let attempt = 0; attempt < fallbacks.length; attempt++) {
    try {
      const val = await page.evaluate(fallbacks[attempt], ...args)
      if (val && val.length > 0 && val !== "N/A") {
        if (UAT_MODE && attempt > 0) {
          logDebug("[UAT]", `Fallback used for "${fieldName}"`, { ad: adId, fallbackIndex: attempt })
        }
        return val
      }
    } catch {}
  }
  uatWarn(fieldName, adId, `All ${fallbacks.length} fallbacks exhausted`)
  return null
}

// ── Layer 5: Deep Extraction (FALLBACK_MAP) ───────────────────
// Tries every fallback before marking the ad as failed.
export async function deepExtraction(page, siteConfig, adId) {
  logInfo("[DEEP_EXTRACTION]", "Activated — running all FALLBACK_MAP strategies", { ad: adId })
  const sel = siteConfig.selectors || siteConfig.extraction?.selectors || {}
  const results = {}
  const fieldMap = {
    title: { fallbacks: FALLBACK_TITLE, selector: sel.title },
    price: { fallbacks: FALLBACK_PRICE, selector: sel.price },
    phone: { fallbacks: FALLBACK_PHONE, selector: null },
    email: { fallbacks: FALLBACK_EMAIL, selector: null },
    location: { fallbacks: FALLBACK_LOCATION, selector: sel.location },
    description: { fallbacks: FALLBACK_DESC, selector: sel.description },
  }
  for (const [field, cfg] of Object.entries(fieldMap)) {
    for (let attempt = 0; attempt < cfg.fallbacks.length; attempt++) {
      try {
        const args = cfg.selector ? [cfg.selector] : []
        const val = await page.evaluate(cfg.fallbacks[attempt], ...args)
        if (val && val.length > 0 && val !== "N/A") {
          results[field] = val
          if (UAT_MODE) logDebug("[UAT]", `DeepExt: "${field}" recovered via fallback[${attempt}]`)
          break
        }
      } catch {}
    }
    if (!results[field]) {
      logWarn("[DEEP_EXTRACTION]", `"${field}" all ${cfg.fallbacks.length} fallbacks exhausted`)
    }
  }
  if (!results.phone || !results.email) {
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 5000) || "").catch(() => "")
    if (!results.phone) {
      const pm = bodyText.match(/[\+\d][\d\s\-\(\)]{7,15}[\d]/)
      if (pm) results.phone = pm[0].replace(/[^\d+]/g, "")
    }
    if (!results.email) {
      const em = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
      if (em && !/noreply|no-reply|example\.com/i.test(em[0])) results.email = em[0]
    }
    if (!results.currency) {
      results.currency = bodyText.includes("SAR") ? "SAR" : bodyText.includes("AED") ? "AED" : bodyText.includes("PKR") ? "PKR" : bodyText.includes("£") ? "GBP" : bodyText.includes("€") ? "EUR" : bodyText.includes("$") ? "USD" : null
    }
  }
  const recovered = Object.values(results).filter(Boolean).length
  logInfo("[DEEP_EXTRACTION]", `Recovered ${recovered}/${Object.keys(fieldMap).length + 1} fields`, { ad: adId })
  return { id: adId, ...results, extractedAt: new Date().toISOString(), deepExtracted: true }
}

// ── Core extraction ────────────────────────────────────────────
export async function extractAdData(page, siteConfig) {
  const sel = siteConfig.selectors || siteConfig.extraction?.selectors || {}
  const ext = siteConfig.extraction || {}

  const id = await page.evaluate((pattern) => {
    const p = window.location.pathname
    if (pattern) { const m = p.match(new RegExp(pattern)); if (m) return m[1] }
    const m = p.match(/\/(\d{6,12})(?:\.html|\/|$)/); if (m) return m[1]
    const m2 = p.match(/[\/\-]iid[\/\-](\d+)/); if (m2) return m2[1]
    return p.split("/").filter(Boolean).pop()?.replace(".html", "") || ""
  }, ext.adIdPattern || null)

  const adId = id || "UNKNOWN"
  const title = await extractByFallback(page, FALLBACK_TITLE, sel.title, "title", adId)
  const price = await extractByFallback(page, FALLBACK_PRICE, sel.price, "price", adId)
  const phone = await extractByFallback(page, FALLBACK_PHONE, null, "phone", adId)
  const email = await extractByFallback(page, FALLBACK_EMAIL, null, "email", adId)
  const location = await extractByFallback(page, FALLBACK_LOCATION, sel.location, "location", adId)
  const description = await extractByFallback(page, FALLBACK_DESC, sel.description, "description", adId)

  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 5000) || "").catch(() => "")
  const currency = bodyText.includes("SAR") ? "SAR" : bodyText.includes("AED") ? "AED" : bodyText.includes("PKR") ? "PKR" : bodyText.includes("£") ? "GBP" : bodyText.includes("€") ? "EUR" : bodyText.includes("$") ? "USD" : null

  return { id, title, description, price, currency, phone, email, location, extractedAt: new Date().toISOString() }
}

// ── Scan Mode: fallback when configured selector yields nothing ─
const SCAN_PATTERNS = [/\/cls\//, /\/ad\//, /-ad-/, /\/item\//, /\/listing\//, /\/details?\//, /\/(\d{6,12})(?:\.html|\/|$)/, /\-(\d{6,7})\/$/]

async function scanPageForLinks(page, extraPatterns = []) {
  logWarn("[SELF_HEALING]", "Scan Mode Activated — primary selector returned 0 links, scanning DOM for ad patterns")
  try {
    const allPatterns = [...SCAN_PATTERNS]
    for (const ep of extraPatterns) {
      try { allPatterns.push(new RegExp(ep)) } catch {}
    }
    const rawLinks = await page.evaluate((patterns) => {
      const all = Array.from(document.querySelectorAll("a[href]"))
      const seen = new Set()
      const results = []
      for (const a of all) {
        const href = a.href.trim()
        if (!href || href === "#" || href.startsWith("javascript:") || seen.has(href)) continue
        seen.add(href)
        for (const p of patterns) {
          if (p.test(href)) {
            results.push({ href, text: a.innerText?.trim()?.substring(0, 40) || "", rel: a.rel || "" })
            break
          }
        }
      }
      return results
    }, SCAN_PATTERNS)

    if (rawLinks.length > 0) {
      logInfo("[SELF_HEALING]", `Scan Mode recovered ${rawLinks.length} ad links via regex patterns`)
      sendAlert("WARN", `Scan Mode activated for ${page.url()?.substring(0, 50) || "unknown"}`, {
        recovered: rawLinks.length,
        hostname: page.url()?.substring(0, 50),
      })
    } else {
      logWarn("[SELF_HEALING]", "Scan Mode found zero ad links — page structure may be unrecognised")
    }
    return rawLinks.map(l => l.href)
  } catch (e) {
    logError("[SELF_HEALING]", `Scan Mode DOM scan failed (E012)`, { error: e.message.substring(0, 60) })
    return []
  }
}

// ── Listing parser ─────────────────────────────────────────────
async function collectListingLinks(page, category, maxPages = 10, hardMode = false, siteConfig = {}) {
  const PAGE_OFFSETS = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]
  const allLinks = []
  let pageCount = 0
  let scanModeUsed = false

  const hasQuery = category.url.includes("?")
  for (let pi = 0; pi < maxPages; pi++) {
    const offset = PAGE_OFFSETS[pi]
    const pageUrl = offset === 0
      ? category.url
      : hasQuery
        ? category.url + "&start=" + offset
        : (category.url.endsWith("/") ? category.url + "index" + offset + ".html" : category.url + "/index" + offset + ".html")

    logInfo("[NAV]", `Listing page ${pi + 1}/${maxPages}`, { url: pageUrl.substring(0, 60) })
    try {
      const listingRetries = hardMode ? 4 : 2
      await navigateWithRetry(page, pageUrl, listingRetries, hardMode)
      uatPass("LISTING_NAV", `Page ${pi + 1} loaded`, { url: pageUrl.substring(0, 60) })
    } catch (e) {
      uatFail("LISTING_NAV", `Page ${pi + 1} blocked`, { error: e.message.substring(0, 40) })
      logWarn("[NAV_FAILURE]", `Listing page ${pi + 1} unavailable`, { error: e.message.substring(0, 40) })
      break
    }

    let links = await page.$$eval(category.selector, els =>
      els.map(el => el.href || el.closest("a")?.href).filter(Boolean)
    ).catch(() => [])

    // ── Self-Healing: if selector returns nothing, trigger Scan Mode ──
    if (links.length === 0 && !scanModeUsed) {
      scanModeUsed = true
      links = await scanPageForLinks(page, siteConfig.extraScanPatterns || [])
      if (links.length === 0) {
        logWarn("[NAV_FAILURE]", `Both primary selector and Scan Mode returned 0 links — stopping pagination`)
        break
      }
    } else if (links.length === 0) {
      logWarn("[NAV_FAILURE]", `Scan Mode also returned 0 links — stopping pagination`)
      break
    }

    allLinks.push(...links)
    pageCount++
    logInfo("[DOM]", `Found ${links.length} links on page ${pi + 1}${scanModeUsed ? " (via Scan Mode)" : ""}`, { totalSoFar: allLinks.length })

    // Only paginate if primary selector worked (Scan Mode is best-effort on page 1)
    if (scanModeUsed) break
  }

  const unique = [...new Set(allLinks)]
  logInfo("[DONE]", `Listing scan complete`, { totalLinks: unique.length, pages: pageCount, scanMode: scanModeUsed })
  uatPass("LISTING_PARSE", `Scanned ${pageCount} pages, found ${unique.length} unique links`)
  return unique
}

// ── Pipeline: one ad (uses Strategy Engine for multi-layer extraction) ─
async function processAd(link, index, total, context, siteConfig, keyword, maxAgeMs, browser, hardMode, extremeMode, verifiedStrategy = null, sessionMgr = null) {
  const adId = link.split("/").filter(Boolean).pop()?.replace(".html", "")?.substring(0, 16) || index
  const logMeta = { ad: adId, index, total }
  logInfo("[INIT]", `Processing ad ${index}/${total}`, logMeta)

  // ── STRATEGY ENGINE (Layers 1-5) ──────────────────────────
  // Layer 1: Stealth init (playwright-extra + stealth + fingerprint)
  // Layer 2: Adaptive strategies: A(Standard) → B(Proxy) → C(Headed)
  // Layer 3: Jitter controller on all delays
  // Layer 4: Exponential backoff 2^n + fingerprint rotation
  // Layer 5: Deep extraction via FALLBACK_MAP if result is null
  const extractors = { extractAdData, deepExtraction }
  const data = await executeWithStrategy(browser, link, siteConfig, adId, extractors, {
    preferredStrategy: verifiedStrategy,
    hostname: siteConfig.hostname?.toLowerCase() || "",
    sessionManager: sessionMgr,
  })

  if (!data) {
    logError("[NAV_FAILURE]", `All strategies failed (E002)`, logMeta)
    uatFail("AD_NAV", `Ad ${adId} blocked`)
    return { skipped: true, reason: "error", error: "All strategies exhausted", adId }
  }

  // ── Keyword filter ────────────────────────────────────────
  if (keyword) {
    const kw = keyword.toLowerCase()
    const text = `${data.title || ""} ${data.description || ""}`.toLowerCase()
    if (!text.includes(kw)) {
      logInfo("[DOM]", `Skipped — keyword mismatch`, { ...logMeta, keyword: keyword.substring(0, 20) })
      return { skipped: true, reason: "keyword", adId }
    }
    logInfo("[DOM]", `Keyword matched`, logMeta)
  }

  // ── Date filter ────────────────────────────────────────────
  if (data.postedDate && maxAgeMs < Infinity) {
    const postDate = parseAdDate(data.postedDate)
    if (postDate) {
      const age = Date.now() - postDate.getTime()
      if (age > maxAgeMs) {
        const days = Math.round(age / 86400000)
        logInfo("[DOM]", `Skipped — too old (${days}d)`, { ...logMeta, days, maxAge: Math.round(maxAgeMs / 86400000) })
        return { skipped: true, reason: "date", adId }
      }
    }
  }

  // ── Interaction Phase: reveal hidden data (phone/email via clicks) ─
  if (data && (!data.phone || !data.email)) {
    try {
      logInfo("[INTERACTION]", `Attempting hidden data reveal for ad ${adId}`, logMeta)
      const interaction = await runInteractionPipeline(page, context, hostname, siteConfig)
      if (interaction.hiddenData.phone) data.phone = interaction.hiddenData.phone
      if (interaction.hiddenData.email) data.email = interaction.hiddenData.email
      if (interaction.apiPhone) data.phone = interaction.apiPhone
      if (interaction.apiEmail) data.email = interaction.apiEmail
      if (interaction.hiddenData.applied) data.applied = true
      if (data.phone || data.email) {
        logInfo("[INTERACTION_OK]", `Contact data revealed via interaction`, {
          phone: !!data.phone, email: !!data.email,
        })
      }
    } catch (e) {
      logDebug("[INTERACTION]", `Interaction phase skipped`, { error: e.message?.substring(0, 60) })
    }
  }

  // ── Enrich with URL + metadata ─────────────────────────────
  data.url = link
  data.daysAgo = data.postedDate
    ? (() => { const d = parseAdDate(data.postedDate); return d ? Math.round((Date.now() - d.getTime()) / 86400000) : -1 })()
    : -1

  uatPass("EXT", `Ad ${adId} extraction complete`, { fields: Object.keys(data).filter(k => data[k]).length, total: Object.keys(data).length })

  // ── Validate ───────────────────────────────────────────────
  const validation = validateRecord(data)
  logInfo(validation.score === "PASS" ? "[VAL_SUCCESS]" : "[VAL_FAILURE]",
    `score=${validation.score} errors=${validation.errors.length} warnings=${validation.warnings.length}`, logMeta)

  if (validation.score === "FAIL") {
    uatFail("VAL", `Ad ${adId} validation FAILED`, { errors: validation.errors.map(e => e.reason) })
  } else if (validation.score === "WARN") {
    logWarn("[WARN]", `Record validation warnings`, { ...logMeta, warnings: validation.warnings.map(e => e.reason) })
  } else {
    uatPass("VAL", `Ad ${adId} validated PASS`, { score: validation.score })
  }

  return { skipped: false, data, validation, adId }
}

// ── Date parser ────────────────────────────────────────────────
function parseAdDate(text) {
  if (!text) return null
  const m = text.match(/(\w+),?\s+(\w+)\s+(\d+),?\s+(\d{4})/)
  if (!m) return null
  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
    january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11 }
  const mon = months[m[2].toLowerCase()]
  return mon !== undefined ? new Date(parseInt(m[4]), mon, parseInt(m[3])) : null
}

// ── High-level search ──────────────────────────────────────────
export async function runSearch(config, onProgress) {
  const { siteConfig, category, keyword, timePeriod, maxResults = 25 } = config
  const maxAgeMs = timePeriod === "all" ? Infinity : ({ "24h":864e5, "3d":2592e5, "1w":6048e5, "2w":12096e5, "1m":2592e6, "3m":7776e6 })[timePeriod] || 12096e5
  const startTime = Date.now()
  const results = []
  let checked = 0, skippedKeyword = 0, skippedDate = 0, errors = 0

  const extremeMode = config.extremeMode || process.env.CSI_EXTREME_MODE === "1"
  const hardMode = extremeMode || config.hardMode || process.env.CSI_HARD_MODE === "1"

  logInfo("[INIT]", "Pipeline started", { site: siteConfig.hostname, category: category.name, keyword, timePeriod, maxResults, hardMode, extremeMode })

  // ── STRATEGY 1: Indeed Publisher API ──────────────────────
  const hostname = siteConfig.hostname?.toLowerCase() || ""
  if (hostname.includes("indeed")) {
    logInfo("[INDEED-API]", "Trying Indeed Publisher API...")
    const publisherId = process.env.CSI_INDEED_PUBLISHER_ID || ""
    const rssKw = keyword?.trim() ? keyword : category.name
    const indeedResults = await fetchIndeedJobs(rssKw, "Riyadh", publisherId)
    if (indeedResults.length > 0) {
      logInfo("[INDEED-API]", `API returned ${indeedResults.length} results — bypassed Cloudflare`)
      for (const job of indeedResults) {
        if (results.length >= maxResults) break
        checked++
        results.push({
          id: `indeed_api_${checked}`,
          title: job.title || "N/A",
          description: job.description || "",
          url: job.url || "",
          price: job.price || null,
          currency: job.currency || "SAR",
          phone: null,
          email: null,
          location: job.location || "Riyadh",
          source: "indeed-api",
          extractedAt: new Date().toISOString(),
        })
        if (onProgress) onProgress({ type: "ad", index: results.length, data: results[results.length - 1], checked, total: indeedResults.length, adIndex: checked })
      }
      logInfo("[DONE]", "Indeed API pipeline complete", { totalAds: results.length })
      return {
        results,
        stats: { totalAds: results.length, checked, skippedKeyword: 0, skippedDate: 0, errors: 0, elapsed: 0, linksFound: indeedResults.length },
        jobId: config.jobId || `job_${Date.now()}`,
        generatedAt: new Date().toISOString(),
      }
    }
    logInfo("[INDEED-API]", "API returned empty — trying RSS feed")
  }

  // ── STRATEGY 2: RSS feed ─────────────────────────────────
  let links = []
  const rssKeywords = keyword?.trim() ? keyword : category.name
  const rssResults = await parseRssFeed(siteConfig.hostname, rssKeywords, "Riyadh")
  if (rssResults.length > 0) {
    logInfo("[RSS]", `Using RSS feed — ${rssResults.length} items found (bypasses browser)`)
    links = rssResults.map(r => r.url || r.link)
    // Process RSS items directly
    for (const rss of rssResults) {
      if (results.length >= maxResults) break
      checked++
      results.push({
        id: `rss_${checked}`,
        title: rss.title || "N/A",
        description: rss.description?.substring(0, 500) || "",
        url: rss.url || "",
        price: null, currency: null, phone: null, email: null, location: null,
        source: "rss",
        extractedAt: new Date().toISOString(),
      })
      if (onProgress) onProgress({ type: "ad", index: results.length, data: results[results.length - 1], checked, total: rssResults.length, adIndex: checked })
    }
    logInfo("[DONE]", `RSS pipeline complete`, { totalAds: results.length })
    return {
      results,
      stats: { totalAds: results.length, checked, skippedKeyword: 0, skippedDate: 0, errors: 0, elapsed: 0, linksFound: rssResults.length },
      jobId: config.jobId || `job_${Date.now()}`,
      generatedAt: new Date().toISOString(),
    }
  }
  logInfo("[RSS]", "No RSS feed available — falling back to browser scraping")

  // ── Browser-based scraping (fallback) ──────────────────────
  const { browser, context, page } = await createPage({ hardMode, extremeMode })
  logInfo("[INIT]", "Browser launched", { hardMode, extremeMode })
  uatPass("BROWSER", `Browser created${hardMode ? " (HARD)" : ""}${extremeMode ? " (EXTREME)" : ""}`)

  // ── LIVE-VERIFICATION LOOP ────────────────────────────────
  // Query ledger for verified strategy. If none, run live-check.
  const siteHostname = siteConfig.hostname?.toLowerCase() || ""
  const sessionMgr = createSessionManager(siteHostname)
  let verifiedStrategy = null

  const ledgerEntry = getVerifiedStrategy(siteHostname)
  if (ledgerEntry) {
    verifiedStrategy = ledgerEntry.strategy
    logInfo("[LIVE_VERIFY]", `Using verified strategy from ledger`, {
      strategy: verifiedStrategy,
      verifiedAt: ledgerEntry.verifiedAt,
      successRate: ledgerEntry.stats?.successRate,
    })
  } else {
    logInfo("[LIVE_VERIFY]", `No verified strategy — running live-check for "${siteHostname}"`)
    const testUrl = category?.url || `https://${siteHostname}/`
    const strategyNames = ["A-Standard", "B-Proxy", "C-HeadedHuman"]

    const liveResult = await evaluateStrategies(browser, siteHostname, strategyNames, testUrl, siteConfig)

    if (liveResult.hardBan) {
      logError("[LIVE_HARD_BAN]", `Hard ban detected for "${siteHostname}" — stopping pipeline`, {
        type: liveResult.type,
      })
      uatFail("HARD_BAN", `Site-wide block for ${siteHostname}`)
      await browser.close()
      return {
        results: [],
        stats: { totalAds: 0, checked: 0, skippedKeyword: 0, skippedDate: 0, errors: 1, elapsed: 0, linksFound: 0 },
        jobId: config.jobId || `job_${Date.now()}`,
        generatedAt: new Date().toISOString(),
        hardBan: true,
        message: `Live-verification detected hard ban on ${siteHostname}`,
      }
    }

    if (liveResult.verified) {
      verifiedStrategy = liveResult.strategy
      logInfo("[LIVE_VERIFY]", `Live-check passed — using "${verifiedStrategy}"`)
    } else {
      logInfo("[LIVE_VERIFY]", `Live-check failed — will try all strategies at runtime`)
    }
  }

  // Check success rate — trigger re-evaluation if below 80%
  if (isBelowThreshold(siteHostname) && ledgerEntry) {
    logWarn("[LIVE_VERIFY]", `Success rate below 80% — clearing ledger for re-evaluation`)
    clearHostname(siteHostname)
  }

  try {
    // Phase 1: Collect listing links
    links = await collectListingLinks(page, category, keyword?.trim() ? 10 : 5, hardMode, siteConfig)
    if (links.length === 0) {
      uatFail("LISTING", "Zero links collected — possible block or empty category")
    }

    // Phase 2: Process each ad
    for (const link of links) {
      if (results.length >= maxResults) break
      checked++

      const result = await processAd(link, checked, links.length, context, siteConfig, keyword, maxAgeMs, browser, hardMode, extremeMode, verifiedStrategy, sessionMgr)

      if (result.skipped) {
        if (result.reason === "keyword") skippedKeyword++
        else if (result.reason === "date") skippedDate++
        else errors++
        if (onProgress) onProgress({ type: "skip", reason: result.reason, link, checked, total: links.length, adIndex: checked })
      } else {
        results.push(result.data)
        if (onProgress) onProgress({ type: "ad", index: results.length, data: result.data, checked, total: links.length, adIndex: checked })
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000)
    logInfo("[DONE]", "Pipeline complete", { totalAds: results.length, checked, skippedKeyword, skippedDate, errors, elapsed: `${elapsed}s` })

    if (UAT_MODE) {
      uatMetric("Pipeline", "totalAds", results.length)
      uatMetric("Pipeline", "checked", checked)
      uatMetric("Pipeline", "skippedKeyword", skippedKeyword)
      uatMetric("Pipeline", "skippedDate", skippedDate)
      uatMetric("Pipeline", "errors", errors)
      uatMetric("Pipeline", "elapsed_seconds", elapsed)
      uatMetric("Pipeline", "linksFound", links.length)
      if (results.length > 0) {
        const fieldCounts = {}
        for (const r of results) {
          for (const [k, v] of Object.entries(r)) {
            if (!fieldCounts[k]) fieldCounts[k] = { present: 0, missing: 0 }
            if (v !== undefined && v !== null && v !== "") fieldCounts[k].present++
            else fieldCounts[k].missing++
          }
        }
        for (const [k, v] of Object.entries(fieldCounts)) {
          uatMetric("FieldCoverage", k, `${v.present}/${v.present + v.missing}`)
        }
      }
    }

    return {
      results,
      stats: { totalAds: results.length, checked, skippedKeyword, skippedDate, errors, elapsed, linksFound: links.length },
      jobId: config.jobId || `job_${Date.now()}`,
      generatedAt: new Date().toISOString(),
    }
  } catch (e) {
    logError("[ERR]", `Pipeline fatal: ${e.message}`, { error: e.message })
    uatFail("PIPELINE", `Fatal: ${e.message}`)
    throw e
  } finally {
    await browser.close()
    logInfo("[DONE]", "Browser closed")
  }
}

// ── Storage ────────────────────────────────────────────────────
export function saveResults(jobId, data) {
  const filePath = path.join(RECORDS_DIR, `${jobId}.json`)
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
    logInfo("[SAVE_SUCCESS]", `Results saved`, { file: filePath, records: data.length })
    return filePath
  } catch (e) {
    logError("[SAVE_FAILURE]", `Storage write failed (E010)`, { error: e.message })
    return null
  }
}

export { validateRecord, AD_SCHEMA, extractByFallback, scanPageForLinks }
export const ErrorCodes = EC
export { logInfo, logWarn, logError, logDebug }

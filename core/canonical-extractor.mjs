import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"
const _require = createRequire(import.meta.url)
const XLSX = _require("xlsx")

const __dirname = dirname(fileURLToPath(import.meta.url))

const STEALTH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

const FALLBACK_UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
]

let _browserSingleton = null

async function getBrowser() {
  if (_browserSingleton && _browserSingleton.isConnected()) return _browserSingleton
  chromium.use(stealth())
  _browserSingleton = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-site-isolation-trials",
      "--disable-features=BlockInsecurePrivateNetworkRequests",
    ]
  })
  return _browserSingleton
}

const BLOCK_KEYWORDS = [
  "cloudflare", "captcha", "just a moment", "access denied",
  "please enable javascript", "blocked", "your request has been blocked",
  "cf-ray", "checking your browser", "attention required",
]

function detectBlock(httpStatus, pageTitle, bodyText, htmlContent) {
  if (httpStatus === 403) return { blocked: true, type: "HTTP_403", reason: "HTTP 403 Forbidden" }
  if (httpStatus === 429) return { blocked: true, type: "HTTP_429", reason: "HTTP 429 Rate Limited" }
  if (httpStatus === 503) return { blocked: true, type: "HTTP_503", reason: "HTTP 503 Service Unavailable" }

  const haystack = (pageTitle + " " + bodyText + " " + htmlContent).toLowerCase()
  for (const kw of BLOCK_KEYWORDS) {
    if (haystack.includes(kw)) {
      const type = kw === "cf-ray" || kw === "checking your browser" || haystack.includes("challenge-platform") ? "CLOUDFLARE" :
        kw === "captcha" ? "CAPTCHA" : "BLOCKED"
      return { blocked: true, type, reason: "Detected: \"" + kw + "\"" }
    }
  }
  return { blocked: false }
}

async function navigateWithRetry(page, url, context, retries = 2) {
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      const httpStatus = resp ? resp.status() : null

      // Wait for dynamic content / Cloudflare challenge
      await page.waitForTimeout(3000)

      const title = await page.title()
      const body = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || "")
      const html = await page.evaluate(() => document.documentElement?.outerHTML?.substring(0, 3000) || "")

      const block = detectBlock(httpStatus, title, body, html)
      if (!block.blocked) return { success: true }

      console.log("[CF-EVASION] Attempt " + (attempt + 1) + "/" + (retries + 1) + " — " + block.reason + " for " + url)

      if (attempt < retries) {
        // Wait longer for Cloudflare challenge to complete
        console.log("[CF-EVASION] Waiting for challenge to pass...")
        await page.waitForTimeout(5000)

        // Check again
        const title2 = await page.title()
        const body2 = await page.evaluate(() => document.body?.innerText?.substring(0, 1000) || "")
        const html2 = await page.evaluate(() => document.documentElement?.outerHTML?.substring(0, 2000) || "")
        const block2 = detectBlock(httpStatus, title2, body2, html2)
        if (!block2.blocked) {
          console.log("[CF-EVASION] Challenge passed after waiting")
          return { success: true }
        }

        // Try with different viewport and user agent
        const altUA = FALLBACK_UAS[(attempt + 1) % FALLBACK_UAS.length]
        await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
        await page.setExtraHTTPHeaders({
          "Accept-Language": "en-US,en;q=0.9",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        })
        console.log("[CF-EVASION] Retrying with fallback UA...")
      }
    } catch (e) {
      lastError = e
      console.log("[CF-EVASION] Navigation error: " + (e.message || "").substring(0, 100))
      if (attempt < retries) {
        console.log("[CF-EVASION] Retrying navigation...")
        await page.waitForTimeout(3000)
      }
    }
  }
  return { success: false, error: lastError ? lastError.message : "Blocked after all retries" }
}

function readJSON(fp) {
  try { return JSON.parse(readFileSync(fp, "utf8")) } catch { return null }
}

export function getSiteConfig(hostname) {
  const fp = resolve(__dirname, "..", "config", "sites", `${hostname}.json`)
  return readJSON(fp)
}

export function getEngineSites() {
  const fp = resolve(__dirname, "..", "state", "sites.json")
  return readJSON(fp) || []
}

export function loadCrawlRecords(jobId) {
  const fp = resolve(__dirname, "..", "state", "records", `${jobId}.json`)
  if (!existsSync(fp)) return null
  return readJSON(fp)
}

export function listCrawlRecords() {
  const dir = resolve(__dirname, "..", "state", "records")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""))
}

export function saveCrawlRecords(jobId, records) {
  const dir = resolve(__dirname, "..", "state", "records")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, `${jobId}.json`), JSON.stringify(records, null, 2), "utf8")
}

export function normalizePhone(p) {
  if (!p || typeof p !== "string") return null
  return p.replace(/[\s\-\(\)\.]/g, "").replace(/^\+44/, "0").trim()
}

export function isValidPhone(phone, countryCode = "GB") {
  if (!phone || typeof phone !== "string") return false
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, "")
  if (countryCode === "GB") {
    if (/^07[0-9]{9}$/.test(cleaned)) return true
    if (/^447[0-9]{9}$/.test(cleaned)) return true
    if (/^\+447[0-9]{9}$/.test(cleaned)) return true
    return false
  }
  if (countryCode === "PK") {
    if (/^0[3456][0-9]{9}$/.test(cleaned)) return true
    return false
  }
  if (countryCode === "AE") {
    if (/^0[5][0-9]{8}$/.test(cleaned)) return true
    return false
  }
  if (/^\+?[1-9][0-9]{6,14}$/.test(cleaned)) return true
  return false
}

export function isAdId(phone, url) {
  if (!phone || !url) return false
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, "")
  const urlMatch = url.match(/\/(\d{7,12})(?:\.html)?$/)
  if (urlMatch && cleaned === urlMatch[1]) return true
  if (/^[1-9][0-9]{6,10}$/.test(cleaned) && !cleaned.startsWith("0")) return true
  return false
}

export function cleanPhone(raw, url, countryCode = "GB") {
  if (!raw) return null
  let phone = null
  if (typeof raw === "string") {
    const match = raw.match(/0[0-9]{9,10}/)
    if (match) phone = match[0]
    else {
      const intMatch = raw.match(/\+44[0-9]{10}/)
      if (intMatch) phone = intMatch[0]
    }
  }
  if (!phone) return null
  if (isAdId(phone, url)) return null
  if (!isValidPhone(phone, countryCode)) return null
  return phone
}

export function cleanEmail(raw) {
  if (!raw || typeof raw !== "string") return null
  const match = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  if (!match) return null
  const blacklist = /sentry|@2x|\.png|\.jpg|\.gif|noreply|no-reply|w3\.org|cloudflare|jquery|bootstrap|google|facebook|twitter|schema\.org|example\.com/i
  if (blacklist.test(match[0])) return null
  return match[0]
}

export function cleanPrice(raw) {
  if (!raw || typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (trimmed === "" || trimmed === ",") return null
  if (/^[\d,.]+(?:\s*-\s*[\d,.]+)?$/.test(trimmed)) return trimmed
  // Clean whitespace and extract number
  const spaced = trimmed.replace(/\s+/g, " ")
  const match = spaced.match(/[\d,.]+(?:\s*-\s*[\d,.]+)?/)
  if (match) return match[0].trim()
  return null
}

export function detectCurrency(bodyText) {
  if (!bodyText) return null
  if (bodyText.includes("£")) return "GBP"
  if (bodyText.includes("₹")) return "INR"
  if (bodyText.includes("Rs")) return "PKR"
  if (bodyText.includes("PKR")) return "PKR"
  if (bodyText.includes("AED")) return "AED"
  if (bodyText.includes("€")) return "EUR"
  if (bodyText.includes("$")) return "USD"
  return null
}

export const CANONICAL_KEYS = ["id", "site", "url", "title", "price", "currency", "phone", "email", "location", "category", "extractedAt"]

export function toCanonical(raw, site = "unknown", category = "unknown") {
  const url = raw.url || ""
  const countryCode = site.includes("pk") ? "PK" : site.includes("ae") ? "AE" : "GB"
  return {
    id: raw.id || raw.adId || url.match(/\/(\d{7,12})(?:\.html)?$/)?.[1] || url.match(/\/(\d{6,12})\//)?.[1] || "",
    site,
    url,
    title: raw.title || "N/A",
    price: raw.price ? cleanPrice(raw.price) : null,
    currency: raw.currency || detectCurrency(raw.description || raw.bodyText || "") || null,
    phone: cleanPhone(raw.phone || raw.phones || "", url, countryCode),
    email: cleanEmail(raw.email || raw.emails || ""),
    location: raw.location || null,
    category: raw.category || raw.categories || null,
    extractedAt: raw.extractedAt || raw.timestamp || new Date().toISOString(),
  }
}

export async function extractAdData(page, siteConfig, category) {
  const sel = siteConfig.selectors || siteConfig.extraction?.selectors || {}
  const ext = siteConfig.extraction || {}
  const hostname = siteConfig.hostname || "unknown"
  const countryCode = ext.phoneRegion === "GB" ? "GB" : hostname.includes("pk") ? "PK" : hostname.includes("ae") ? "AE" : "GB"

  const adIdPatternStr = ext.adIdPattern || siteConfig.adIdPattern || null

  return await page.evaluate(({ sel, countryCode, urlPrefix, adIdPatternStr }) => {
    const bodyText = document.body?.innerText || ""
    const bodyHtml = document.body?.innerHTML || ""
    const urlPath = window.location.pathname
    const adId = urlPath.match(/\/(\d+)(?:\.html)?$/)?.[1] ||
                 urlPath.match(/\/(\d{6,12})\//)?.[1] ||
                 (adIdPatternStr ? urlPath.match(new RegExp(adIdPatternStr))?.[1] : "") ||
                 ""

    const getEl = (s) => {
      if (!s) return null
      if (typeof s === "string") return document.querySelector(s)?.innerText?.trim() || null
      if (Array.isArray(s)) {
        for (const selector of s) {
          const el = document.querySelector(selector)
          if (el) return el.innerText?.trim() || null
        }
        return null
      }
      return null
    }
    const getAllText = (s) => {
      if (!s) return null
      return Array.from(document.querySelectorAll(s)).map(e => e.innerText.trim()).filter(Boolean).join(", ") || null
    }

    const title = getEl(sel.title) || getEl("h1") || document.title?.split(/[-|–]/)[0]?.trim() || "N/A"

    const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'))
      .map(a => a.href.replace("tel:", "").replace(/[\s\-\(\)\.]/g, ""))
      .filter(n => n.length >= 10 && n !== adId)
    const phoneRx = [/\b07[0-9]{9}\b/g, /\b0[0-9]{10}\b/g, /\+\d{10,14}/g]
    const phoneSet = new Set(telLinks)
    phoneRx.forEach(rx => {
      (bodyText.match(rx) || []).forEach(m => {
        const c = m.replace(/[\s\-\(\)\.]/g, "")
        if (c !== adId && c.length >= 10 && c.length <= 15) phoneSet.add(c)
      })
    })
    let phone = [...phoneSet][0] || null
    if (phone) {
      const cleaned = phone.replace(/[\s\-\(\)\.]/g, "")
      if (cleaned === adId) phone = null
      else if (countryCode === "GB" && !/^07[0-9]{9}$/.test(cleaned) && !/^\+447[0-9]{9}$/.test(cleaned)) phone = null
    }

    const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
    const blacklist = /sentry|@2x|\.png|\.jpg|\.gif|noreply|no-reply|w3\.org|cloudflare|jquery|bootstrap|google|facebook|twitter|schema\.org|example\.com/i
    const email = (emailMatch && !blacklist.test(emailMatch[0])) ? emailMatch[0] : null

    const priceElRaw = getEl(sel.price) || getEl('[data-aut-id="itemPrice"]') || getEl('[class*="price"]') || getEl('[class*="salary"]')
    const priceEl = priceElRaw && /\d/.test(priceElRaw) ? priceElRaw : null
    const priceMatch = bodyText.match(/(?:£|₹|Rs\.?\s*|PKR|price|salary|rent|Pay|Rate)\s*[:\-]?\s*([\d,]+(?:\s*-\s*[\d,]+)?)/i)
    const price = priceEl || (priceMatch ? priceMatch[1]?.trim() : null)

    const rawText = bodyText.substring(0, 5000)
    const currency = rawText.includes("£") ? "GBP" : rawText.includes("₹") ? "INR" : rawText.includes("PKR") || rawText.includes("Rs ") ? "PKR" : rawText.includes("SAR") ? "SAR" : rawText.includes("AED") ? "AED" : rawText.includes("€") ? "EUR" : rawText.includes("$") ? "USD" : null

    const location = getEl(sel.location) || getEl('[class*="address"]') || document.querySelector("address")?.innerText?.trim() || getAllText('[class*="location"]') || null

    const crumbs = Array.from(document.querySelectorAll('[class*="breadcrumb"] a, nav a, [class*="crumb"] a')).map(a => a.innerText.trim()).filter(Boolean).join(" > ") || null

    return {
      id: adId,
      title,
      price,
      currency,
      phone,
      email,
      location,
      category: crumbs || null,
      url: window.location.href,
      extractedAt: new Date().toISOString(),
    }
  }, { sel, countryCode, urlPrefix: category?.url || "", adIdPatternStr })
}

export async function runCrawl(jobId, siteConfig, category, maxAds = 25) {
  const browser = await getBrowser()
  const context = await browser.newContext({
    userAgent: STEALTH_UA,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()
  const seenUrls = new Set()
  const results = []

  try {
    const navResult = await navigateWithRetry(page, category.url, context, 2)
    if (!navResult.success) {
      console.log("[CRAWL] Listing page blocked: " + (navResult.error || "unknown"))
      saveCrawlRecords(jobId, results)
      return results
    }

    await page.waitForSelector(category.selector, { timeout: 15000, state: "attached" }).catch(() => {})
    const links = await page.$$eval(category.selector, (els) =>
      els.map((el) => el.href || el.closest("a")?.href).filter(Boolean)
    )
    const uniqueLinks = [...new Set(links)].slice(0, maxAds)

    for (let i = 0; i < uniqueLinks.length; i++) {
      const link = uniqueLinks[i]
      if (seenUrls.has(link)) continue
      seenUrls.add(link)
      try {
        const adNav = await navigateWithRetry(page, link, context, 1)
        if (!adNav.success) continue
        await page.waitForSelector("h1", { timeout: 10000, state: "attached" }).catch(() => {})
        await page.waitForTimeout(2000 + Math.random() * 1000)
        const data = await extractAdData(page, siteConfig, category)
        data.url = link
        results.push(data)
      } catch {
        // skip failed ads
      }
    }

    saveCrawlRecords(jobId, results)
    return results
  } finally {
    await context.close()
  }
}

export function toCSV(records) {
  const cols = ["id", "site", "url", "title", "price", "currency", "phone", "email", "location", "category", "extractedAt"]
  const escape = (v) => {
    if (v == null) return ""
    const s = String(v)
    return `"${s.replace(/"/g, '""')}"`
  }
  const header = cols.map(c => `"${c}"`).join(",")
  const rows = records.map(r => cols.map(c => escape(r[c])).join(","))
  return header + "\n" + rows.join("\n")
}

export function exportToCSV(records, filePath) {
  writeFileSync(filePath, toCSV(records), "utf8")
  return filePath
}

export function exportToXLSX(records, filePath) {
  const cols = ["id", "site", "url", "title", "price", "currency", "phone", "email", "location", "category", "extractedAt"]
  const data = [cols]
  for (const r of records) {
    data.push(cols.map(c => r[c] != null ? String(r[c]) : ""))
  }
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, "Records")
  XLSX.writeFile(wb, filePath, { bookType: "xlsx", type: "file" })
  return filePath
}

export function exportAll(records, label, outputDir) {
  const clean = records.map(r => toCanonical(r, r.site || "", r.category || ""))
  const jsonPath = resolve(outputDir, `${label}.json`)
  const csvPath = resolve(outputDir, `${label}.csv`)
  const xlsxPath = resolve(outputDir, `${label}.xlsx`)
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  writeFileSync(jsonPath, JSON.stringify({ total: clean.length, records: clean, generatedAt: new Date().toISOString() }, null, 2), "utf8")
  exportToCSV(clean, csvPath)
  exportToXLSX(clean, xlsxPath)
  return { json: jsonPath, csv: csvPath, xlsx: xlsxPath }
}

export function loadCanonicalRecords(jobId) {
  const raw = loadCrawlRecords(jobId)
  if (!raw) return null
  return raw.map(r => toCanonical(r, r.site || "gumtree.com", r.category || ""))
}

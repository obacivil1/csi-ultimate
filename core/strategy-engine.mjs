/**
 * strategy-engine.mjs — Adaptive Multi-Layer Extraction Strategy
 * ─────────────────────────────────────────────────────────────
 * Architecture (layers wrap each other):
 *   Layer 6: DeepExtraction     — FALLBACK_MAP when result is null
 *   Layer 5: NetworkListen      — Captures API responses for hidden data
 *   Layer 4: SessionInjection   — Injects logged-in user cookies
 *   Layer 3: ErrorRecovery      — Exponential backoff + fingerprint rotation
 *   Layer 2: JitterController   — All delays randomized, no two alike
 *   Layer 1: AdaptiveStrategy   — A(Standard) → B(Proxy) → C(Headed) → D(Session) → E(Network)
 *   Layer 0: StealthInit        — playwright-extra + stealth plugin + evasions
 *
 * Logs: [[STRATEGY_ACTIVE]] [[STRATEGY_FAILED]] [[STRATEGY_EXHAUSTED]]
 *        [[ALL_STRATEGIES_FAILED]] [[DEEP_EXTRACTION]]
 *        [[JITTER]] [[BACKOFF]] [[FINGERPRINT_ROTATED]]
 *        [[SESSION_INJECTION]] [[NETWORK_LISTEN]]
 *
 * Usage:
 *   import { executeWithStrategy, createStrategyBrowser, closeStrategyBrowser, Jitter } from "./strategy-engine.mjs"
 *   const browser = await createStrategyBrowser()
 *   const result = await executeWithStrategy(browser, url, siteConfig, adId, { extractAdData, deepExtraction })
 *   await closeStrategyBrowser(browser)
 */

import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"

chromium.use(stealth())

import { getRandomFingerprint, buildContextOptions, buildStealthScript, rotateFingerprint, initSessionFingerprint } from "./fingerprint-engine.mjs"
import { randomDelay, humanScroll, humanMouseMove, simulateHumanBehavior, waitForStabilization } from "./behavior-engine.mjs"
import { recordCheck, getVerifiedStrategy, getSuccessRate, isBelowThreshold, getHistory } from "./strategy-ledger.mjs"
import { createSessionManager } from "./session-manager.mjs"
import { injectSessionCookies, enableNetworkCapture, getCapturedApiData, clearCapturedApiData } from "./interaction-engine.mjs"

// ═══════════════════════════════════════════════════════════════
// LAYER 3 — Jitter Controller
// ═══════════════════════════════════════════════════════════════
// Replaces ALL fixed delays with randomized timing.
// Uses a mixed distribution (uniform + gaussian) to defeat
// rate-limit pattern detection.

function jitterBase(min, max) {
  const range = max - min
  const gaussian = (Math.random() + Math.random() + Math.random()) / 3
  const uniform = Math.random()
  const mix = gaussian * 0.7 + uniform * 0.3
  return Math.floor(min + range * mix)
}

export const Jitter = {
  delay(min, max) {
    const ms = jitterBase(min, max)
    return new Promise(r => setTimeout(r, ms))
  },

  between(min, max) {
    return jitterBase(min, max)
  },

  noise(base, percent = 15) {
    const delta = base * (percent / 100) * (Math.random() - 0.5) * 2
    return Math.floor(base + delta)
  },

  async scroll(page, targetY) {
    const currentY = await page.evaluate(() => window.scrollY || 0).catch(() => 0)
    const totalScroll = targetY - currentY
    if (Math.abs(totalScroll) < 10) return
    const stepCount = Math.max(3, Math.floor(Math.abs(totalScroll) / (100 + Math.random() * 150)))
    const stepSize = totalScroll / stepCount
    for (let i = 0; i < stepCount; i++) {
      const stepJitter = stepSize * (0.8 + Math.random() * 0.4)
      await page.evaluate(y => window.scrollBy(0, y), stepJitter).catch(() => {})
      await new Promise(r => setTimeout(r, jitterBase(30, 120)))
    }
  },

  async mouseMove(page, targetX, targetY) {
    const startX = 100 + Math.random() * 300
    const startY = 100 + Math.random() * 300
    const dist = Math.sqrt((targetX - startX) ** 2 + (targetY - startY) ** 2)
    const steps = Math.min(Math.max(Math.floor(dist / 8), 10), 80)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const eased = 3 * t * t - 2 * t * t * t
      const x = startX + (targetX - startX) * eased + (Math.random() - 0.5) * 3
      const y = startY + (targetY - startY) * eased + (Math.random() - 0.5) * 3
      await page.mouse.move(Math.floor(x), Math.floor(y))
      await new Promise(r => setTimeout(r, jitterBase(2, 8)))
    }
  },
}

// ═══════════════════════════════════════════════════════════════
// LAYER 4 — Exponential Backoff Error Recovery
// ═══════════════════════════════════════════════════════════════

export class ErrorRecovery {
  constructor(maxRetries = 3) {
    this.maxRetries = maxRetries
    this.attempt = 0
  }

  reset() { this.attempt = 0 }

  getDelay() {
    const base = Math.pow(2, this.attempt) * 1000
    const jitter = Jitter.between(0, 2000)
    const total = base + jitter
    return Math.floor(total)
  }

  async wait() {
    const ms = this.getDelay()
    await new Promise(r => setTimeout(r, ms))
    this.attempt++
  }

  shouldRetry(error) {
    if (this.attempt >= this.maxRetries) return false
    const msg = error?.message || ""
    const retryable = msg.includes("BLOCKED") ||
                      msg.includes("ERR_NAME_NOT_RESOLVED") ||
                      msg.includes("ERR_CONNECTION") ||
                      msg.includes("ERR_PROXY") ||
                      msg.includes("Timeout") ||
                      msg.includes("net::ERR_") ||
                      msg.includes("ECONNRESET") ||
                      msg.includes("ETIMEDOUT") ||
                      msg.includes("403") ||
                      msg.includes("429") ||
                      msg.includes("503") ||
                      msg.includes("DEEP_EXTRACTION_FAILED")
    if (retryable) {
      rotateFingerprint()
    }
    return retryable
  }
}

// ═══════════════════════════════════════════════════════════════
// LAYER 1 — Stealth Context Factory
// ═══════════════════════════════════════════════════════════════

const BLOCK_KEYWORDS = [
  "just a moment", "attention required", "checking your browser", "enable javascript",
  "cf-chl", "cf-error", "access denied", "captcha", "are you a robot",
  "rate limit", "too many requests", "blocked", "ddos", "verify you are human",
  "unusual traffic", "error 1015", "ray id:", "sorry, you have been blocked",
  "performing security verification", "security check", "challenge-platform",
]

function isPageBlocked(statusCode) {
  return [403, 429, 503].includes(statusCode)
}

async function checkTextBlocked(page) {
  try {
    const title = await page.title().catch(() => "")
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 1000) || "").catch(() => "")
    return BLOCK_KEYWORDS.some(kw => (title + " " + text).toLowerCase().includes(kw))
  } catch { return false }
}

/**
 * Wait for real page content (keeps waiting if Cloudflare/CAPTCHA challenge).
 * Prevents title = "Just a moment..." or "www.bayt.com" from being extracted.
 */
async function waitForRealPage(page, timeout = 30000) {
  try {
    await page.waitForFunction(() => {
      const isAntiBot = /just a moment|checking your browser|verify (you are|your)|captcha|press & hold/i.test(document.title)
      if (isAntiBot) return false
      const body = document.body?.innerText?.trim()
      return body && body.length > 200
    }, { timeout, polling: 1000 })
  } catch {}
}

export async function createStealthContext(browser, strategyName) {
  const fp = getRandomFingerprint()
  const profile = fp.profile
  const ctxOpts = buildContextOptions(fp)

  const context = await browser.newContext({
    ...ctxOpts,
    userAgent: profile.ua,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Cache-Control": "no-cache",
    },
    colorScheme: ["light", "dark", "no-preference"][Math.floor(Math.random() * 3)],
    locale: profile.locale,
    timezoneId: profile.timezone,
  })

  await context.addInitScript(buildStealthScript(profile, true))
  const page = await context.newPage()
  return { context, page, fingerprint: fp, profile }
}

// ═══════════════════════════════════════════════════════════════
// LAYER 2 — Strategy Implementations
// ═══════════════════════════════════════════════════════════════

let proxyIndex = 0

function getNextProxy() {
  const proxyVar = process.env.CSI_PROXY
  if (!proxyVar) return null
  const proxies = proxyVar.split(",").map(s => s.trim()).filter(Boolean)
  if (proxies.length === 0) return null
  const p = proxies[proxyIndex % proxies.length]
  proxyIndex++
  return p
}

// ── Strategy A: Standard ─────────────────────────────────────
async function strategyA(browser, url, siteConfig, adId, extractors) {
  const { extractAdData, deepExtraction } = extractors
  const { context, page } = await createStealthContext(browser, "A-Standard")
  try {
    await Jitter.delay(1000, 3000)
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    const status = resp?.status()
    if (isPageBlocked(status) || await checkTextBlocked(page)) throw new Error("BLOCKED HTTP_" + status)
    await waitForRealPage(page)
    await Jitter.delay(2000, 5000)
    const data = await extractAdData(page, siteConfig)
    if (!data || (!data.title && !data.description)) {
      return await deepExtraction(page, siteConfig, adId)
    }
    return data
  } finally {
    await page.close().catch(() => {})
    await context.close().catch(() => {})
  }
}

// ── Strategy B: Residential Proxy ────────────────────────────
async function strategyB(browser, url, siteConfig, adId, extractors) {
  const proxy = getNextProxy()
  const fp = getRandomFingerprint()
  const profile = fp.profile
  const ctxOpts = buildContextOptions(fp)

  const context = await browser.newContext({
    ...ctxOpts,
    userAgent: profile.ua,
    proxy: proxy ? { server: proxy } : undefined,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
      "DNT": "1",
    },
    locale: profile.locale,
    timezoneId: profile.timezone,
  })
  await context.addInitScript(buildStealthScript(profile, true))
  const page = await context.newPage()
  const { extractAdData, deepExtraction } = extractors
  try {
    await Jitter.delay(2000, 5000)
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    const status = resp?.status()
    if (isPageBlocked(status) || await checkTextBlocked(page)) throw new Error("BLOCKED HTTP_" + status)
    await waitForRealPage(page)
    await Jitter.delay(3000, 7000)
    const data = await extractAdData(page, siteConfig)
    if (!data || (!data.title && !data.description)) {
      return await deepExtraction(page, siteConfig, adId)
    }
    return data
  } finally {
    await page.close().catch(() => {})
    await context.close().catch(() => {})
  }
}

// ── Strategy D: Session Injection ──────────────────────────
// Layer 3: Injects cookies from a logged-in user session to bypass
// login walls and rate-limiting.
async function strategyD(browser, url, siteConfig, adId, extractors) {
  const { extractAdData, deepExtraction } = extractors
  const hostname = siteConfig.hostname || new URL(url).hostname
  const fp = getRandomFingerprint()
  const profile = fp.profile
  const ctxOpts = buildContextOptions(fp)

  const context = await browser.newContext({
    ...ctxOpts,
    userAgent: profile.ua,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Cache-Control": "no-cache",
    },
    locale: profile.locale,
    timezoneId: profile.timezone,
  })
  await context.addInitScript(buildStealthScript(profile, true))

  // Inject session cookies before navigation
  console.log(`[[SESSION_INJECTION]] injecting session for "${hostname}"`)
  const injected = await injectSessionCookies(context, hostname)
  console.log(`[[SESSION_INJECTION]] result=${injected ? "ok" : "none"}`)

  const page = await context.newPage()
  try {
    await Jitter.delay(1000, 3000)
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    const status = resp?.status()
    if (isPageBlocked(status) || await checkTextBlocked(page)) throw new Error("BLOCKED HTTP_" + status)
    await waitForRealPage(page)
    await Jitter.delay(2000, 5000)
    const data = await extractAdData(page, siteConfig)
    if (!data || (!data.title && !data.description)) {
      return await deepExtraction(page, siteConfig, adId)
    }
    return data
  } finally {
    await page.close().catch(() => {})
    await context.close().catch(() => {})
  }
}

// ── Strategy E: Network Listen ────────────────────────────
// Layer 4: Monitors network responses for API calls that may
// contain richer data than visible DOM (JSON, GraphQL, etc.)
async function strategyE(browser, url, siteConfig, adId, extractors) {
  const { extractAdData, deepExtraction } = extractors
  const hostname = siteConfig.hostname || new URL(url).hostname
  const fp = getRandomFingerprint()
  const profile = fp.profile
  const ctxOpts = buildContextOptions(fp)

  const context = await browser.newContext({
    ...ctxOpts,
    userAgent: profile.ua,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Cache-Control": "no-cache",
    },
    locale: profile.locale,
    timezoneId: profile.timezone,
  })
  await context.addInitScript(buildStealthScript(profile, true))
  const page = await context.newPage()

  // Enable network capture before navigation
  const apiCalls = await enableNetworkCapture(page, hostname)
  console.log(`[[NETWORK_LISTEN]] capture=active for "${hostname}"`)

  try {
    await Jitter.delay(1000, 3000)
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    const status = resp?.status()
    if (isPageBlocked(status) || await checkTextBlocked(page)) throw new Error("BLOCKED HTTP_" + status)
    await waitForRealPage(page)
    await Jitter.delay(2000, 5000)

    // Extract via standard method
    const data = await extractAdData(page, siteConfig)

    // Enrich with any API-captured phone/email
    const captured = getCapturedApiData(hostname)
    for (const call of captured) {
      if (call.preview) {
        if (!data.phone) {
          const pm = call.preview.match(/[\+\d][\d\s\-\(\)]{7,15}[\d]/)
          if (pm) data.phone = pm[0].replace(/[^\d+]/g, "")
        }
        if (!data.email) {
          const em = call.preview.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
          if (em && !/noreply|no-reply|example\.com/i.test(em[0])) data.email = em[0]
        }
        if (!data.price) {
          const pm = call.preview.match(/(?:SAR|AED|PKR|\$|£|€)\s*[:\-]?\s*([\d,]+)/)
          if (pm) data.price = pm[1]
        }
      }
    }

    if (!data || (!data.title && !data.description)) {
      return await deepExtraction(page, siteConfig, adId)
    }
    return data
  } finally {
    clearCapturedApiData(hostname)
    await page.close().catch(() => {})
    await context.close().catch(() => {})
  }
}

// ── Strategy C: Headed Human-Simulated ───────────────────────
async function strategyC(browser, url, siteConfig, adId, extractors) {
  const { extractAdData, deepExtraction } = extractors
  const fp = getRandomFingerprint()
  const profile = fp.profile
  const ctxOpts = buildContextOptions(fp)

  const context = await browser.newContext({
    ...ctxOpts,
    userAgent: profile.ua,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Cache-Control": "no-cache",
    },
    locale: profile.locale,
    timezoneId: profile.timezone,
  })
  await context.addInitScript(buildStealthScript(profile, true))
  const page = await context.newPage()

  // Pre-navigation warmup
  await page.mouse.move(100 + Math.random() * 200, 100 + Math.random() * 200)
  await Jitter.delay(200, 800)
  await page.mouse.move(300 + Math.random() * 300, 200 + Math.random() * 300)

  try {
    await Jitter.delay(3000, 8000)
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 120000 })
    const status = resp?.status()

    // Human behavioral simulation
    await simulateHumanBehavior(page)
    await Jitter.scroll(page, 300 + Math.random() * 600)

    if (isPageBlocked(status) || await checkTextBlocked(page)) throw new Error("BLOCKED HTTP_" + status)
    await waitForRealPage(page, 45000)
    await waitForStabilization(page, 3000)

    let data = await extractAdData(page, siteConfig)
    if (!data || (!data.title && !data.description)) {
      await Jitter.scroll(page, await page.evaluate(() => document.body?.scrollHeight || 1000).catch(() => 1000))
      await Jitter.delay(2000, 5000)
      data = await extractAdData(page, siteConfig)
    }
    if (!data || (!data.title && !data.description)) {
      return await deepExtraction(page, siteConfig, adId)
    }
    return data
  } finally {
    await page.close().catch(() => {})
    await context.close().catch(() => {})
  }
}

// ═══════════════════════════════════════════════════════════════
// ENGINE — Orchestrates all layers
// ═══════════════════════════════════════════════════════════════

const STRATEGIES = [
  { name: "A-Standard",       fn: strategyA },
  { name: "B-Proxy",          fn: strategyB },
  { name: "C-HeadedHuman",    fn: strategyC },
  { name: "D-SessionInject",  fn: strategyD },
  { name: "E-NetworkListen",  fn: strategyE },
]

/**
 * executeWithStrategy — Main entry point for the strategy engine.
 *
 * @param {Browser}  browser            Playwright browser instance
 * @param {string}   url                Target URL to extract from
 * @param {object}   siteConfig         Site configuration from sites.json
 * @param {string}   adId               Ad identifier for logging
 * @param {object}   extractors         { extractAdData, deepExtraction }
 * @param {object}   opts               { preferredStrategy, hostname, sessionManager }
 * @returns {object|null} Extracted data or null if all strategies fail
 */
export async function executeWithStrategy(browser, url, siteConfig, adId, extractors, opts = {}) {
  const hostname = opts.hostname || siteConfig.hostname || "unknown"
  const recovery = new ErrorRecovery(3)

  const orderedStrategies = [...STRATEGIES]
  if (opts.preferredStrategy) {
    const idx = orderedStrategies.findIndex(s => s.name === opts.preferredStrategy)
    if (idx > 0) {
      const [pref] = orderedStrategies.splice(idx, 1)
      orderedStrategies.unshift(pref)
      console.log(`[[STRATEGY_PREFERRED]] using="${opts.preferredStrategy}" (from ledger)`)
    }
  }

  for (const strategy of orderedStrategies) {
    console.log(`\n[[STRATEGY_ACTIVE]] name="${strategy.name}" url="${url?.substring(0, 70)}" ad="${adId}"`)

    while (true) {
      try {
        await Jitter.delay(500, 3000)
        const result = await strategy.fn(browser, url, siteConfig, adId, extractors)

        if (result) {
          console.log(`[[STRATEGY_ACTIVE]] success="${strategy.name}" fields=${Object.keys(result).filter(k => result[k]).length}`)
          const fpId = `p${Math.floor(Math.random() * 8) + 1}`
          recordCheck(hostname, strategy.name, "SUCCESS", { fields: Object.keys(result).filter(k => result[k]).length, fingerprintId: fpId })
          if (opts.sessionManager) {
            opts.sessionManager.lockIdentity({ fingerprintId: fpId, ua: "" })
            console.log(`[[SESSION_LOCK]] identity locked for "${hostname}"`)
          }
          return result
        }

        throw new Error("DEEP_EXTRACTION_FAILED")
      } catch (error) {
        const msg = error.message?.substring(0, 100) || "UNKNOWN"
        console.log(`[[STRATEGY_FAILED]] name="${strategy.name}" attempt=${recovery.attempt + 1}/${recovery.maxRetries} reason="${msg}"`)
        recordCheck(hostname, strategy.name, "BLOCKED", { error: msg, attempt: recovery.attempt + 1 })

        if (recovery.shouldRetry(error)) {
          console.log(`[[BACKOFF]] waiting ${Math.round(recovery.getDelay() / 1000)}s before retry`)
          await recovery.wait()
          continue
        }
        break
      }
    }
    recovery.reset()
    console.log(`[[STRATEGY_EXHAUSTED]] name="${strategy.name}"`)
  }

  console.log(`[[ALL_STRATEGIES_FAILED]] ad="${adId}" url="${url?.substring(0, 60)}"`)
  return null
}

// ── Browser lifecycle helpers ─────────────────────────────────

export async function createStrategyBrowser() {
  initSessionFingerprint()
  console.log(`[[LAYER1_STEALTH]] sessionFingerprint initialized`)

  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-features=BlockInsecurePrivateNetworkRequests",
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas", "--no-first-run", "--no-zygote",
    "--disable-gpu",
  ]

  const browser = await chromium.launch({ headless: true, args: launchArgs })
  console.log(`[[LAYER1_STEALTH]] browser=launched headless=true`)
  return browser
}

export async function closeStrategyBrowser(browser) {
  if (browser) {
    await browser.close().catch(() => {})
    console.log(`[[LAYER1_STEALTH]] browser=closed`)
  }
}

/**
 * stealth-engine.mjs — Stealth-First Orchestrator (Zero Paid APIs)
 * ─────────────────────────────────────────────────────────────────
 * Wraps the Bridge pipeline with five local-only strategies:
 *   1) Fingerprint Masking via playwright-extra + user-data-dir
 *   2) randomizedJitter(5000,15000) on every action
 *   3) Warm-up sequences (2-3 non-target pages)
 *   4) Rotating User-Agent pool per context
 *   5) Session Locking with local cookie persistence
 *
 * Tags: [[STEALTH]] [[STEALTH_OK]] [[STEALTH_FAIL]] [[STEALTH_JITTER]]
 *       [[STEALTH_WARMUP]] [[STEALTH_SESSION]] [[STEALTH_UA]]
 */
import fs from "fs"
import path from "path"
import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"

chromium.use(stealth())

import { initSessionFingerprint, getSessionFingerprint, rotateFingerprint, buildContextOptions, buildStealthScript } from "./fingerprint-engine.mjs"
import { simulateHumanBehavior, waitForStabilization, randomDelay, humanScroll } from "./behavior-engine.mjs"
import { createSessionManager } from "./session-manager.mjs"
import { recordCheck } from "./strategy-ledger.mjs"

const STEALTH_DIR = path.resolve(import.meta.dirname, "..", "state", "stealth-sessions")
if (!fs.existsSync(STEALTH_DIR)) fs.mkdirSync(STEALTH_DIR, { recursive: true })

function getTimestamp() { return new Date().toISOString() }

function log(tag, msg, meta) {
  const ts = getTimestamp().replace("T", " ").substring(0, 19)
  const extra = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[${ts}] [[${tag}]] ${msg}${extra}`)
}

// ── 1. User-Agent Pool (real-world browsers, no duplicates) ────

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.147 Mobile Safari/537.36",
]

let uaIndex = 0

function pickUA() {
  const ua = UA_POOL[uaIndex % UA_POOL.length]
  uaIndex++
  return ua
}

function shuffleUAPool() {
  for (let i = UA_POOL.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [UA_POOL[i], UA_POOL[j]] = [UA_POOL[j], UA_POOL[i]]
  }
  log("STEALTH_UA", `UA pool shuffled (${UA_POOL.length} agents)`)
}

// ── 2. randomizedJitter(5000, 15000) — applied to every action ─

export async function randomizedJitter(minMs = 5000, maxMs = 15000) {
  const delay = minMs + Math.random() * (maxMs - minMs)
  const jitter = delay * (0.1 + Math.random() * 0.3) * (Math.random() > 0.5 ? 1 : -1)
  const final = Math.max(1000, Math.round(delay + jitter))
  log("STEALTH_JITTER", `waiting ${final}ms`, { base: Math.round(delay), jitter: Math.round(jitter) })
  await new Promise(r => setTimeout(r, final))
}

// ── 3. Warm-up Sequence — build trust session before target ────

const WARMUP_SITES = [
  "https://www.google.com/",
  "https://www.wikipedia.org/",
  "https://www.bing.com/",
  "https://news.google.com/",
  "https://www.bbc.com/news",
  "https://www.stackoverflow.com/",
]

export async function runWarmupSequence(page, count = 3) {
  const sites = [...WARMUP_SITES].sort(() => Math.random() - 0.5).slice(0, count)
  log("STEALTH_WARMUP", `Starting warm-up (${count} pages)`, { sites })
  for (const url of sites) {
    try {
      await randomizedJitter(3000, 8000)
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      log("STEALTH_WARMUP", `Visited "${url}"`, { status: resp?.status() || "timeout" })
      await simulateHumanBehavior(page)
      await humanScroll(page, 0, 200 + Math.random() * 300)
      await waitForStabilization(page, 2000)
      log("STEALTH_WARMUP", `Completed warm-up on "${url}"`)
    } catch (e) {
      log("STEALTH_WARMUP", `Skipped "${url}"`, { error: e.message?.substring(0, 60) })
    }
  }
  log("STEALTH_WARMUP", "Warm-up sequence complete")
}

// ── 4. Masked Browser w/ user-data-dir ─────────────────────────

const BROWSER_SESSIONS = {}

function userDataDir(hostname) {
  const safe = hostname.replace(/[^a-z0-9.]/g, "_")
  return path.join(STEALTH_DIR, safe)
}

export async function createStealthBrowser(hostname = "default") {
  shuffleUAPool()
  initSessionFingerprint()
  const fp = getSessionFingerprint()
  const ua = pickUA()
  const udDir = userDataDir(hostname)

  log("STEALTH", `Creating stealth browser for "${hostname}"`, {
    fingerprint: fp.profile.name || "random",
    ua: ua.substring(0, 40),
    userDataDir: udDir,
  })

  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-features=BlockInsecurePrivateNetworkRequests",
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas", "--no-first-run", "--no-zygote",
    "--disable-gpu",
  ]

  const persistentContext = await chromium.launchPersistentContext(udDir, {
    headless: false,
    args: launchArgs,
    ...buildContextOptions(fp),
    userAgent: ua,
    locale: fp.profile.locale || "en-US",
    timezoneId: fp.profile.timezone || "Asia/Riyadh",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
    },
  })

  await persistentContext.addInitScript(buildStealthScript(fp.profile, true))
  const page = await persistentContext.newPage()
  const browser = persistentContext.browser()

  BROWSER_SESSIONS[hostname] = { browser, context: persistentContext, page, ua, fingerprint: fp, createdAt: Date.now() }
  log("STEALTH_OK", `Persistent browser launched for "${hostname}"`, { persistent: udDir })

  return { browser, context: persistentContext, page, ua, fingerprint: fp }
}

export function closeStealthBrowser(hostname = "default") {
  const session = BROWSER_SESSIONS[hostname]
  if (!session) return
  try {
    session.context.close().catch(() => {})
  } catch {}
  delete BROWSER_SESSIONS[hostname]
  log("STEALTH", `Persistent context closed for "${hostname}"`)
}

export function closeAllStealthBrowsers() {
  for (const host of Object.keys(BROWSER_SESSIONS)) {
    closeStealthBrowser(host)
  }
}

// ── 5. Session Locking — persist & reuse cookies ───────────────

const sessionLocks = {}

export async function lockSession(hostname, context) {
  try {
    const cookies = await context.cookies()
    const sessionPath = path.join(STEALTH_DIR, `${hostname.replace(/[^a-z0-9.]/g, "_")}_session.json`)
    const sessionData = {
      hostname,
      cookies,
      lockedAt: getTimestamp(),
    }
    fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), "utf-8")
    sessionLocks[hostname] = sessionData
    log("STEALTH_SESSION", `Session locked for "${hostname}"`, { cookies: cookies.length })
    recordCheck(hostname, "stealth-first", "SUCCESS", {
      locked: true,
      cookiesSaved: cookies.length,
    })
    return true
  } catch (e) {
    log("STEALTH_FAIL", `Session lock failed for "${hostname}"`, { error: e.message })
    return false
  }
}

export function hasSessionLock(hostname) {
  if (sessionLocks[hostname]) return true
  const sessionPath = path.join(STEALTH_DIR, `${hostname.replace(/[^a-z0-9.]/g, "_")}_session.json`)
  if (!fs.existsSync(sessionPath)) return false
  try {
    const data = JSON.parse(fs.readFileSync(sessionPath, "utf-8"))
    sessionLocks[hostname] = data
    return true
  } catch {
    return false
  }
}

export async function restoreSessionLock(hostname, context) {
  const sessionPath = path.join(STEALTH_DIR, `${hostname.replace(/[^a-z0-9.]/g, "_")}_session.json`)
  if (!fs.existsSync(sessionPath)) return false
  try {
    const data = JSON.parse(fs.readFileSync(sessionPath, "utf-8"))
    if (data.cookies && data.cookies.length > 0) {
      await context.addCookies(data.cookies)
      sessionLocks[hostname] = data
      log("STEALTH_SESSION", `Session restored for "${hostname}"`, { cookies: data.cookies.length, from: data.lockedAt })
      return true
    }
  } catch (e) {
    log("STEALTH_FAIL", `Session restore failed for "${hostname}"`, { error: e.message })
  }
  return false
}

// ── Stealth-First Navigation with full jitter + humanizing ─────

export async function stealthNavigate(page, url, opts = {}) {
  const { jitterMin = 5000, jitterMax = 15000 } = opts
  await randomizedJitter(jitterMin, jitterMax)
  log("STEALTH", `Navigating to "${url?.substring(0, 70)}"`)
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await randomizedJitter(3000, 8000)
    await simulateHumanBehavior(page)
    await waitForStabilization(page, 2000)
    const status = resp?.status()
    if (status && status >= 400) {
      log("STEALTH_FAIL", `HTTP ${status} for "${url?.substring(0, 60)}"`)
    }
    return resp
  } catch (e) {
    log("STEALTH_FAIL", `Navigation failed for "${url?.substring(0, 60)}"`, { error: e.message?.substring(0, 80) })
    throw e
  }
}

// ── High-level Stealth-First pipeline wrapper ──────────────────

export async function runStealthPipeline(hostname, searchFn) {
  const sessionManager = createSessionManager(hostname)
  let browser = null

  try {
    log("STEALTH", `Stealth-First pipeline starting for "${hostname}"`)

    // 4) Create masked browser with persistent user-data-dir
    const stealth = await createStealthBrowser(hostname)
    browser = stealth.browser
    const page = stealth.page

    // 5) Restore previous session if available
    const restored = await restoreSessionLock(hostname, stealth.context)
    if (restored) {
      log("STEALTH_OK", `Session restored — skipping warm-up (trust reused)`)
    } else {
      // 3) Warm-up: visit 2-3 non-target pages first
      await runWarmupSequence(page, 2 + Math.floor(Math.random() * 2))
    }

    // 1) Fingerprint is already applied via createStealthBrowser
    // 2) Jitter applied on every action via stealthNavigate

    // Run the actual search function
    const result = await searchFn(stealth.browser, stealth.context, stealth.page)

    // 5) Lock the session for future reuse
    await lockSession(hostname, stealth.context)

    return result
  } finally {
    if (browser) {
      await randomizedJitter(2000, 5000)
      closeStealthBrowser(hostname)
    }
  }
}

export { UA_POOL, WARMUP_SITES }

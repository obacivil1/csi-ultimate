/**
 * live-verifier.mjs — Live-Verification Loop & Safety Monitor
 * ───────────────────────────────────────────────────────────
 * Every strategy undergoes a 'Live-Check' phase before being
 * marked as 'Successful'. The agent must attempt authentication
 * and a single data-fetch operation, verifying the data is valid.
 *
 * Responsibilities:
 *   - Run Live-Check on a candidate strategy
 *   - Attempt login (via SessionManager)
 *   - Fetch a single data page, verify non-empty structured data
 *   - Detect HARD BAN (CAPTCHA, permanent block)
 *   - Report results to StrategyLedger
 *   - Monitor success rate, trigger re-evaluation when below 80%
 *   - Halt execution on hard-ban (never loop into ban state)
 *
 * Tags: [[LIVE_VERIFY]] [[LIVE_OK]] [[LIVE_FAIL]] [[LIVE_HARD_BAN]]
 *       [[LIVE_RE_EVALUATE]]
 */

import { getVerifiedStrategy, recordCheck, getSuccessRate, isBelowThreshold, markHardBan, clearHostname } from "./strategy-ledger.mjs"
import { createSessionManager } from "./session-manager.mjs"
import { createStealthContext } from "./strategy-engine.mjs"
import { extractAdData, deepExtraction } from "./bridge.mjs"
import { Jitter, ErrorRecovery } from "./strategy-engine.mjs"

const WEBHOOK_URL = process.env.CSI_ALERT_URL || ""

function getTimestamp() {
  return new Date().toISOString()
}

function log(tag, msg, meta) {
  const ts = getTimestamp().replace("T", " ").substring(0, 19)
  const extra = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[${ts}] [[${tag}]] ${msg}${extra}`)
}

async function sendWebhook(severity, message, meta = {}) {
  log(`WEBHOOK_ALERT`, `[${severity}] ${message}`, meta)
  if (!WEBHOOK_URL) return
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ severity, message, meta, timestamp: getTimestamp(), source: "live-verifier" }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {}
}

// ── Hard-Ban Detection ────────────────────────────────────────

const HARD_BAN_PATTERNS = [
  "captcha", "recaptcha", "hcaptcha", "cf-turnstile",
  "your ip has been blocked", "access denied", "permanently blocked",
  "you have been blocked from accessing", "your request has been blocked",
  "we've detected unusual activity", "sorry, you are not allowed to access",
  "automated access denied", "we are unable to process your request",
  "please contact the site administrator",
  "error 1010", "error 1015", "error 1020", "error 1009",
  "pardon our interruption", "please complete the security check",
]

async function checkHardBan(page) {
  try {
    const title = await page.title().catch(() => "")
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || "").catch(() => "")
    const html = await page.evaluate(() => document.documentElement?.innerHTML?.substring(0, 5000) || "").catch(() => "")
    const combined = (title + " " + text + " " + html).toLowerCase()

    for (const pattern of HARD_BAN_PATTERNS) {
      if (combined.includes(pattern)) {
        // Check for CAPTCHA specifically — these might be solvable
        if (pattern.includes("captcha")) {
          log("LIVE_VERIFY", `CAPTCHA detected`, { pattern })
          return { hardBan: true, type: "CAPTCHA", pattern }
        }
        return { hardBan: true, type: "HARD_BAN", pattern }
      }
    }

    // Check for HTTP status code indications in the page
    const statusMatch = text.match(/\b(403|429|503)\b/)
    if (statusMatch) {
      return { hardBan: true, type: `HTTP_${statusMatch[1]}`, pattern: "status_code" }
    }

    return { hardBan: false }
  } catch {
    return { hardBan: false }
  }
}

// ── Data Validation ───────────────────────────────────────────

function isValidExtraction(data) {
  if (!data) return false
  const hasTitle = data.title && data.title.length > 0 && data.title !== "N/A"
  const hasContent = data.description && data.description.length > 50
  const hasContact = data.phone || data.email
  const hasPrice = data.price
  const fields = Object.values(data).filter(v => v && v !== "N/A" && v !== "").length
  // Valid if: title + any meaningful content, or contact info, or 4+ non-empty fields
  return (hasTitle && (hasContent || hasContact || hasPrice)) || fields >= 4
}

// ── Live-Verification Orchestrator ────────────────────────────

/**
 * Live verification sequence:
 *   1. Restore or attempt session (auth)
 *   2. Navigate to a single ad or search page
 *   3. Extract data
 *   4. Validate data is non-empty, structured
 *   5. Check for hard-ban
 *   6. Record result to ledger
 *
 * @param {Browser}   browser
 * @param {string}    hostname
 * @param {string}    strategyName  - "A-Standard", "B-Proxy", "C-HeadedHuman"
 * @param {string}    testUrl       - A known-good ad URL or search URL
 * @param {object}    siteConfig    - Site configuration from sites.json
 * @returns {Promise<{verified: boolean, strategy: string, identity?: object, hardBan?: boolean}>}
 */
export async function runLiveVerification(browser, hostname, strategyName, testUrl, siteConfig) {
  log("LIVE_VERIFY", `Starting live-check for "${hostname}" via "${strategyName}"`)

  // ── 1. Authentication ──────────────────────────────────────
  const sessionManager = createSessionManager(hostname)

  const authResult = await sessionManager.attemptLogin(browser)
  if (!authResult.success) {
    if (authResult.requiresUserInput) {
      const msg = `CAPTCHA or user-intervention required for ${hostname}`
      log("LIVE_FAIL", msg, authResult.debugLog)
      await sendWebhook("CRITICAL", msg, authResult.debugLog)
      recordCheck(hostname, strategyName, "AUTH_FAIL", {
        error: authResult.error,
        requiresUserInput: true,
      })
      return { verified: false, strategy: strategyName, requiresUserInput: true, debugLog: authResult.debugLog }
    }

    log("LIVE_FAIL", `Auth failed for "${hostname}"`, { error: authResult.error })
    recordCheck(hostname, strategyName, "AUTH_FAIL", { error: authResult.error })
    return { verified: false, strategy: strategyName, error: authResult.error }
  }

  // ── 2. Create stealth context ──────────────────────────────
  const { context, page, profile } = await createStealthContext(browser, strategyName)
  try {
    // Restore session if available
    if (sessionManager.isSessionValid()) {
      await sessionManager.restoreSession(context)
    }

    // ── 3. Navigate to test URL ──────────────────────────────
    log("LIVE_VERIFY", `Fetching test URL for "${hostname}"`)
    await Jitter.delay(1000, 4000)

    let resp
    try {
      resp = await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    } catch (e) {
      // Check if this is a DNS/network error (hard-ban signal)
      if (e.message?.includes("ERR_NAME_NOT_RESOLVED") || e.message?.includes("ENOTFOUND")) {
        log("LIVE_HARD_BAN", `DNS resolution failed for "${hostname}" — possible site-wide block`)
        await sendWebhook("CRITICAL", `Site-wide block detected: DNS failure for ${hostname}`, {
          error: e.message?.substring(0, 100),
          strategy: strategyName,
        })
        markHardBan(hostname, strategyName, { error: e.message?.substring(0, 100), type: "DNS_BLOCK" })
        return { verified: false, strategy: strategyName, hardBan: true, error: e.message }
      }
      throw e
    }

    const status = resp?.status()

    // ── 4. Hard-ban check ────────────────────────────────────
    const banCheck = await checkHardBan(page)
    if (banCheck.hardBan) {
      log("LIVE_HARD_BAN", `Hard ban detected for "${hostname}"`, { type: banCheck.type, pattern: banCheck.pattern })
      await sendWebhook("CRITICAL", `Hard ban on ${hostname} — ALL OPERATIONS STOPPED`, {
        type: banCheck.type,
        pattern: banCheck.pattern,
        strategy: strategyName,
        statusCode: status,
      })
      markHardBan(hostname, strategyName, {
        type: banCheck.type,
        pattern: banCheck.pattern,
        statusCode: status,
      })
      return { verified: false, strategy: strategyName, hardBan: true, type: banCheck.type }
    }

    // ── 5. Check for block ───────────────────────────────────
    if (status === 403 || status === 429 || status === 503) {
      log("LIVE_FAIL", `HTTP ${status} for "${hostname}" via "${strategyName}"`)
      recordCheck(hostname, strategyName, "BLOCKED", { statusCode: status })
      return { verified: false, strategy: strategyName, blocked: true, statusCode: status }
    }

    // ── 6. Extract & validate ────────────────────────────────
    await Jitter.delay(2000, 5000)
    let data
    try {
      data = await extractAdData(page, siteConfig)
    } catch (e) {
      log("LIVE_FAIL", `Extraction failed during live-check`, { error: e.message?.substring(0, 80) })
      // Try deep extraction as fallback
      data = await deepExtraction(page, siteConfig, "live_check").catch(() => null)
    }

    // If extraction returned null/empty, try deep extraction
    if (!data || !isValidExtraction(data)) {
      data = await deepExtraction(page, siteConfig, "live_check").catch(() => null)
    }

    const isValid = isValidExtraction(data)

    if (isValid) {
      log("LIVE_OK", `Live-check PASSED for "${hostname}" via "${strategyName}"`, {
        fields: Object.keys(data).filter(k => data[k]).length,
        hasTitle: !!data?.title,
        hasContact: !!(data?.phone || data?.email),
      })

      recordCheck(hostname, strategyName, "SUCCESS", {
        fields: Object.keys(data).filter(k => data[k]).length,
        fingerprintId: profile?.fingerprintId || "generic",
        ua: page.context()?.userAgent?.()?.substring(0, 80) || "",
        viewport: `${page.viewport()?.width || 0}x${page.viewport()?.height || 0}`,
      })

      // Lock identity
      const identity = {
        fingerprintId: `profile_${Math.floor(Math.random() * 8) + 1}`,
        ua: page.context()?.userAgent?.()?.substring(0, 100) || "",
        viewport: `${page.viewport()?.width || 0}x${page.viewport()?.height || 0}`,
      }
      sessionManager.lockIdentity(identity)

      return {
        verified: true,
        strategy: strategyName,
        identity,
        data,
      }
    }

    // ── 7. Data was invalid ──────────────────────────────────
    log("LIVE_FAIL", `Live-check returned invalid data for "${hostname}"`, {
      dataKeys: data ? Object.keys(data).filter(k => data[k]) : "null",
    })
    recordCheck(hostname, strategyName, "ERROR", { reason: "Invalid data", dataKeys: data ? Object.keys(data) : [] })
    return { verified: false, strategy: strategyName, error: "Invalid or empty data" }

  } catch (e) {
    log("LIVE_FAIL", `Live-check failed for "${hostname}" via "${strategyName}"`, {
      error: e.message?.substring(0, 100),
    })
    recordCheck(hostname, strategyName, "ERROR", { error: e.message?.substring(0, 200) })
    return { verified: false, strategy: strategyName, error: e.message }
  } finally {
    await page.close().catch(() => {})
    await context.close().catch(() => {})
  }
}

// ── Strategy Re-evaluation ─────────────────────────────────────

/**
 * evaluateStrategies — Run live-verify against all strategies
 * to discover which one works for a hostname.
 *
 * @param {Browser} browser
 * @param {string}  hostname
 * @param {array}   strategyNames  - ["A-Standard", "B-Proxy", "C-HeadedHuman"]
 * @param {string}  testUrl
 * @param {object}  siteConfig
 * @returns {Promise<{verified: boolean, strategy: string|null, identity: object|null}>}
 */
export async function evaluateStrategies(browser, hostname, strategyNames, testUrl, siteConfig) {
  log("LIVE_RE_EVALUATE", `Running full strategy evaluation for "${hostname}"`, { strategies: strategyNames })

  for (const strategyName of strategyNames) {
    log("LIVE_RE_EVALUATE", `Trying strategy "${strategyName}"...`)

    const result = await runLiveVerification(browser, hostname, strategyName, testUrl, siteConfig)

    if (result.verified) {
      log("LIVE_RE_EVALUATE", `Strategy "${strategyName}" verified for "${hostname}"`)
      return result
    }

    if (result.hardBan) {
      log("LIVE_RE_EVALUATE", `Hard ban encountered — stopping evaluation`, { type: result.type })
      return { verified: false, strategy: null, hardBan: true, type: result.type }
    }

    // Short delay between strategy attempts
    await Jitter.delay(2000, 5000)
  }

  log("LIVE_RE_EVALUATE", `All strategies failed verification for "${hostname}"`)
  return { verified: false, strategy: null }
}

// ── Live-Check Summary ────────────────────────────────────────

export function getLiveVerifierInfo() {
  return {
    module: "live-verifier.mjs",
    version: "1.0",
    hardBanPatterns: HARD_BAN_PATTERNS.length,
    threshold: "80%",
  }
}

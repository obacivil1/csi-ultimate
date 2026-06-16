/**
 * interaction-engine.mjs — Thread B: Human Interaction Simulator
 * ──────────────────────────────────────────────────────────────
 * Implements the Professional Click Protocol:
 *   - professionalClick(page, selector) with human mouse movement + CAPTCHA guard
 *   - extractHiddenData(page) — click reveal buttons (Show Phone, Easy Apply, etc.)
 *   - injectSessionCookies(context, hostname) — Layer 3: session injection
 *   - enableNetworkCapture(page) — Layer 4: network listener for API data
 *   - detectCaptcha(page) — DOM scan for captcha/verification elements
 *
 * Tags: [[INTERACTION]] [[INTERACTION_CLICK]] [[INTERACTION_BLOCKED]]
 *       [[INTERACTION_REVEAL]] [[INTERACTION_NETWORK]] [[INTERACTION_OK]]
 */
import fs from "fs"
import path from "path"
import { randomDelay, humanMouseMove, humanClick, waitForStabilization } from "./behavior-engine.mjs"
import { recordCheck } from "./strategy-ledger.mjs"
import { Jitter } from "./strategy-engine.mjs"

const STATE_DIR = path.resolve(import.meta.dirname, "..", "state")
const STEALTH_DIR = path.join(STATE_DIR, "stealth-sessions")
if (!fs.existsSync(STEALTH_DIR)) fs.mkdirSync(STEALTH_DIR, { recursive: true })

function getTimestamp() { return new Date().toISOString() }

function log(tag, msg, meta) {
  const ts = getTimestamp().replace("T", " ").substring(0, 19)
  const extra = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[${ts}] [[${tag}]] ${msg}${extra}`)
}

// ── CAPTCHA Detection ──────────────────────────────────────────

const CAPTCHA_PATTERNS = [
  "captcha", "recaptcha", "hcaptcha", "cf-turnstile", "cf-challenge",
  "g-recaptcha", "data-sitekey", "challenge-platform",
  "iframe[src*='captcha']", "iframe[src*='recaptcha']",
  "[class*='g-recaptcha']", "[class*='h-captcha']",
  "div[class*='challenge']", "#captcha", ".captcha",
  "nop Captcha", "are you a human", "security check",
]

export async function detectCaptcha(page) {
  try {
    const html = await page.evaluate(() => {
      return document.documentElement?.innerHTML?.substring(0, 10000) || ""
    }).catch(() => "")
    const text = (await page.title().catch(() => "") + " " +
      await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || "").catch(() => "")
    ).toLowerCase()

    for (const pattern of CAPTCHA_PATTERNS) {
      if (html.includes(pattern) || text.includes(pattern)) {
        log("INTERACTION_BLOCKED", `CAPTCHA detected via pattern "${pattern}"`)
        return { blocked: true, pattern }
      }
    }

    const captchaEl = await page.evaluate(() => {
      const el = document.querySelector(
        'iframe[src*="captcha"], iframe[src*="recaptcha"], ' +
        '[class*="g-recaptcha"], [class*="h-captcha"], ' +
        '#captcha, .captcha, div[class*="challenge"], ' +
        '[class*="cf-turnstile"]'
      )
      return el ? true : false
    }).catch(() => false)

    if (captchaEl) {
      log("INTERACTION_BLOCKED", "CAPTCHA element found in DOM")
      return { blocked: true, pattern: "DOM_element" }
    }

    return { blocked: false }
  } catch (e) {
    return { blocked: false }
  }
}

// ── Layer 3: Session Injection ─────────────────────────────────

export async function injectSessionCookies(context, hostname) {
  const safeHost = hostname.replace(/[^a-z0-9.]/g, "_")
  const sessionPath = path.join(STEALTH_DIR, `${safeHost}_session.json`)
  if (!fs.existsSync(sessionPath)) {
    log("INTERACTION", `No saved session to inject for "${hostname}"`)
    return false
  }
  try {
    const data = JSON.parse(fs.readFileSync(sessionPath, "utf-8"))
    if (data.cookies && data.cookies.length > 0) {
      await context.addCookies(data.cookies)
      log("INTERACTION_OK", `Injected ${data.cookies.length} session cookies for "${hostname}"`, {
        from: data.lockedAt || "unknown",
      })
      recordCheck(hostname, "session-injection", "SUCCESS", {
        cookiesInjected: data.cookies.length,
      })
      return true
    }
  } catch (e) {
    log("INTERACTION", `Session injection failed for "${hostname}"`, { error: e.message })
  }
  return false
}

// ── Layer 4: Network Capture ───────────────────────────────────

const capturedApiData = {}

export async function enableNetworkCapture(page, hostname) {
  const apiCalls = []
  capturedApiData[hostname] = apiCalls

  page.on("response", async (response) => {
    try {
      const url = response.url()
      if (response.status() === 200 && (
        url.includes("/api/") || url.includes("/graphql") ||
        url.includes("/rest/") || url.includes("/ajax/") ||
        url.includes("json") || url.includes("application/json")
      )) {
        const contentType = response.headers()["content-type"] || ""
        if (contentType.includes("json")) {
          const text = await response.text().catch(() => "")
          if (text && text.length < 50000) {
            apiCalls.push({
              url: url.substring(0, 150),
              status: response.status(),
              timestamp: Date.now(),
              preview: text.substring(0, 500),
            })
            log("INTERACTION_NETWORK", `Captured API: ${url.substring(0, 80)}`, {
              size: text.length,
            })
          }
        }
      }
    } catch {}
  })

  log("INTERACTION_NETWORK", `Network capture enabled for "${hostname}"`)
  return apiCalls
}

export function getCapturedApiData(hostname) {
  return capturedApiData[hostname] || []
}

export function clearCapturedApiData(hostname) {
  delete capturedApiData[hostname]
}

// ── Professional Click (Human Simulation + CAPTCHA Guard) ──────

export async function professionalClick(page, selector, opts = {}) {
  const {
    jitterMin = 1000,
    jitterMax = 3000,
    checkCaptcha = true,
    waitForNav = true,
    navTimeout = 30000,
  } = opts

  log("INTERACTION_CLICK", `Professional click on "${selector}"`)

  // 1. CAPTCHA guard — check before any interaction
  if (checkCaptcha) {
    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      log("INTERACTION_BLOCKED", `Skipping click on "${selector}" — CAPTCHA present`, {
        pattern: captcha.pattern,
      })
      return { clicked: false, blocked: true, reason: "CAPTCHA" }
    }
  }

  try {
    // 2. Verify element exists
    const el = await page.waitForSelector(selector, { timeout: 8000 }).catch(() => null)
    if (!el) {
      log("INTERACTION", `Selector "${selector}" not found — skipping`)
      return { clicked: false, reason: "ELEMENT_NOT_FOUND" }
    }

    // 3. Scroll element into view with human-like scroll
    await el.scrollIntoViewIfNeeded()
    await Jitter.delay(300, 800)

    // 4. Human mouse movement to element (Bézier curve)
    const box = await el.boundingBox()
    if (box) {
      const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * 6
      const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 6
      const moved = await humanMouseMove(page, selector)
      if (!moved) {
        // Manual mouse move fallback
        await page.mouse.move(targetX, targetY, { steps: 8 + Math.floor(Math.random() * 8) })
      }
    }

    // 5. Random delay before click (human hesitation)
    await Jitter.delay(jitterMin, jitterMax)

    // 6. CAPTCHA guard — check again right before click
    if (checkCaptcha) {
      const captcha = await detectCaptcha(page)
      if (captcha.blocked) {
        log("INTERACTION_BLOCKED", `Aborted click — CAPTCHA appeared during hesitation`, {
          pattern: captcha.pattern,
        })
        return { clicked: false, blocked: true, reason: "CAPTCHA_APPEARED" }
      }
    }

    // 7. The actual click with random delay
    await page.click(selector, { delay: 30 + Math.random() * 150 })

    // 8. Wait for page response
    if (waitForNav) {
      try {
        await page.waitForNavigation({ waitUntil: "networkidle", timeout: navTimeout }).catch(() => {
          // Navigation might not happen (e.g., modal, XHR)
        })
      } catch {}
    }

    await Jitter.delay(500, 2000)
    log("INTERACTION_OK", `Professional click successful on "${selector}"`)
    return { clicked: true }
  } catch (e) {
    log("INTERACTION", `Click failed on "${selector}"`, { error: e.message?.substring(0, 80) })
    return { clicked: false, reason: e.message?.substring(0, 100) || "CLICK_FAILED" }
  }
}

// ── Click Reveal Buttons (Show Phone, Easy Apply, etc.) ───────

const REVEAL_SELECTORS = [
  'a[href^="tel:"]', 'button[class*="phone"]', 'button[class*="show"]',
  '[class*="show-phone"]', '[class*="reveal"]', '[class*="apply"]',
  '[data-q*="phone"]', '[id*="phone"]',
  'button:has-text("Phone")', 'button:has-text("Show")',
  'button:has-text("Apply")', 'button:has-text("Contact")',
  'a:has-text("Easy Apply")', 'button:has-text("Easy Apply")',
]

export async function extractHiddenData(page, siteConfig = {}) {
  log("INTERACTION_REVEAL", "Attempting to reveal hidden contact data")
  const revealed = { phone: null, email: null, applied: false }

  // Try each reveal selector
  for (const sel of REVEAL_SELECTORS) {
    const btn = await page.$(sel).catch(() => null)
    if (!btn) continue

    const text = await btn.innerText().catch(() => "")
    const isVisible = await btn.isVisible().catch(() => false)
    if (!isVisible) continue

    log("INTERACTION_REVEAL", `Found reveal button "${sel}"`, { text: text?.substring(0, 30) })

    const result = await professionalClick(page, sel, {
      jitterMin: 500,
      jitterMax: 2000,
      waitForNav: false,
    })

    if (result.clicked) {
      // Wait for content to appear
      await Jitter.delay(1000, 3000)

      // Check for phone numbers that appeared
      const phone = await page.evaluate(() => {
        const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'))
        if (telLinks.length > 0) return telLinks[0].href.replace("tel:", "").replace(/[^0-9+]/g, "")
        const text = document.body.innerText
        const m = text.match(/[\+\d][\d\s\-\(\)]{7,15}[\d]/)
        if (m) return m[0].replace(/[^\d+]/g, "")
        return null
      }).catch(() => null)

      if (phone) {
        revealed.phone = phone
        log("INTERACTION_REVEAL", `Phone revealed via "${sel}"`, { phone })
      }

      // Check for emails
      const email = await page.evaluate(() => {
        const mailLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
        if (mailLinks.length > 0) return mailLinks[0].href.replace("mailto:", "")
        const m = document.body.innerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
        if (m && !/noreply|no-reply|example\.com/i.test(m[0])) return m[0]
        return null
      }).catch(() => null)

      if (email) {
        revealed.email = email
        log("INTERACTION_REVEAL", `Email revealed via "${sel}"`, { email })
      }

      // Check if this was an apply button
      const btnText = (text || "").toLowerCase()
      if (btnText.includes("apply") || btnText.includes("easy")) {
        revealed.applied = true
      }
    }
  }

  // Secondary pass: scan page for contact info that may have appeared via JS
  if (!revealed.phone || !revealed.email) {
    await Jitter.delay(500, 1500)
    const pageText = await page.evaluate(() => document.body?.innerText || "").catch(() => "")
    if (!revealed.phone) {
      const pm = pageText.match(/[\+\d][\d\s\-\(\)]{7,15}[\d]/)
      if (pm) revealed.phone = pm[0].replace(/[^\d+]/g, "")
    }
    if (!revealed.email) {
      const em = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
      if (em && !/noreply|no-reply|example\.com/i.test(em[0])) revealed.email = em[0]
    }
  }

  const found = [revealed.phone ? "phone" : null, revealed.email ? "email" : null].filter(Boolean)
  log("INTERACTION_REVEAL", `Reveal complete — found: ${found.join(", ") || "nothing new"}`)
  return revealed
}

// ── Full Interaction Pipeline ──────────────────────────────────

export async function runInteractionPipeline(page, context, hostname, siteConfig) {
  log("INTERACTION", `Starting interaction pipeline for "${hostname}"`)

  // Layer 3: Inject session cookies before any interaction
  const sessionInjected = await injectSessionCookies(context, hostname)
  log("INTERACTION", `Layer 3 (Session Injection): ${sessionInjected ? "active" : "no session available"}`)

  // Layer 4: Enable network capture
  const apiData = await enableNetworkCapture(page, hostname)
  log("INTERACTION", `Layer 4 (Network Listen): ${apiData ? "active" : "failed"}`)

  // Extract hidden data via reveals
  const hiddenData = await extractHiddenData(page, siteConfig)

  // Check for any API data that contained contact info
  const captured = getCapturedApiData(hostname)
  let apiPhone = null
  let apiEmail = null
  for (const call of captured) {
    if (call.preview) {
      const pm = call.preview.match(/[\+\d][\d\s\-\(\)]{7,15}[\d]/)
      if (pm) apiPhone = pm[0].replace(/[^\d+]/g, "")
      const em = call.preview.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
      if (em && !/noreply|no-reply|example\.com/i.test(em[0])) apiEmail = em[0]
    }
  }

  if (apiPhone || apiEmail) {
    log("INTERACTION_NETWORK", `Found contact data via API: ${apiPhone ? "phone " : ""}${apiEmail ? "email" : ""}`)
  }

  clearCapturedApiData(hostname)

  return {
    hiddenData,
    sessionInjected,
    apiCaptured: captured.length,
    apiPhone,
    apiEmail,
  }
}

export { CAPTCHA_PATTERNS, REVEAL_SELECTORS }

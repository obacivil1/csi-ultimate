/**
 * session-manager.mjs — Authentication Mastery & Identity Persistence
 * ────────────────────────────────────────────────────────────────────
 * Manages cookies, tokens, and browser sessions for authenticated sites.
 *
 * Features:
 *   - Login attempt with stored credentials (from env vars)
 *   - Cookie/token persistence across sessions
 *   - Session health validation
 *   - Identity Locking (fingerprint + proxy) to avoid session-drop
 *   - Webhook alerts on auth failure
 *   - Human-in-the-loop pause on critical failures
 *
 * Tags: [[SESSION]] [[SESSION_OK]] [[SESSION_FAIL]] [[SESSION_LOCK]]
 *       [[WEBHOOK_ALERT]] [[HARD_BAN]]
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATE_DIR = path.resolve(__dirname, "..", "state")
const SESSIONS_DIR = path.join(STATE_DIR, "sessions")
const WEBHOOK_URL = process.env.CSI_ALERT_URL || ""

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true })

function getTimestamp() {
  return new Date().toISOString()
}

function log(tag, msg, meta) {
  const ts = getTimestamp().replace("T", " ").substring(0, 19)
  const extra = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[${ts}] [[${tag}]] ${msg}${extra}`)
}

// ── Webhook Alert ─────────────────────────────────────────────

async function sendAlert(severity, message, meta = {}) {
  log(`WEBHOOK_ALERT`, `[${severity}] ${message}`, meta)
  if (!WEBHOOK_URL) return
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ severity, message, meta, timestamp: getTimestamp() }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (e) {
    log("WEBHOOK_ALERT", `Webhook send failed: ${e.message}`)
  }
}

// ── Session File Helpers ──────────────────────────────────────

function sessionPath(hostname) {
  return path.join(SESSIONS_DIR, `${hostname.replace(/[^a-z0-9.]/g, "_")}.json`)
}

function readSession(hostname) {
  const p = sessionPath(hostname)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"))
  } catch { return null }
}

function writeSession(hostname, data) {
  try {
    fs.writeFileSync(sessionPath(hostname), JSON.stringify(data, null, 2), "utf-8")
  } catch (e) {
    log("SESSION_FAIL", `Failed to persist session for "${hostname}"`, { error: e.message })
  }
}

// ── Credential Resolver ───────────────────────────────────────

function getCredentials(hostname) {
  // Load from env: CSI_AUTH_hostname_user, CSI_AUTH_hostname_pass
  const key = hostname.replace(/[^a-z0-9]/gi, "_").toLowerCase()
  const user = process.env[`CSI_AUTH_${key}_USER`] || process.env[`CSI_AUTH_${key}_U`] || ""
  const pass = process.env[`CSI_AUTH_${key}_PASS`] || process.env[`CSI_AUTH_${key}_P`] || ""
  const token = process.env[`CSI_AUTH_${key}_TOKEN`] || process.env[`CSI_AUTH_${key}_T`] || ""

  // Generic fallbacks
  const genUser = process.env.CSI_AUTH_USER || process.env.CSI_USER || ""
  const genPass = process.env.CSI_AUTH_PASS || process.env.CSI_PASS || ""
  const genToken = process.env.CSI_AUTH_TOKEN || process.env.CSI_TOKEN || ""

  return {
    username: user || genUser,
    password: pass || genPass,
    token: token || genToken,
  }
}

// ── DOM Login Strategy Map ────────────────────────────────────
// Each site has its own login flow selector set.
// Extend this map for new authenticated targets.

const LOGIN_STRATEGIES = {
  "sa.indeed.com": {
    url: "https://sa.indeed.com/account/login",
    usernameSelector: "#login-email-input",
    passwordSelector: "#login-password-input",
    submitSelector: 'button[type="submit"]',
    postLoginCheck: "a[href*='dashboard'], .my-jobs, .account-dropdown",
    sessionCookie: "IDD_AUTH",
  },
  "www.indeed.com": {
    url: "https://secure.indeed.com/account/login",
    usernameSelector: "#login-email-input",
    passwordSelector: "#login-password-input",
    submitSelector: 'button[type="submit"]',
    postLoginCheck: "a[href*='dashboard']",
    sessionCookie: "IDD_AUTH",
  },
  "bayt.com": {
    url: "https://www.bayt.com/en/login/",
    usernameSelector: "#login_email",
    passwordSelector: "#login_password",
    submitSelector: '#login_form input[type="submit"], #login_form button[type="submit"]',
    postLoginCheck: ".user-menu, .profile-link",
    sessionCookie: "bayt_session",
  },
  "www.bayt.com": {
    url: "https://www.bayt.com/en/login/",
    usernameSelector: "#login_email",
    passwordSelector: "#login_password",
    submitSelector: '#login_form input[type="submit"], #login_form button[type="submit"]',
    postLoginCheck: ".user-menu, .profile-link",
    sessionCookie: "bayt_session",
  },
  "linkedin.com": {
    url: "https://www.linkedin.com/login",
    usernameSelector: "#username",
    passwordSelector: "#password",
    submitSelector: 'button[type="submit"]',
    postLoginCheck: ".feed-identity-module, .global-nav__me",
    sessionCookie: "li_at",
  },
  "expatriates.com": {
    // Expatriates does not require login for viewing
    requiresAuth: false,
  },
}

// ── Session Manager Class ─────────────────────────────────────

export class SessionManager {
  constructor(hostname) {
    this.hostname = hostname
    this.loginConfig = LOGIN_STRATEGIES[hostname] || null
    this.session = readSession(hostname) || {
      hostname,
      cookies: {},
      tokens: {},
      identity: null,
      verifiedAt: null,
      lastActivity: null,
    }
    this.identityLocked = false
  }

  /**
   * requiresAuth — Does this hostname need login?
   */
  requiresAuth() {
    return this.loginConfig?.requiresAuth !== false
  }

  /**
   * attemptLogin — Perform browser-based login for the hostname.
   *
   * @param {BrowserContext} context - Playwright browser context
   * @returns {Promise<{success: boolean, error?: string, details?: object}>}
   */
  async attemptLogin(context) {
    if (!this.requiresAuth()) {
      log("SESSION_OK", `No auth needed for "${this.hostname}"`)
      return { success: true, authNotRequired: true }
    }

    if (!this.loginConfig) {
      const msg = `No login strategy defined for "${this.hostname}"`
      log("SESSION_FAIL", msg)
      await sendAlert("ERROR", msg, { hostname: this.hostname })
      return { success: false, error: msg }
    }

    const credentials = getCredentials(this.hostname)
    if (!credentials.username || !credentials.password) {
      // Token-based auth
      if (credentials.token) {
        log("SESSION", `Using token auth for "${this.hostname}"`)
        this.session.tokens.api = credentials.token
        this._persist()
        return { success: true, authType: "token" }
      }
      const msg = `No credentials configured for "${this.hostname}". Set CSI_AUTH_${this.hostname.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_USER and _PASS`
      log("SESSION_FAIL", msg)
      await sendAlert("WARN", msg, { hostname: this.hostname })
      return { success: false, error: msg, requiresUserInput: true }
    }

    log("SESSION", `Attempting login for "${this.hostname}"...`)

    try {
      const page = await context.newPage()
      try {
        // Navigate to login page
        await page.goto(this.loginConfig.url, { waitUntil: "domcontentloaded", timeout: 30000 })
        await page.waitForTimeout(1000 + Math.random() * 2000)

        // Fill credentials with human-like typing
        await page.click(this.loginConfig.usernameSelector, { delay: 50 + Math.random() * 100 })
        await page.waitForTimeout(200 + Math.random() * 500)
        await page.fill(this.loginConfig.usernameSelector, "")
        for (const ch of credentials.username) {
          await page.keyboard.type(ch, { delay: 30 + Math.random() * 80 })
        }

        await page.waitForTimeout(200 + Math.random() * 500)
        await page.click(this.loginConfig.passwordSelector, { delay: 50 + Math.random() * 100 })
        await page.waitForTimeout(100 + Math.random() * 300)
        for (const ch of credentials.password) {
          await page.keyboard.type(ch, { delay: 20 + Math.random() * 60 })
        }

        await page.waitForTimeout(300 + Math.random() * 700)
        await page.click(this.loginConfig.submitSelector, { delay: 50 + Math.random() * 150 })

        // Wait for post-login indicator
        try {
          await page.waitForSelector(this.loginConfig.postLoginCheck, { timeout: 20000 })
        } catch {
          // Check for error messages
          const errorText = await page.evaluate(() => {
            const errorEls = document.querySelectorAll('[class*="error"], [class*="alert"], [class*="message"]')
            return Array.from(errorEls).map(e => e.innerText).join(" | ").substring(0, 500)
          }).catch(() => "")
          if (errorText) {
            throw new Error(`Login failed: ${errorText}`)
          }
          // Check if we're still on login page
          const currentUrl = page.url()
          if (currentUrl.includes("login") || currentUrl.includes("signin")) {
            throw new Error("Login page still showing after submit — possible CAPTCHA or invalid credentials")
          }
        }

        // Extract session cookies
        const cookies = await context.cookies()
        const sessionCookies = cookies.filter(c =>
          c.name.includes("session") || c.name.includes("auth") || c.name.includes("token") ||
          c.name.includes("IDD") || c.name === (this.loginConfig.sessionCookie || "")
        )

        this.session.cookies = Object.fromEntries(
          sessionCookies.map(c => [c.name, { value: c.value, domain: c.domain, expires: c.expires }])
        )
        this.session.timestamp = getTimestamp()
        this._persist()

        log("SESSION_OK", `Login successful for "${this.hostname}"`, {
          cookies: Object.keys(this.session.cookies).length,
        })
        await sendAlert("INFO", `Session established for ${this.hostname}`, {
          cookiesCount: Object.keys(this.session.cookies).length,
        })

        await page.close().catch(() => {})
        return { success: true, authType: "login" }

      } catch (e) {
        await page.close().catch(() => {})
        throw e
      }

    } catch (e) {
      const msg = e.message || "Unknown login error"
      log("SESSION_FAIL", `Login failed for "${this.hostname}"`, { error: msg.substring(0, 200) })
      await sendAlert("ERROR", `Login failed for ${this.hostname}`, { error: msg.substring(0, 200) })

      return {
        success: false,
        error: msg,
        requiresUserInput: msg.includes("CAPTCHA") || msg.includes("captcha"),
        debugLog: {
          hostname: this.hostname,
          timestamp: getTimestamp(),
          loginUrl: this.loginConfig.url,
          error: msg,
          suggests: msg.includes("CAPTCHA") ? "Solve CAPTCHA manually or rotate proxy" :
                    msg.includes("credentials") ? "Check username/password env vars" :
                    "Check site availability and login flow",
        },
      }
    }
  }

  /**
   * restoreSession — Apply stored cookies/tokens to a context.
   *
   * @param {BrowserContext} context
   * @returns {Promise<boolean>} true if session was restored
   */
  async restoreSession(context) {
    if (!this.session.cookies || Object.keys(this.session.cookies).length === 0) {
      log("SESSION", `No stored session for "${this.hostname}"`)
      return false
    }

    try {
      const cookies = Object.entries(this.session.cookies).map(([name, data]) => ({
        name,
        value: data.value,
        domain: data.domain || `.${this.hostname}`,
        path: "/",
        httpOnly: true,
        secure: true,
        expires: data.expires || Math.floor(Date.now() / 1000) + 86400,
      }))
      await context.addCookies(cookies)
      log("SESSION_OK", `Restored ${cookies.length} session cookies for "${this.hostname}"`)
      return true
    } catch (e) {
      log("SESSION_FAIL", `Failed to restore session for "${this.hostname}"`, { error: e.message })
      return false
    }
  }

  /**
   * lockIdentity — Permanently lock this identity (fingerprint + proxy)
   * to prevent session-drop triggers.
   *
   * @param {object} identity - { fingerprintId, ua, proxy, viewport }
   */
  lockIdentity(identity) {
    if (this.identityLocked) {
      log("SESSION", `Identity already locked for "${this.hostname}"`, this.session.identity)
      return
    }
    this.session.identity = {
      ...identity,
      lockedAt: getTimestamp(),
    }
    this.identityLocked = true
    this._persist()
    log("SESSION_LOCK", `Identity locked for "${this.hostname}"`, {
      fingerprintId: identity.fingerprintId,
      proxy: identity.proxy ? "set" : "none",
    })
  }

  /**
   * isSessionValid — Quick check if stored session is still valid.
   *
   * @returns {boolean}
   */
  isSessionValid() {
    if (!this.session.timestamp) return false
    const age = Date.now() - new Date(this.session.timestamp).getTime()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours
    const valid = age < maxAge && this.session.cookies && Object.keys(this.session.cookies).length > 0
    if (!valid && this.session.timestamp) {
      log("SESSION", `Session expired for "${this.hostname}" (age=${Math.round(age / 3600000)}h)`)
    }
    return valid
  }

  /**
   * getStoredIdentity — Get the locked identity if any.
   *
   * @returns {object|null}
   */
  getStoredIdentity() {
    return this.session.identity || null
  }

  /**
   * getSessionInfo — Debug info about current session state.
   *
   * @returns {object}
   */
  getSessionInfo() {
    return {
      hostname: this.hostname,
      requiresAuth: this.requiresAuth(),
      isLoggedIn: this.isSessionValid(),
      identityLocked: this.identityLocked || !!this.session.identity,
      hasCredentials: !!getCredentials(this.hostname).username,
      hasToken: !!getCredentials(this.hostname).token,
      cookiesCount: Object.keys(this.session.cookies || {}).length,
      lastActivity: this.session.timestamp,
    }
  }

  _persist() {
    this.session.lastActivity = getTimestamp()
    writeSession(this.hostname, this.session)
  }
}

// ── Factory ───────────────────────────────────────────────────

export function createSessionManager(hostname) {
  return new SessionManager(hostname)
}

export { LOGIN_STRATEGIES, getCredentials }

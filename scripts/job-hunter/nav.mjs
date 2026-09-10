import { getRandomFingerprint, buildContextOptions, buildStealthScript, initSessionFingerprint } from "../../core/fingerprint-engine.mjs"
import { recordSiteResponse, simulateHumanBehavior } from "../../core/behavior-engine.mjs"
import { detectBan } from "../../core/rate-limiter.mjs"
import { AdaptiveRateLimiter } from "../../core/rate-limiter.mjs"

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const jitter = (ms) => ms + Math.floor(Math.random() * (ms * 0.3 + 1))

export class Session {
  constructor(browser) {
    this.browser = browser
    this.page = null
    this.context = null
    this.limiters = new Map()
    this.stat = { requests: 0, ok: 0, blocked: 0, hard: 0 }
  }

  limiter(host) {
    if (!this.limiters.has(host)) {
      this.limiters.set(host, new AdaptiveRateLimiter({ minDelay: 700, maxDelay: 12000, baseDelay: 1200, backoffFactor: 2.2, recoveryFactor: 0.9, errorThreshold: 2 }))
    }
    return this.limiters.get(host)
  }

  async freshContext(hard = false) {
    try { await this.context?.close().catch(() => {}) } catch {}
    initSessionFingerprint()
    const fp = getRandomFingerprint()
    const ctxOpts = buildContextOptions(fp)
    const context = await this.browser.newContext({
      ...ctxOpts,
      userAgent: fp.profile.ua,
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
      colorScheme: "light",
      locale: fp.profile.locale,
      timezoneId: fp.profile.timezone,
    })
    await context.addInitScript(buildStealthScript(fp.profile, true))
    if (!hard) await context.addInitScript(BASE_BYPASS)
    const page = await context.newPage()
    await page.mouse.move(80 + Math.random() * 300, 120 + Math.random() * 400)
    this.context = context
    this.page = page
    return { context, page, fingerprint: fp }
  }

  async go(url, { host = new URL(url).hostname, tries = 3, hard = false, waitFor = null } = {}) {
    const lim = this.limiter(host)
    await lim.wait()
    this.stat.requests++
    for (let attempt = 1; attempt <= tries; attempt++) {
      let httpStatus = 0
      try {
        const resp = await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 })
        httpStatus = resp?.status?.() || 0
        if (hard) await simulateHumanBehavior(this.page)
        if (waitFor) { try { await this.page.waitForSelector(waitFor, { timeout: 8000 }) } catch {} }
        await sleep(jitter(hard ? 2500 : 1200))
        const info = await this.page.evaluate(() => ({
          len: (document.body?.innerText || "").length,
          cls: Array.from(document.querySelectorAll("a")).filter(a => (a.href || "").includes("/cls/")).length,
          title: document.title || "",
          text: (document.body?.innerText || "").substring(0, 4000),
          html: document.documentElement.outerHTML,
        })).catch(() => ({ len: 0, cls: 0, title: "", text: "", html: "" }))
        const textHead = (info.title + " " + info.text).slice(0, 300)
        const isChallenge = (httpStatus === 403 && info.len < 600) || /just a moment|cf-chl|checking your browser|captcha|attention required|enable javascript|verify you are human/i.test(textHead)
        let banned = { banned: false }
        if (isChallenge) {
          banned = { banned: true, reason: "challenge", challenge: true }
        } else if (httpStatus >= 400 && httpStatus !== 404 && httpStatus !== 410) {
          banned = { banned: true, reason: `HTTP_${httpStatus}` }
        } else if (info.len < 250 && detectBan(httpStatus, textHead).banned) {
          banned = detectBan(httpStatus, textHead)
        }
        if (banned.banned) {
          this.stat.blocked++
          recordSiteResponse(host, 0, true)
          if (banned.challenge) {
            await sleep(jitter(2200 * attempt))
            if (attempt < tries) { if (!hard) await this.freshContext(false); continue }
            break
          }
          lim.onError(true)
          const waitMs = jitter(4000 * attempt * 2)
          await sleep(waitMs)
          if (attempt < tries && !hard) await this.freshContext(false)
          continue
        }
        lim.onSuccess()
        this.stat.ok++
        recordSiteResponse(host, info.len, false)
        return { ok: true, page: this.page, len: info.len, cls: info.cls, title: info.title, text: info.text, html: info.html, banned, status: httpStatus }
      } catch (e) {
        this.stat.blocked++
        recordSiteResponse(host, 0, true)
        const isHardFail = /net::ERR_(PROXY_CONNECTION_FAILED|CONNECTION_REFUSED|PROXY_AUTH|CERT)/i.test(String(e?.message))
        if (isHardFail) { lim.onError(true); await sleep(jitter(3500 * attempt)) }
        else { lim.onSuccess(); await sleep(jitter(1800 * attempt)) }
      }
    }
    return { ok: false, page: this.page }
  }
}

const BASE_BYPASS = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  const origQuery = window.navigator.permissions && window.navigator.permissions.query
  if (origQuery) {
    window.navigator.permissions.query = (p) => p.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : origQuery(p)
  }
  Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 })
`

export { sleep, jitter }

export function parseBingResults(html) {
  const out = []
  const re = /<li class="b_algo"[\s\S]*?<\/li>/g
  const hrefRe = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snipRe = /<p[^>]*>([\s\S]*?)<\/p>/g
  let m, h, s
  while ((m = re.exec(html)) !== null) {
    const blk = m[0]
    let url = null, title = "", snippet = ""
    while ((h = hrefRe.exec(blk)) !== null) { url = h[1]; title = h[2]; break }
    while ((s = snipRe.exec(blk)) !== null) { snippet = s[1]; break }
    if (url && /^https?:\/\//.test(String(url))) out.push({ url, title: strip(title), snippet: strip(snippet) })
  }
  return out
}

function strip(html) { return String(html).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim() }
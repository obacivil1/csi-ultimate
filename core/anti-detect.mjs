/**
 * CSI-Ultimate — Anti-Detection Module (Professional)
 * ─────────────────────────────────────────────────
 * Three tiers of stealth:
 *   normal   → headless, fast, resource blocking (default)
 *   hard     → headed, fresh context per ad, WebGL/Canvas/Audio spoofing
 *   extreme  → full fingerprint with font/media/WebRTC spoofing,
 *              smart content wait, mobile UA rotation, proxy rotation
 *
 * Extreme mode (--extreme) targets aggressively protected sites (Indeed, Bayt, LinkedIn)
 */
import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"

chromium.use(stealth())

import { initSessionFingerprint, rotateFingerprint, getSessionFingerprint, getRandomFingerprint, buildContextOptions, buildStealthScript } from "./fingerprint-engine.mjs"
import { randomDelay, humanClick, simulateHumanBehavior, waitForStabilization } from "./behavior-engine.mjs"
import { fetchIndeedJobs } from "./indeed-api.mjs"

// ── Rotating fingerprints ──────────────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
]
const MOBILE_UAS = [
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.147 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.179 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone14,3; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
]
const VIEWPORTS = [
  { width: 1440, height: 900 },  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },  { width: 1536, height: 864 },
  { width: 1280, height: 720 },  { width: 1720, height: 980 },
  { width: 1600, height: 900 },  { width: 1440, height: 850 },
  { width: 390, height: 844 },   { width: 412, height: 915 },
]
const TIMEZONES = ["Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar", "Asia/Bahrain", "Europe/London", "Asia/Beirut", "Asia/Muscat"]
const LOCALES   = ["en-US", "en-GB", "en-AE", "en-SA"]

// ── Base bypass script ─────────────────────────────────────────
const CF_BYPASS_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ar'] });
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  window.chrome = { runtime: {} };
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
  Object.defineProperty(document, 'hidden', { get: () => false });
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
  window.CSS.supports = () => true;
`

// ── Hard-mode bypass script ────────────────────────────────────
const HARD_CF_BYPASS = `
  ${CF_BYPASS_SCRIPT}
  try { const p=WebGLRenderingContext.prototype.getParameter; WebGLRenderingContext.prototype.getParameter=function(p_){if(p_===37445)return'Intel Inc.';if(p_===37446)return'Intel(R) UHD Graphics 620';return p.call(this,p_)} }catch(e){}
  try { const o=HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob=function(fn,t,q){const c=this.getContext('2d');if(c){const d=c.getImageData(0,0,1,1);d.data[0]^=1;c.putImageData(d,0,0)} return o.call(this,fn,t,q)} }catch(e){}
  try { const o=AudioBuffer.prototype.getChannelData; AudioBuffer.prototype.getChannelData=function(c){const d=o.call(this,c);if(d.length>0)d[0]*=1.000001;return d} }catch(e){}
`

// ── Extreme-mode bypass script (full fingerprint spoofing) ────
const EXTREME_CF_BYPASS = `
  ${HARD_CF_BYPASS}

  // Max touch points
  try { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }) }catch(e){}

  // WebRTC — hide real IP
  try {
    const o=RTCPeerConnection.prototype.createDataChannel; RTCPeerConnection.prototype.createDataChannel=function(){return null}
  }catch(e){}

  // Media codecs
  try {
    const o=HTMLMediaElement.prototype.canPlayType; HTMLMediaElement.prototype.canPlayType=function(t){if(t.includes('application/x-mpegurl')||t.includes('application/vnd.apple.mpegurl'))return'probably';return o.call(this,t)}
  }catch(e){}

  // Font preference
  try { Object.defineProperty(window, 'fontList', { get: () => ['Arial','Helvetica','Times New Roman','Courier New','Verdana','Georgia','Palatino','Garamond','Bookman','Comic Sans MS','Trebuchet MS','Arial Black','Impact'] }) }catch(e){}

  // Navigator properties
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => [4,8][Math.floor(Math.random()*2)] }) }catch(e){}
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => [4,8,12,16][Math.floor(Math.random()*4)] }) }catch(e){}

  // Screen orientation
  try {
    if(window.screen.orientation) {
      const o=screen.orientation.type;
      Object.defineProperty(screen.orientation, 'type', { get: () => 'landscape-primary' })
    }
  }catch(e){}

  // Performance timing — make it look like a real browser
  try {
    if(window.performance&&window.performance.timing){
      const n=performance.timing; n.navigationStart=n.navigationStart||Date.now()-2000;
      n.domContentLoadedEventEnd=n.domContentLoadedEventEnd||n.navigationStart+1500+Math.random()*500;
      n.loadEventEnd=n.loadEventEnd||n.domContentLoadedEventEnd+500+Math.random()*300;
    }
  }catch(e){}

  // Storage
  try { navigator.__proto__.__defineGetter__('storage',function(){return{persisted:Promise.resolve(false)}}) }catch(e){}
`

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ── Proxy helpers ──────────────────────────────────────────────
let proxyIndex = 0

function getProxy() {
  const proxyVar = process.env.CSI_PROXY
  if (!proxyVar) return ""
  const proxies = proxyVar.split(",").map(s => s.trim()).filter(Boolean)
  if (proxies.length === 0) return ""
  const p = proxies[proxyIndex % proxies.length]
  proxyIndex++
  return p
}

// ── Block detection ────────────────────────────────────────────
const BLOCK_TEXT = [
  "just a moment", "attention required", "checking your browser", "enable javascript",
  "cf-chl", "cf-error", "access denied", "captcha", "are you a robot",
  "rate limit", "too many requests", "blocked", "ddos", "verify you are human",
  "unusual traffic", "error 1015", "ray id:", "sorry, you have been blocked",
  "performing security verification", "security check", "challenge-platform",
]

function detectBlock(page, statusCode) {
  if ([403, 429, 503].includes(statusCode)) return { blocked: true, type: `HTTP_${statusCode}` }
  return { blocked: false }
}

async function checkBlocked(page) {
  const title = await page.title().catch(() => "")
  const text  = await page.evaluate(() => document.body?.innerText?.substring(0, 800) || "").catch(() => "")
  const lower = (title + " " + text).toLowerCase()
  for (const kw of BLOCK_TEXT) {
    if (lower.includes(kw)) return true
  }
  return false
}

// ── Human-like behavior helpers (now from behavior-engine.mjs) ─
async function humanScroll(page) {
  try {
    await page.evaluate(() => {
      const total = document.body.scrollHeight || 1000
      const steps = 3 + Math.floor(Math.random() * 5)
      for (let i = 1; i <= steps; i++) {
        setTimeout(() => {
          window.scrollTo(0, (total / steps) * i)
        }, i * (300 + Math.random() * 400))
      }
    })
    await randomDelay(800, 2000)
  } catch {}
}

async function humanMouseMove(page) {
  try {
    const x = 100 + Math.random() * 500
    const y = 100 + Math.random() * 500
    await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) })
    await randomDelay(100, 300)
  } catch {}
}

// ── Smart content wait: waits for actual content, not just anti-block ─
// For sites like Indeed that load content dynamically
const CONTENT_SELECTORS = {
  "sa.indeed.com":       ["div.jobsearch-ResultsList", "#mosaic-provider-jobcards", "a[href*='jk=']", ".jobsearch-ResultsList"],
  "www.indeed.com":      ["div.jobsearch-ResultsList", "#mosaic-provider-jobcards", "a[href*='jk=']"],
  "gumtree.com":         ["article", "[data-q='search-result']"],
  "expatriates.com":     [".listing", ".ad-listing", "a[href*='/cls/']"],
  "olx.com.pk":          ["article", "li[data-aut-id]"],
  "sa.opensooq.com":     ["div[class*='card']", "a[href*='/en/search/']"],
}

async function smartContentWait(page, hostname, timeout = 30000) {
  const selectors = CONTENT_SELECTORS[hostname]
  if (!selectors) return false
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout, state: "attached" })
      return true
    } catch {}
  }
  return false
}

// ── Create fresh browser + page (with AI fingerprint rotation) ─
export async function createPage(opts = {}) {
  const extremeMode = opts.extremeMode || process.env.CSI_EXTREME_MODE === "1"
  const hardMode = extremeMode || opts.hardMode || process.env.CSI_HARD_MODE === "1"

  // Use fingerprint engine for realistic device profile per session
  initSessionFingerprint()
  const fp = getSessionFingerprint()

  const ua = opts.userAgent || fp.profile.ua
  const tz = opts.timezone || fp.profile.timezone
  const lc = opts.locale || fp.profile.locale
  const proxy = opts.proxy || getProxy()

  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-features=BlockInsecurePrivateNetworkRequests",
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas", "--no-first-run", "--no-zygote",
  ]
  if (!hardMode) launchArgs.push("--disable-gpu")
  if (extremeMode) {
    launchArgs.push("--disable-web-security", "--allow-running-insecure-content")
  }
  if (proxy) launchArgs.push(`--proxy-server=${proxy}`)

  const headless = extremeMode ? false : (hardMode ? false : true)
  const browser = await chromium.launch({ headless, args: launchArgs })

  const ctxOpts = buildContextOptions(fp)
  const context = await browser.newContext({
    ...ctxOpts,
    userAgent: ua,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Cache-Control": "max-age=0",
    },
    colorScheme: extremeMode ? "no-preference" : "light",
    locale: lc,
    timezoneId: tz,
  })
  // Use generated stealth script with this profile's spoofing
  const initScript = extremeMode
    ? buildStealthScript(fp.profile, true)
    : (hardMode ? HARD_CF_BYPASS : CF_BYPASS_SCRIPT)
  await context.addInitScript(initScript)
  const page = await context.newPage()
  // Block resources only in normal mode
  if (!hardMode) {
    await page.route("**/*.{png,jpg,jpeg,gif,svg,ico,webp,avif,woff,woff2,ttf,eot}", route => route.abort())
  }

  return { browser, context, page, ua, vp: ctxOpts.viewport, tz, lc, proxy, hardMode, extremeMode, fingerprint: fp }
}

// ── Create a fresh context per ad (hard/extreme mode) ──────────
export async function createAdContext(browser, extremeMode = false) {
  const fp = getRandomFingerprint()
  const profile = fp.profile
  const proxy = getProxy()

  const context = await browser.newContext({
    ...buildContextOptions(fp),
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
      "Cache-Control": "max-age=0",
    },
    colorScheme: extremeMode ? "no-preference" : "light",
    locale: profile.locale,
    timezoneId: profile.timezone,
  })
  await context.addInitScript(buildStealthScript(profile, true))
  const page = await context.newPage()
  // Random starting mouse position
  await page.mouse.move(200 + Math.random() * 400, 200 + Math.random() * 400)

  return { context, page, ua: profile.ua, vp: fp.viewport, tz: profile.timezone, lc: profile.locale, proxy, fingerprint: fp }
}

// ── Navigate with Cloudflare challenge handling ────────────────
export async function navigateWithRetry(page, url, retries = 3, hardMode = false) {
  const extreme = process.env.CSI_EXTREME_MODE === "1"
  // Rotate fingerprint on each attempt for varied detection surface
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const timeout = extreme ? 120000 : 60000
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout })
      if (hardMode) {
        await simulateHumanBehavior(page)
      }
      const cfTimeout = extreme ? 90000 : 60000
      try {
        await page.waitForFunction(() => {
          const t = (document.title || "") + " " + (document.body?.innerText || "")
          const l = t.toLowerCase()
          return !l.includes("just a moment") && !l.includes("security verification") && !l.includes("checking your browser") && !l.includes("verify you are human")
        }, { timeout: cfTimeout, polling: 1500 })
      } catch {}
      if (extreme) {
        const hostname = new URL(url).hostname.replace(/^www\./, "")
        await smartContentWait(page, hostname, 15000)
        await waitForStabilization(page, 5000)
      } else if (hardMode) {
        await randomDelay(3000, 6000)
      } else {
        await page.waitForTimeout(1500 + Math.random() * 1000)
      }
      if (await checkBlocked(page)) throw new Error("BLOCKED")
      return resp
    } catch (e) {
      if (e.message === "BLOCKED" && attempt < retries) {
        const waitMs = extreme
          ? 30000 * attempt + Math.random() * 20000
          : hardMode
            ? 15000 * attempt + Math.random() * 10000
            : 8000 * attempt + Math.random() * 4000
        console.log(`[anti-detect] retry ${attempt}/${retries} blocked for ${url.substring(0, 60)} in ${Math.round(waitMs)}ms`)
        // Rotate fingerprint for next attempt
        rotateFingerprint()
        await page.waitForTimeout(waitMs)
      } else if (attempt >= retries) {
        throw e
      } else {
        const waitMs = 4000 * attempt + Math.random() * 2000
        await page.waitForTimeout(waitMs)
      }
    }
  }
}

// ── Open ad page (normal mode: fresh tab in same context) ──────
export async function openAdPage(mainPage, url, context) {
  const adPage = await context.newPage()
  try {
    const resp = await adPage.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    try {
      await adPage.waitForFunction(() => {
        const t = (document.title || "") + " " + (document.body?.innerText || "")
        const l = t.toLowerCase()
        return !l.includes("just a moment") && !l.includes("security verification") && !l.includes("checking your browser") && !l.includes("verify you are human")
      }, { timeout: 60000, polling: 1500 })
    } catch { /* timed out */ }
    await adPage.waitForTimeout(1000)
    if (await checkBlocked(adPage)) throw new Error("BLOCKED")
    return adPage
  } catch (e) {
    await adPage.close().catch(() => {})
    throw e
  }
}

// ── Open ad page (hard/extreme mode: fresh context, AI human behavior) ─
export async function openAdPageHard(browser, url, extremeMode = false) {
  const { context, page } = await createAdContext(browser, extremeMode)
  try {
    const timeout = extremeMode ? 120000 : 90000
    await randomDelay(extremeMode ? 3000 : 1000, extremeMode ? 6000 : 3000)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout })
    // AI behavior mimicry
    await simulateHumanBehavior(page)
    try {
      await page.waitForFunction(() => {
        const t = (document.title || "") + " " + (document.body?.innerText || "")
        const l = t.toLowerCase()
        return !l.includes("just a moment") && !l.includes("security verification") && !l.includes("checking your browser") && !l.includes("verify you are human")
      }, { timeout: 90000, polling: 1500 })
    } catch {}
    await waitForStabilization(page, extremeMode ? 5000 : 2000)
    if (await checkBlocked(page)) throw new Error("BLOCKED")
    return { page, context }
  } catch (e) {
    await page.close().catch(() => {})
    await context.close().catch(() => {})
    throw e
  }
}

// ── High-level helper: create a fresh browser per page load ───
// Use this when sites are aggressively protected (expatriates, bayt)
export async function withFreshPage(url, fn) {
  const { browser, page } = await createPage()
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    try {
      await page.waitForFunction(() => {
        const t = (document.title || "") + " " + (document.body?.innerText || "")
        const l = t.toLowerCase()
        return !l.includes("just a moment") && !l.includes("security verification") && !l.includes("checking your browser")
      }, { timeout: 60000, polling: 1500 })
    } catch {}
    await page.waitForTimeout(2000)
    if (await checkBlocked(page)) throw new Error("BLOCKED")
    return await fn(page, resp)
  } finally {
    await browser.close()
  }
}

export { BLOCK_TEXT }

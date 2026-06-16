/**
 * discovery-engine.mjs — Thread A: Link Discovery & Verification
 * ──────────────────────────────────────────────────────────────
 * Scans listing pages, collects job links, verifies each link is
 * accessible, then feeds verified links to Thread B (interaction).
 *
 * Architecture:
 *   Producer-Consumer pattern — discovered links are yielded one
 *   at a time so Thread B can start processing immediately.
 *
 * Tags: [[DISCOVERY]] [[DISCOVERY_LINK]] [[DISCOVERY_VERIFIED]]
 *       [[DISCOVERY_BLOCKED]] [[DISCOVERY_DONE]]
 */
import { navigateWithRetry } from "./anti-detect.mjs"
import { scanPageForLinks } from "./bridge.mjs"
import { Jitter, createStealthContext } from "./strategy-engine.mjs"
import { recordCheck, getVerifiedStrategy } from "./strategy-ledger.mjs"

function getTimestamp() { return new Date().toISOString() }

function log(tag, msg, meta) {
  const ts = getTimestamp().replace("T", " ").substring(0, 19)
  const extra = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[${ts}] [[${tag}]] ${msg}${extra}`)
}

// ── Quick Link Verification ────────────────────────────────────

const BLOCK_STATUSES = [403, 429, 503]
const VERIFY_BLOCK_KEYWORDS = [
  "just a moment", "attention required", "checking your browser",
  "access denied", "captcha", "are you a robot", "blocked",
  "unusual traffic", "security check",
]

async function verifyLink(headlessBrowser, link, hostname) {
  try {
    const { context, page } = await createStealthContext(headlessBrowser, "discovery-verify")
    try {
      await Jitter.delay(1000, 3000)
      const resp = await page.goto(link, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      })
      await Jitter.delay(1000, 2000)

      const status = resp?.status()
      if (status && BLOCK_STATUSES.includes(status)) {
        log("DISCOVERY_BLOCKED", `Link blocked: HTTP ${status}`, { link: link.substring(0, 60) })
        return { verified: false, reason: `HTTP_${status}` }
      }

      const title = await page.title().catch(() => "")
      const bodyText = await page.evaluate(() =>
        document.body?.innerText?.substring(0, 1000) || ""
      ).catch(() => "")
      const combined = (title + " " + bodyText).toLowerCase()

      for (const kw of VERIFY_BLOCK_KEYWORDS) {
        if (combined.includes(kw)) {
          log("DISCOVERY_BLOCKED", `Link blocked: keyword "${kw}"`, { link: link.substring(0, 60) })
          return { verified: false, reason: `BLOCKED_KEYWORD_${kw.substring(0, 20)}` }
        }
      }

      log("DISCOVERY_VERIFIED", `Link verified`, { link: link.substring(0, 60), status, title: title.substring(0, 40) })
      return { verified: true, title, status }
    } finally {
      await page.close().catch(() => {})
      await context.close().catch(() => {})
    }
  } catch (e) {
    log("DISCOVERY_BLOCKED", `Link verification error`, { link: link.substring(0, 60), error: e.message?.substring(0, 80) })
    return { verified: false, reason: e.message?.substring(0, 100) || "NETWORK_ERROR" }
  }
}

// ── Discovery Configuration ────────────────────────────────────

function parseMaxAge(timePeriod) {
  if (!timePeriod || timePeriod === "all") return Infinity
  const map = { "24h": 864e5, "3d": 2592e5, "1w": 6048e5, "2w": 12096e5, "1m": 2592e6, "3m": 7776e6 }
  return map[timePeriod] || 12096e5
}

// ── Async Generator: Yields verified links one at a time ───────

export async function* discoverLinks(browser, page, category, siteConfig, opts = {}) {
  const {
    maxPages = 10,
    hardMode = false,
    verifyEach = false,
    keyword = "",
    maxResults = 25,
    hostname = "",
  } = opts

  const maxAgeMs = parseMaxAge(opts.timePeriod)
  const allLinks = new Set()
  let pageCount = 0
  let scanModeUsed = false
  let verifiedCount = 0

  const PAGE_OFFSETS = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]

  log("DISCOVERY", `Starting link discovery for "${category.name}"`, {
    hostname: hostname || "unknown",
    maxPages,
    verifyEach,
    maxResults,
  })

  for (let pi = 0; pi < maxPages; pi++) {
    if (verifiedCount >= maxResults) {
      log("DISCOVERY", `Reached max results (${maxResults}) — stopping pagination`)
      break
    }

    const offset = PAGE_OFFSETS[pi]
    const hasQuery = category.url.includes("?")
    const pageUrl = offset === 0
      ? category.url
      : hasQuery
        ? category.url + "&start=" + offset
        : (category.url.endsWith("/") ? category.url + "index" + offset + ".html" : category.url + "/index" + offset + ".html")

    log("DISCOVERY", `Scanning page ${pi + 1}/${maxPages}`, { url: pageUrl.substring(0, 60) })

    try {
      const retries = hardMode ? 4 : 2
      await navigateWithRetry(page, pageUrl, retries, hardMode)
    } catch (e) {
      log("DISCOVERY", `Page ${pi + 1} unavailable — stopping`, { error: e.message?.substring(0, 60) })
      break
    }

    let links = await page.$$eval(category.selector, els =>
      els.map(el => el.href || el.closest("a")?.href).filter(Boolean)
    ).catch(() => [])

    if (links.length === 0 && !scanModeUsed) {
      scanModeUsed = true
      links = await scanPageForLinks(page, siteConfig.extraScanPatterns || [])
    } else if (links.length === 0) {
      log("DISCOVERY", `No links on page ${pi + 1} — stopping`)
      break
    }

    for (const link of links) {
      if (verifiedCount >= maxResults) break
      if (allLinks.has(link)) continue
      allLinks.add(link)

      if (verifyEach) {
        const result = await verifyLink(browser, link, hostname)
        if (!result.verified) {
          log("DISCOVERY", `Skipping blocked link`, { link: link.substring(0, 50), reason: result.reason })
          continue
        }
      }

      verifiedCount++
      log("DISCOVERY_LINK", `Yielding link #${verifiedCount}`, { link: link.substring(0, 60) })

      yield {
        url: link,
        index: verifiedCount,
        total: Math.min(maxResults, links.length),
      }
    }

    pageCount++
    log("DISCOVERY", `Page ${pi + 1} complete — ${allLinks.size} unique links found`)

    if (scanModeUsed) {
      log("DISCOVERY", "Scan mode was used — stopping pagination (best-effort)")
      break
    }
  }

  log("DISCOVERY_DONE", `Discovery complete`, {
    uniqueLinks: allLinks.size,
    verifiedYielded: verifiedCount,
    pagesScanned: pageCount,
    scanModeUsed,
  })
}

// ── Synchronous collector (non-generator version) ──────────────

export async function collectVerifiedLinks(browser, page, category, siteConfig, opts = {}) {
  const links = []
  for await (const link of discoverLinks(browser, page, category, siteConfig, opts)) {
    links.push(link)
  }
  return links
}

export { VERIFY_BLOCK_KEYWORDS }

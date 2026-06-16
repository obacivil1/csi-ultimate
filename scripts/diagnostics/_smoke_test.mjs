/**
 * _smoke_test.mjs — Multi-Site Smoke Test (Headed, Raw)
 * ──────────────────────────────────────────────────────
 * Launches headed browser at human pace so you can watch
 * extraction happen in real time. Bypasses all circuit
 * breakers, rate limiters, and stealth wrappers.
 *
 * Usage:
 *   1. Paste your 4 target URLs below
 *   2. node _smoke_test.mjs
 *
 * You will see:
 *   - A visible browser window navigating to each URL
 *   - console.dir() dump of every extracted field
 *   - Fallback index used per field
 *   - Validation score (PASS / WARN / FAIL)
 */

import { chromium } from "playwright"
import { FALLBACK_MAP, extractByFallback, validateRecord } from "./core/bridge.mjs"

// ═══════════════════════════════════════════════════════════════
//  TARGET URLs — Paste your 4 live links below
// ═══════════════════════════════════════════════════════════════
const TARGETS = [
  {
    label: "Expatriates",
    url: "https://www.expatriates.com/cls/55042036.html",
    site: "expatriates.com",
  },
  {
    label: "LinkedIn",
    url: "https://www.linkedin.com/jobs/view/4100000000/",
    site: "linkedin.com",
  },
  {
    label: "Indeed",
    url: "https://www.indeed.com/viewjob?jk=0000000000000000",
    site: "indeed.com",
  },
  {
    label: "Bayt",
    url: "https://www.bayt.com/en/job/0000000000/",
    site: "bayt.com",
  },
]

// ═══════════════════════════════════════════════════════════════
//  Colours
// ═══════════════════════════════════════════════════════════════
const G = "\x1b[32m"
const Y = "\x1b[33m"
const R = "\x1b[31m"
const C = "\x1b[36m"
const B = "\x1b[1m"
const D = "\x1b[2m"
const X = "\x1b[0m"

function ok(m)   { console.log(`  ${G}✓${X} ${m}`) }
function wr(m)   { console.log(`  ${Y}⚠${X} ${m}`) }
function er(m)   { console.log(`  ${R}✗${X} ${m}`) }
function info(m) { console.log(`  ${C}→${X} ${m}`) }

// ═══════════════════════════════════════════════════════════════
//  Extract with fallback tracking
// ═══════════════════════════════════════════════════════════════
async function extractWithTrace(page, fieldName, fallbacks, configSelector) {
  const args = configSelector ? [configSelector] : []
  for (let attempt = 0; attempt < fallbacks.length; attempt++) {
    try {
      const val = await page.evaluate(fallbacks[attempt], ...args)
      if (val && val.length > 0 && val !== "N/A") {
        return { value: val, fallbackIndex: attempt }
      }
    } catch {}
  }
  return { value: null, fallbackIndex: -1 }
}

// ═══════════════════════════════════════════════════════════════
//  ID extraction (same logic as bridge.mjs)
// ═══════════════════════════════════════════════════════════════
async function extractId(page) {
  return await page.evaluate(() => {
    const p = window.location.pathname
    const m1 = p.match(/\/(\d{6,12})(?:\.html|\/|$)/)
    if (m1) return m1[1]
    const m2 = p.match(/[\/\-]iid[\/\-](\d+)/)
    if (m2) return m2[1]
    return p.split("/").filter(Boolean).pop()?.replace(".html", "") || "UNKNOWN"
  })
}

// ═══════════════════════════════════════════════════════════════
//  Currency detection
// ═══════════════════════════════════════════════════════════════
async function detectCurrency(page) {
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 5000) || "").catch(() => "")
  return text.includes("SAR") ? "SAR" : text.includes("AED") ? "AED" : text.includes("PKR") ? "PKR"
    : text.includes("£") ? "GBP" : text.includes("€") ? "EUR" : text.includes("$") ? "USD" : null
}

// ═══════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════
const BROWSER_CLOSED = { status: "SKIPPED", reason: "Browser launch failed" }

async function main() {
  console.log(`\n${B}╔══════════════════════════════════════════════════════════╗${X}`)
  console.log(`${B}║        CSI-ULTIMATE  ●  MULTI-SITE SMOKE TEST          ║${X}`)
  console.log(`${B}║          ${D}Headed  │  slowMo 1000ms  │  Raw Mode${X}         ${B}║${X}`)
  console.log(`${B}╚══════════════════════════════════════════════════════════╝${X}\n`)

  console.log(`  ${D}Launching browser (watch the window)...${X}\n`)

  // ── Launch Playwright directly — NO circuit breakers, NO rate limiters ──
  const browser = await chromium.launch({
    headless: false,
    slowMo: 1000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  })

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "en-US",
    colorScheme: "light",
  })

  const summary = { passed: 0, warned: 0, failed: 0, errors: 0 }

  for (const [idx, target] of TARGETS.entries()) {
    const num = idx + 1
    console.log(`\n${B}─── [${num}/${TARGETS.length}] ${target.label}${X}  ${D}${target.url}${X}`)
    console.log(`  ${D}${"─".repeat(55)}${X}`)

    const page = await context.newPage()

    try {
      // ── Navigate (strict 20s timeout, raw) ──
      info(`Navigating...`)
      const resp = await page.goto(target.url, { timeout: 20000, waitUntil: "domcontentloaded" })
      const status = resp?.status() || 0
      const title = await page.title().catch(() => "(no title)")

      if (status >= 400) {
        er(`HTTP ${status} — ${title}`)
        summary.errors++
        await page.close()
        continue
      }
      ok(`HTTP ${status}  │  "${title.substring(0, 60)}"`)

      // ── Extract ID ──
      const adId = await extractId(page)
      ok(`Ad ID: ${adId}`)

      // ── Extract each field with fallback trace ──
      const fields = ["title", "price", "phone", "email", "location"]
      const extracted = { id: adId, url: target.url }
      const fallbackLog = []

      for (const field of fields) {
        const fallbacks = FALLBACK_MAP[field]
        if (!fallbacks) continue

        const configSel = null // no site-specific selectors for raw test
        const { value, fallbackIndex } = await extractWithTrace(page, field, fallbacks, configSel)

        extracted[field] = value

        if (value) {
          const fbMsg = fallbackIndex === 0 ? "primary" : `fallback[${fallbackIndex}]`
          ok(`${field.padEnd(8)} ${"─".repeat(3)}  "${String(value).substring(0, 50)}"  ${D}(${fbMsg})${X}`)
          fallbackLog.push({ field, fallbackIndex, fromPrimary: fallbackIndex === 0 })
        } else {
          er(`${field.padEnd(8)} ${"─".repeat(3)}  (null)  ${D}all ${fallbacks.length} fallbacks exhausted${X}`)
          fallbackLog.push({ field, fallbackIndex: -1, fromPrimary: false })
        }
      }

      // ── Currency ──
      extracted.currency = await detectCurrency(page)
      if (extracted.currency) ok(`currency ${"─".repeat(3)}  ${extracted.currency}`)
      else wr(`currency ${"─".repeat(3)}  (null)`)

      extracted.extractedAt = new Date().toISOString()

      // ── Validate ──
      const validation = validateRecord(extracted)
      const scoreColor = validation.score === "PASS" ? G : validation.score === "WARN" ? Y : R
      console.log(`  ${scoreColor}${validation.score}${X}  validation  │  errors: ${validation.errors.length}  warnings: ${validation.warnings.length}`)

      if (validation.warnings.length > 0) {
        for (const w of validation.warnings) {
          wr(`  ${w.reason}`)
        }
      }
      if (validation.errors.length > 0) {
        for (const e of validation.errors) {
          er(`  ${e.reason}`)
        }
      }

      // ── Tally ──
      if (validation.score === "PASS") summary.passed++
      else if (validation.score === "WARN") summary.warned++
      else summary.failed++

      // ── Raw dump ──
      console.log(`\n  ${B}RAW OUTPUT${X}`)
      console.log(`  ${D}${"┄".repeat(55)}${X}`)
      const dump = {
        site: target.label,
        url: target.url,
        ...extracted,
        validation: { score: validation.score, errors: validation.errors.length, warnings: validation.warnings.length },
        fallbackTrace: fallbackLog,
      }
      // Pretty print with depth: null
      const json = JSON.stringify(dump, null, 2)
      for (const line of json.split("\n")) {
        console.log(`  ${line}`)
      }
      console.log(`  ${D}${"┄".repeat(55)}${X}`)

    } catch (err) {
      if (err.message?.includes("Timeout")) {
        er(`TIMEOUT after 20s — ${target.url.substring(0, 50)}`)
      } else if (err.message?.includes("ERR_NAME_NOT_RESOLVED") || err.message?.includes("ENOTFOUND")) {
        er(`DNS FAIL — ${target.site} is unreachable`)
      } else if (err.message?.includes("net::ERR_") || err.message?.includes("NS_ERROR_")) {
        er(`NETWORK ERROR — ${err.message.substring(0, 60)}`)
      } else {
        er(`UNEXPECTED — ${err.message?.substring(0, 80) || err}`)
      }
      summary.errors++
    } finally {
      await page.close().catch(() => {})
    }
  }

  // ── Close browser ──
  await browser.close()

  // ═══════════════════════════════════════════════════════════════
  //  Final Report
  // ═══════════════════════════════════════════════════════════════
  const total = TARGETS.length
  const okCount = summary.passed + summary.warned

  console.log(`\n${B}══════════════════════════════════════════════════════════${X}`)
  console.log(`${B}  SMOKE TEST RESULTS${X}`)
  console.log(`${B}══════════════════════════════════════════════════════════${X}`)
  console.log(`  ${G}PASS${X}  ${summary.passed}  │  ${Y}WARN${X}  ${summary.warned}  │  ${R}FAIL${X}  ${summary.failed}  │  ${R}ERROR${X}  ${summary.errors}`)
  console.log(`  ${D}Total: ${total}  │  Extractable: ${okCount}/${total}${X}`)
  console.log(`  ${okCount >= total ? G + "✓ ALL EXTRACTIONS COMPLETE" : Y + "⚠ SOME EXTRACTIONS FAILED"}${X}`)
  console.log()

  process.exit(summary.failed + summary.errors > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(`\n${R}FATAL${X} ${e.message}`)
  process.exit(1)
})
